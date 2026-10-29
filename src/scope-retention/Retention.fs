module Wanxiangli.ScopeRetention.Retention

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.ScopeRetention.Annotation

type RetentionJournal =
    abstract read: stream: string -> string array
    abstract append: stream: string * expectedRevision: float * requestId: string * body: string -> obj
    abstract close: unit -> unit

[<Emit("JSON.stringify($0)")>]
let private serialize (_value: obj) : string = jsNative

[<Emit("JSON.parse($0)")>]
let private parse (_value: string) : obj = jsNative

let private valid (value: string) = not (String.IsNullOrWhiteSpace value) && not (value.Contains '\000')
let private field (value: string) = string value.Length + ":" + value
let private streamFor session epoch = "scope-retention:" + field session + ":" + field epoch

type private BeatRetraction =
    { BeatId: string
      Aliases: string list
      Replacement: string
      Streak: int }

type private Snapshot =
    { Remaining: int option
      RemoveStreak: int
      LastBeatId: string option
      LastBeatAliases: string list }

type private TurnDecision =
    | Undecided
    /// A meToo arrived before any real annotation of its turn. The turn is
    /// booked as one keepLast at once (implementation shorthand; the law still
    /// says a turn may not be all meToo). A real sibling arriving later takes
    /// the turn over: keepLast is already paid, removeLast/resetScope undo the
    /// booking first. Either way the turn spends at most one keep.
    | Implicit of string * Snapshot
    | Decided of ScopeKind * string

let private allMeToo =
    "meToo requires exactly one real scope annotation (resetScope|keepLast|removeLast) in the same turn; a turn may not be all meToo"

