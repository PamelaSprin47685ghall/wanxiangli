module Wanxiangli.ScopeRetention.Retention

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.ScopeRetention.Annotation

type private BeatRetraction =
    { BeatId: string
      Replacement: string
      Streak: int
      HostNote: string }

type private TurnDecision =
    | Undecided
    | Decided of ScopeKind * string // kind * toolCallId of the real annotation

type private SessionState(epoch: string) =
    let mutable remaining: int option = None
    let mutable removeStreak = 0
    let mutable lastBeatId: string option = None
    let mutable turn: TurnDecision = Undecided
    let mutable turnRunId = ""
    let retractions = Dictionary<string, BeatRetraction>()
    let journal = ResizeArray<obj>()

    member _.Epoch = epoch
    member _.Remaining = remaining
    member _.RemoveStreak = removeStreak
    member _.Retractions = retractions
    member _.Journal = journal

    member _.EnsureTurn(runId: string) =
        if turnRunId <> runId then
            turn <- Undecided
            turnRunId <- runId

    member private _.Append(eventKind: string) (payload: (string * obj) list) =
        let row =
            createObj (
                [ "kind" ==> eventKind
                  "epoch" ==> epoch
                  "at" ==> DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() ]
                @ payload
            )
        journal.Add row

    member this.Status() : obj =
        createObj
            [ "known" ==> remaining.IsSome
              "epoch" ==> epoch
              "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null)
              "removeStreak" ==> removeStreak
              "advisorDue" ==> (removeStreak >= 3 || (remaining = Some 0)) ]

    member this.Apply
        (toolName: string)
        (runId: string)
        (callId: string)
        (beatId: string)
        (annotation: ScopeAnnotation)
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
            | MeToo, Undecided ->
                refuse "meToo requires exactly one real scope annotation (resetScope|keepLast|removeLast) in the same turn"
            | MeToo, Decided _ ->
                accept [ "kind" ==> "meToo"; "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null) ]
            | _, Decided (prior, priorCall) when priorCall <> callId ->
                refuse ("turn already carries a real scope annotation on " + priorCall + " (" + string prior + "); others must be meToo")
            | kind, _ ->
                // First real annotation this turn (or replay of same call).
                let mark () = turn <- Decided(kind, callId)

                match kind with
                | MeToo -> refuse "unreachable meToo"
                | ResetScope ->
                    mark()
                    let priorRemaining = remaining
                    remaining <- Some annotation.NewScopeRetentionBudget
                    removeStreak <- 0
                    lastBeatId <- Some beatId
                    this.Append "ScopeReset"
                        [ "callId" ==> callId
                          "goal" ==> annotation.NewScopeGoal
                          "budget" ==> annotation.NewScopeRetentionBudget
                          "oldVerbatim" ==> annotation.OldScopeVerboseVerbatim
                          "previousRemaining" ==> (priorRemaining |> Option.map box |> Option.defaultValue null) ]
                    accept
                        [ "kind" ==> "resetScope"
                          "remaining" ==> annotation.NewScopeRetentionBudget
                          "goal" ==> annotation.NewScopeGoal
                          "reanchor" ==> true ]
                | KeepLast ->
                    match remaining with
                    | None when not exempt ->
                        refuse "scope not initialized: first tool annotation must be resetScope"
                    | Some 0 when not exempt ->
                        refuse "retention exhausted: next non-exempt tool must use resetScope"
                    | Some n ->
                        mark()
                        let next = max 0 (n - 1)
                        remaining <- Some next
                        removeStreak <- 0
                        lastBeatId <- Some beatId
                        this.Append "KeepLast" [ "callId" ==> callId; "remaining" ==> next ]
                        accept [ "kind" ==> "keepLast"; "remaining" ==> next; "decremented" ==> true ]
                    | None ->
                        // Exempt before first reset: allow without decrement.
                        mark()
                        accept [ "kind" ==> "keepLast"; "remaining" ==> null; "decremented" ==> false; "exempt" ==> true ]
                | RemoveLast ->
                    match remaining with
                    | None when not exempt ->
                        refuse "scope not initialized: first tool annotation must be resetScope"
                    | _ ->
                        mark()
                        removeStreak <- removeStreak + 1
                        let targetBeat =
                            lastBeatId
                            |> Option.defaultValue beatId
                        let hostNote =
                            "这是连续第 "
                            + string removeStreak
                            + " 次空转，不要空转。 / Idle spin #"
                            + string removeStreak
                            + "; do not spin idle."
                        let body = annotation.Replacement.TrimEnd() + "\n\n" + hostNote
                        let retraction =
                            { BeatId = targetBeat
                              Replacement = body
                              Streak = removeStreak
                              HostNote = hostNote }
                        retractions[targetBeat] <- retraction
                        // removeLast erases *this* remove's own beat from later view? No:
                        // it erases the *previous* beat (lastBeatId). The current beat becomes the new last.
                        lastBeatId <- Some beatId
                        this.Append "BeatRetracted"
                            [ "callId" ==> callId
                              "beatId" ==> targetBeat
                              "replacement" ==> body
                              "streak" ==> removeStreak ]
                        accept
                            [ "kind" ==> "removeLast"
                              "remaining" ==> (remaining |> Option.map box |> Option.defaultValue null)
                              "beatId" ==> targetBeat
                              "replacement" ==> body
                              "removeStreak" ==> removeStreak
                              "advisorDue" ==> (removeStreak >= 3) ]

    member this.Replay(events: obj array) =
        for row in events do
            let kind = string (row?kind)
            match kind with
            | "ScopeReset" ->
                remaining <- Some(unbox<int> row?budget)
                removeStreak <- 0
            | "KeepLast" ->
                remaining <- Some(unbox<int> row?remaining)
                removeStreak <- 0
            | "BeatRetracted" ->
                removeStreak <- unbox<int> row?streak
                let beatId = string row?beatId
                retractions[beatId] <-
                    { BeatId = beatId
                      Replacement = string row?replacement
                      Streak = removeStreak
                      HostNote = "" }
            | _ -> ()

    member this.ProjectionFor(beatId: string) : obj =
        match retractions.TryGetValue beatId with
        | true, r ->
            createObj
                [ "retracted" ==> true
                  "beatId" ==> r.BeatId
                  "replacement" ==> r.Replacement
                  "streak" ==> r.Streak ]
        | _ -> createObj [ "retracted" ==> false ]

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
    abstract reset: sessionId: string * epochId: string -> unit
    abstract clear: sessionId: string -> unit
    abstract journal: sessionId: string -> obj array
    abstract restore: sessionId: string * epochId: string * events: obj array -> unit

[<CompiledName("ScopeRetention")>]
let ScopeRetention () : ScopeRetentionPort =
    let sessions = Dictionary<string, SessionState>()
    let find sessionId =
        match sessions.TryGetValue sessionId with
        | true, state -> Some state
        | _ -> None
    let current sessionId epochId =
        match find sessionId with
        | Some state when state.Epoch = epochId -> state
        | _ ->
            let state = SessionState(epochId)
            sessions[sessionId] <- state
            state
    { new ScopeRetentionPort with
        member _.apply(sessionId, epochId, toolName, providerRunId, toolCallId, beatId, scope) =
            if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId then
                createObj [ "ok" ==> false; "reason" ==> "sessionId and epochId required" ]
            else
                match parseScopeAnnotation scope with
                | Error reason -> createObj [ "ok" ==> false; "reason" ==> reason ]
                | Ok annotation ->
                    let state = current sessionId epochId
                    state.Apply toolName providerRunId toolCallId beatId annotation
        member _.status(sessionId) =
            match find sessionId with
            | None -> createObj [ "known" ==> false; "remaining" ==> null; "removeStreak" ==> 0; "advisorDue" ==> false ]
            | Some state -> state.Status()
        member _.projection(sessionId, beatId) =
            match find sessionId with
            | None -> createObj [ "retracted" ==> false ]
            | Some state -> state.ProjectionFor beatId
        member _.reset(sessionId, epochId) =
            sessions[sessionId] <- SessionState(epochId)
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