type private SessionState(epoch: string) =
    let mutable remaining: int option = None
    let mutable removeStreak = 0
    let mutable lastBeatId: string option = None
    let mutable lastBeatAliases: string list = []
    let mutable turn: TurnDecision = Undecided
    let mutable turnRunId = ""
    let retractions = Dictionary<string, BeatRetraction>()
    let journal = ResizeArray<obj>()
    let mutable durableRevision = 0

    member _.Epoch = epoch
    member _.Remaining = remaining
    member _.RemoveStreak = removeStreak
    member _.Retractions = retractions
    member _.Journal = journal
    member _.DurableRevision = durableRevision
    member _.SetDurableRevision(v: int) = durableRevision <- v

    /// Start a new turn. Nothing carries over.
    member _.EnsureTurn(runId: string) =
        if turnRunId <> runId then
            turn <- Undecided
            turnRunId <- runId

    member this.AppendLocal(eventKind: string) (payload: (string * obj) list) =
        let row =
            createObj (
                [ "kind" ==> eventKind
                  "epoch" ==> epoch
                  "at" ==> DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() ]
                @ payload
            )
        journal.Add row
        row

    member this.Status() : obj =
        createObj
            [ "known" ==> remaining.IsSome
              "epoch" ==> epoch
              "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null)
              "removeStreak" ==> removeStreak
              "advisorDue" ==> (removeStreak >= 3 || remaining = Some 0) ]

    member this.SeedBudget(budget: int) =
        remaining <- Some(max 0 budget)
        removeStreak <- 0

    member private _.BeatAliases(beatId: string) (runId: string) (callId: string) : string list =
        [ beatId; runId; callId ]
        |> List.filter (fun s -> not (String.IsNullOrWhiteSpace s))
        |> List.distinct

    member this.ListRetractions() : obj array =
        retractions.Values
        |> Seq.map (fun r ->
            createObj
                [ "beatId" ==> r.BeatId
                  "aliases" ==> (r.Aliases |> List.toArray)
                  "replacement" ==> r.Replacement
                  "streak" ==> r.Streak ])
        |> Array.ofSeq

    member this.Apply
        (toolName: string)
        (runId: string)
        (callId: string)
        (beatId: string)
        (annotation: ScopeAnnotation)
        (persist: obj -> unit)
        : obj =
        this.EnsureTurn runId
        let exempt = isExemptTool toolName

        let refuse (reason: string) =
            createObj [ "ok" ==> false; "reason" ==> reason ]

        let accept (extra: (string * obj) list) =
            createObj ([ "ok" ==> true ] @ extra)

        match validateScopeFields annotation with
        | Error reason -> refuse reason
        | Ok() ->
            match annotation.Kind, turn with
            // AXIOM 5: exempt tools (negotiate, askPreviousScope, deliver) are
            // lifecycle-neutral. keepLast/meToo on them neither spend retention
            // nor decide the turn, so they are accepted wherever they sit in a
            // parallel batch and cannot carry a sibling for free.
            | (KeepLast | MeToo), _ when exempt ->
                accept
                    [ "kind" ==> (if annotation.Kind = MeToo then "meToo" else "keepLast")
                      "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null)
                      "decremented" ==> false
                      "exempt" ==> true ]
            | MeToo, Decided _ ->
                accept [ "kind" ==> "meToo"; "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null) ]
            | MeToo, Implicit _ ->
                accept [ "kind" ==> "meToo"; "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null) ]
            // meToo ahead of any real annotation: book the turn as one keep now,
            // so it runs at once whatever its place in the batch. If no real
            // sibling ever comes, that booking is what the all-meToo turn cost.
            | MeToo, Undecided ->
                (match remaining with
                 | None ->
                    refuse (allMeToo + "; scope not initialized: this turn's real annotation must be resetScope")
                 | Some 0 ->
                    refuse (allMeToo + "; retention exhausted: this turn's real annotation must be resetScope")
                 | Some n ->
                    let snap =
                        { Remaining = remaining
                          RemoveStreak = removeStreak
                          LastBeatId = lastBeatId
                          LastBeatAliases = lastBeatAliases }
                    turn <- Implicit(callId, snap)
                    let next = n - 1
                    remaining <- Some next
                    removeStreak <- 0
                    lastBeatId <- Some beatId
                    lastBeatAliases <- this.BeatAliases beatId runId callId
                    let row = this.AppendLocal "KeepLast" [ "callId" ==> callId; "remaining" ==> next; "beatId" ==> beatId; "aliases" ==> (lastBeatAliases |> List.toArray); "meToo" ==> true ]
                    persist row
                    accept [ "kind" ==> "meToo"; "remaining" ==> next ])
            // The turn's real keepLast after an early meToo: already paid.
            | KeepLast, Implicit _ ->
                turn <- Decided(KeepLast, callId)
                accept [ "kind" ==> "keepLast"; "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null); "decremented" ==> false ]
            | _, Decided (prior, priorCall) when priorCall <> callId ->
                refuse ("turn already carries a real scope annotation on " + priorCall + " (" + string prior + "); others must be meToo")
            | kind, _ ->
                // removeLast/resetScope after an early meToo: undo its keep
                // booking, then the real annotation decides the turn alone.
                match turn with
                | Implicit (_, snap) ->
                    remaining <- snap.Remaining
                    removeStreak <- snap.RemoveStreak
                    lastBeatId <- snap.LastBeatId
                    lastBeatAliases <- snap.LastBeatAliases
                    let row =
                        this.AppendLocal "KeepLast"
                            [ "callId" ==> callId
                              "remaining" ==> (snap.Remaining |> Option.map box |> Option.defaultValue null)
                              "beatId" ==> (snap.LastBeatId |> Option.map box |> Option.defaultValue null)
                              "aliases" ==> (snap.LastBeatAliases |> List.toArray)
                              "undo" ==> true ]
                    persist row
                    turn <- Undecided
                | _ -> ()
                let mark () = turn <- Decided(kind, callId)

                let receipt =
                  match kind with
                  | MeToo -> refuse "unreachable meToo"
                  | ResetScope ->
                      mark()
                      let priorRemaining = remaining
                      remaining <- Some annotation.NewScopeRetentionBudget
                      removeStreak <- 0
                      lastBeatId <- Some beatId
                      lastBeatAliases <- this.BeatAliases beatId runId callId
                      retractions.Clear()
                      let row =
                          this.AppendLocal "ScopeReset"
                              [ "callId" ==> callId
                                "goal" ==> annotation.NewScopeGoal
                                "budget" ==> annotation.NewScopeRetentionBudget
                                "oldVerbatim" ==> annotation.OldScopeVerboseVerbatim
                                "previousRemaining" ==> (priorRemaining |> Option.map box |> Option.defaultValue null) ]
                      persist row
                      accept
                          [ "kind" ==> "resetScope"
                            "remaining" ==> annotation.NewScopeRetentionBudget
                            "goal" ==> annotation.NewScopeGoal
                            "reanchor" ==> true ]
                  | KeepLast ->
                      match remaining with
                      | None ->
                          refuse "scope not initialized: first tool annotation must be resetScope"
                      | Some 0 ->
                          refuse "retention exhausted: next non-exempt tool must use resetScope"
                      | Some n ->
                          mark()
                          let next = max 0 (n - 1)
                          remaining <- Some next
                          removeStreak <- 0
                          lastBeatId <- Some beatId
                          lastBeatAliases <- this.BeatAliases beatId runId callId
                          let row = this.AppendLocal "KeepLast" [ "callId" ==> callId; "remaining" ==> next; "beatId" ==> beatId; "aliases" ==> (lastBeatAliases |> List.toArray) ]
                          persist row
                          accept [ "kind" ==> "keepLast"; "remaining" ==> next; "decremented" ==> true ]
                  | RemoveLast ->
                      match remaining with
                      | None when not exempt ->
                          refuse "scope not initialized: first tool annotation must be resetScope"
                      | _ ->
                          mark()
                          removeStreak <- removeStreak + 1
                          let targetBeat = lastBeatId |> Option.defaultValue beatId
                          let hostNote =
                              "这是连续第 "
                              + string removeStreak
                              + " 次空转，不要空转。 / Idle spin #"
                              + string removeStreak
                              + "; do not spin idle."
                          let body = annotation.Replacement.TrimEnd() + "\n\n" + hostNote
                          let aliases = this.BeatAliases targetBeat runId callId
                          let priorAliases =
                              match retractions.TryGetValue targetBeat with
                              | true, prior -> prior.Aliases
                              | _ -> []
                          let fromLast =
                              if lastBeatId = Some targetBeat then lastBeatAliases else []
                          let merged = (aliases @ priorAliases @ fromLast) |> List.distinct
                          retractions[targetBeat] <-
                              { BeatId = targetBeat
                                Aliases = merged
                                Replacement = body
                                Streak = removeStreak }
                          lastBeatId <- Some beatId
                          let row =
                              this.AppendLocal "BeatRetracted"
                                  [ "callId" ==> callId
                                    "beatId" ==> targetBeat
                                    "aliases" ==> (merged |> List.toArray)
                                    "replacement" ==> body
                                    "streak" ==> removeStreak ]
                          persist row
                          accept
                              [ "kind" ==> "removeLast"
                                "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null)
                                "beatId" ==> targetBeat
                                "replacement" ==> body
                                "removeStreak" ==> removeStreak
                                "advisorDue" ==> (removeStreak >= 3) ]

                receipt

    member this.Replay(events: obj array) =
        for row in events do
            let kind = string (row?kind)
            match kind with
            | "ScopeReset" ->
                remaining <- Some(unbox<int> row?budget)
                removeStreak <- 0
                retractions.Clear()
                if not (isNull row?callId) then
                    lastBeatId <- Some(string row?callId)
            | "KeepLast" ->
                remaining <- Some(unbox<int> row?remaining)
                removeStreak <- 0
                if not (isNull row?beatId) then
                    lastBeatId <- Some(string row?beatId)
                let raw = row?aliases
                if not (isNull raw) then
                    try lastBeatAliases <- (unbox<string array> raw) |> Array.toList
                    with _ -> ()
            | "BeatRetracted" ->
                removeStreak <- unbox<int> row?streak
                let beatId = string row?beatId
                let aliases =
                    let raw = row?aliases
                    if isNull raw then [ beatId ]
                    else
                        try (unbox<string array> raw) |> Array.toList
                        with _ -> [ beatId ]
                retractions[beatId] <-
                    { BeatId = beatId
                      Aliases = aliases
                      Replacement = string row?replacement
                      Streak = removeStreak }
            | _ -> ()
            journal.Add row

type ScopeRetentionPort =
    abstract apply:
        sessionId: string *
        epochId: string *
        toolName: string *
        providerRunId: string *
        toolCallId: string *
        beatId: string *
        scope: obj ->
            obj
    abstract status: sessionId: string -> obj
    abstract projection: sessionId: string * beatId: string -> obj
    abstract retractions: sessionId: string -> obj array
    abstract reset: sessionId: string * epochId: string -> unit
    abstract seed: sessionId: string * budget: int -> unit
    abstract clear: sessionId: string -> unit
    abstract journal: sessionId: string -> obj array
    abstract restore: sessionId: string * epochId: string * events: obj array -> unit
    abstract configureJournal: journalFor: (string -> RetentionJournal) -> unit
    abstract bindSessionJournal: sessionId: string * journalFor: (string -> RetentionJournal) -> unit
    abstract unbindSessionJournal: sessionId: string -> unit
    abstract ensureEpoch: sessionId: string * epochId: string -> unit

[<CompiledName("ScopeRetention")>]
let ScopeRetention () : ScopeRetentionPort =
    let sessions = Dictionary<string, SessionState>()
    let perSessionJournal = Dictionary<string, string -> RetentionJournal>()
    let mutable journalFactory: (string -> RetentionJournal) option = None

    let journalFor sessionId =
        match perSessionJournal.TryGetValue sessionId with
        | true, factory -> Some factory
        | _ -> journalFactory

    let find sessionId =
        match sessions.TryGetValue sessionId with
        | true, state -> Some state
        | _ -> None

    let loadDurable sessionId epochId (state: SessionState) =
        match journalFor sessionId with
        | None -> ()
        | Some factory ->
            try
                let journal = factory sessionId
                try
                    let frames = journal.read (streamFor sessionId epochId)
                    if frames.Length > 0 && state.Journal.Count = 0 then
                        let events = frames |> Array.map parse
                        state.Replay events
                        state.SetDurableRevision frames.Length
                finally
                    journal.close()
            with _ ->
                ()

    let persist sessionId epochId (state: SessionState) (row: obj) =
        match journalFor sessionId with
        | None -> ()
        | Some factory ->
            try
                let journal = factory sessionId
                try
                    let expected = float state.DurableRevision
                    let requestId = string (row?kind) + ":" + string (row?at) + ":" + string (row?callId)
                    let result = journal.append (streamFor sessionId epochId, expected, requestId, serialize row)
                    let status = string result?status
                    if status = "Committed" || status = "Replayed" then
                        state.SetDurableRevision(state.DurableRevision + 1)
                finally
                    journal.close()
            with _ ->
                ()

    let current sessionId epochId =
        match find sessionId with
        | Some state when state.Epoch = epochId ->
            loadDurable sessionId epochId state
            state
        | _ ->
            let state = SessionState(epochId)
            sessions[sessionId] <- state
            loadDurable sessionId epochId state
            state

    { new ScopeRetentionPort with
        member _.configureJournal(journalFor) = journalFactory <- Some journalFor
        member _.bindSessionJournal(sessionId, journalFor) =
            if not (String.IsNullOrWhiteSpace sessionId) then
                perSessionJournal[sessionId] <- journalFor
        member _.unbindSessionJournal(sessionId) =
            perSessionJournal.Remove sessionId |> ignore
        member _.ensureEpoch(sessionId, epochId) =
            if not (String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId) then
                match find sessionId with
                | Some state when state.Epoch = epochId -> loadDurable sessionId epochId state
                | _ ->
                    let state = SessionState(epochId)
                    sessions[sessionId] <- state
                    loadDurable sessionId epochId state
        member _.apply(sessionId, epochId, toolName, providerRunId, toolCallId, beatId, scope) =
            if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId then
                createObj [ "ok" ==> false; "reason" ==> "sessionId and epochId required" ]
            else
                match parseScopeAnnotation scope with
                | Error reason -> createObj [ "ok" ==> false; "reason" ==> reason ]
                | Ok annotation ->
                    let state = current sessionId epochId
                    state.Apply toolName providerRunId toolCallId beatId annotation (persist sessionId epochId state)
        member _.status(sessionId) =
            match find sessionId with
            | None -> createObj [ "known" ==> false; "remaining" ==> null; "removeStreak" ==> 0; "advisorDue" ==> false ]
            | Some state -> state.Status()
        member _.projection(sessionId, beatId) =
            match find sessionId with
            | None -> createObj [ "retracted" ==> false ]
            | Some state ->
                let found =
                    match state.Retractions.TryGetValue beatId with
                    | true, r -> Some r
                    | _ ->
                        state.Retractions.Values
                        |> Seq.tryFind (fun r -> List.contains beatId r.Aliases)
                match found with
                | Some r ->
                    createObj
                        [ "retracted" ==> true
                          "beatId" ==> r.BeatId
                          "aliases" ==> (r.Aliases |> List.toArray)
                          "replacement" ==> r.Replacement
                          "streak" ==> r.Streak ]
                | None -> createObj [ "retracted" ==> false ]
        member _.retractions(sessionId) =
            match find sessionId with
            | None -> [||]
            | Some state -> state.ListRetractions()
        member _.reset(sessionId, epochId) =
            sessions[sessionId] <- SessionState(epochId)
        member _.seed(sessionId, budget) =
            match find sessionId with
            | Some state -> state.SeedBudget budget
            | None -> ()
        member _.clear(sessionId) = sessions.Remove sessionId |> ignore
        member _.journal(sessionId) =
            match find sessionId with
            | None -> [||]
            | Some state -> state.Journal.ToArray()
        member _.restore(sessionId, epochId, events) =
            let state = SessionState(epochId)
            state.Replay events
            sessions[sessionId] <- state }

let scopeRetention = ScopeRetention()
