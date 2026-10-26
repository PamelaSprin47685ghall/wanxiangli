module Wanxiangli.ScopeProgress.Progress

open System
open System.Collections.Generic
open Fable.Core.JsInterop
open Wanxiangli.ScopeProgress.DurableProgress

type private ScopeState(epoch: string) =
    let rounds = Dictionary<string, Dictionary<string, int>>()
    let settled = Dictionary<string, obj>()
    let reports = Dictionary<string, string * int>()
    let mutable previous: int option = None
    let mutable resetDue = false

    member _.Epoch = epoch
    member _.Previous = previous
    member _.ResetDue = resetDue

    member private _.RecordRound(runId: string, callId: string, estimate: int) : obj =
        if settled.ContainsKey runId then
            createObj [ "ok" ==> false; "reason" ==> "provider round already settled" ]
        else
            let calls =
                match rounds.TryGetValue runId with
                | true, existing -> existing
                | _ ->
                    let created = Dictionary<string, int>()
                    rounds[runId] <- created
                    created
            match calls.TryGetValue callId with
            | true, prior when prior <> estimate ->
                createObj [ "ok" ==> false; "reason" ==> "tool call identity conflicts with its original estimate" ]
            | true, _ ->
                createObj [ "ok" ==> true; "replayed" ==> true; "minimum" ==> (calls.Values |> Seq.min) ]
            | _ ->
                calls[callId] <- estimate
                reports[callId] <- runId, estimate
                createObj [ "ok" ==> true; "replayed" ==> false; "minimum" ==> (calls.Values |> Seq.min) ]

    member this.Record(runId: string, callId: string, estimate: int) : obj =
        if String.IsNullOrWhiteSpace runId || String.IsNullOrWhiteSpace callId || estimate < 0 then
            createObj [ "ok" ==> false; "reason" ==> "valid providerRunId, toolCallId and nonnegative estimate required" ]
        else
            match reports.TryGetValue callId with
            | true, (owner, original) when owner <> runId ->
                if original <> estimate then
                    createObj [ "ok" ==> false; "reason" ==> "tool call identity conflicts with its original estimate" ]
                else
                    let minimum =
                        match settled.TryGetValue owner with
                        | true, result -> unbox<int> result?estimate
                        | _ -> rounds[owner].Values |> Seq.min
                    createObj [ "ok" ==> true; "replayed" ==> true; "minimum" ==> minimum ]
            | _ -> this.RecordRound(runId, callId, estimate)

    member this.SettlePending() : obj array =
        rounds.Keys
        |> Seq.toArray
        |> Array.map (fun runId -> createObj [ "providerRunId" ==> runId; "result" ==> this.Settle runId ])

    member _.Settle(runId: string) : obj =
        match settled.TryGetValue runId with
        | true, already -> already
        | _ ->
            match rounds.TryGetValue runId with
            | false, _ ->
                createObj [ "ok" ==> true; "charged" ==> false; "advisor" ==> false; "resetDue" ==> resetDue ]
            | true, calls ->
                let next = calls.Values |> Seq.min
                let prior = previous
                let trigger = advisorTrigger resetDue prior next
                resetDue <- resetDue || next = 0
                previous <- Some next
                rounds.Remove runId |> ignore
                let outcome =
                    createObj [ "ok" ==> true
                                "charged" ==> true
                                "estimate" ==> next
                                "previous" ==> (prior |> Option.map box |> Option.defaultValue null)
                                "advisor" ==> trigger.IsSome
                                "trigger" ==> (trigger |> Option.map box |> Option.defaultValue null)
                                "resetDue" ==> resetDue ]
                settled[runId] <- outcome
                outcome

type ScopeProgressPort =
    abstract record: sessionId: string * epochId: string * providerRunId: string * toolCallId: string * estimate: int -> obj
    abstract settle: sessionId: string * epochId: string * providerRunId: string -> obj
    abstract settlePending: sessionId: string * epochId: string -> obj array
    abstract reset: sessionId: string * epochId: string -> unit
    abstract status: sessionId: string -> obj
    abstract configureJournal: journalFor: (string -> ProgressJournal) -> unit
    abstract bindSessionJournal: sessionId: string * journalFor: (string -> ProgressJournal) -> unit
    abstract unbindSessionJournal: sessionId: string -> unit
    abstract ensureEpoch: sessionId: string * epochId: string -> unit
    abstract recordedEpoch: sessionId: string * epochId: string -> string
    abstract clear: sessionId: string -> unit

// One process-owned actor, shared across all Host tool bindings.
[<CompiledName("ScopeProgress")>]
let ScopeProgress () : ScopeProgressPort =
    let sessions = Dictionary<string, ScopeState>()
    let perSessionJournal = Dictionary<string, string -> ProgressJournal>()
    let mutable journalFactory: (string -> ProgressJournal) option = None
    let journalFor sessionId =
        match perSessionJournal.TryGetValue sessionId with
        | true, factory -> Some factory
        | _ -> journalFactory
    let withJournal sessionId (work: ProgressJournal -> obj) =
        match journalFor sessionId with
        | None -> None
        | Some factory ->
            try
                let journal = factory sessionId
                try Some(work journal)
                finally journal.close()
            with ex ->
                Some(createObj [ "ok" ==> false; "status" ==> "Unknown"; "reason" ==> ("durable Scope progress unavailable: " + ex.Message) ])
    let find (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, state -> Some state
        | _ -> None
    let reject () = createObj [ "ok" ==> false; "reason" ==> "scope epoch mismatch: reset must be committed first" ]
    let current sessionId epochId =
        match find sessionId with
        | Some state when state.Epoch = epochId -> Some state
        | Some _ -> None
        | None ->
            let state = ScopeState(epochId)
            sessions[sessionId] <- state
            Some state
    { new ScopeProgressPort with
        member _.configureJournal(journalFor) =
            journalFactory <- Some journalFor
        member _.bindSessionJournal(sessionId, journalFor) =
            if not (String.IsNullOrWhiteSpace sessionId) then
                perSessionJournal[sessionId] <- journalFor
        member _.unbindSessionJournal(sessionId) =
            perSessionJournal.Remove sessionId |> ignore
        member _.ensureEpoch(sessionId, epochId) =
            if not (String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId) then
                match find sessionId with
                | Some state when state.Epoch = epochId -> ()
                | _ -> sessions[sessionId] <- ScopeState(epochId)
        member _.recordedEpoch(sessionId, epochId) =
            if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId then ""
            else
                match withJournal sessionId (fun journal ->
                    let snapshot = durableProgressStatus journal sessionId epochId
                    let legitimate = not (isNull snapshot?ok) && unbox<bool> snapshot?ok
                    if not legitimate then
                        createObj [ "ok" ==> false ]
                    elif not (isNull snapshot?known) && unbox<bool> snapshot?known then
                        createObj [ "ok" ==> true; "evidence" ==> true ]
                    else
                        let pending = durableProgressPending journal sessionId epochId
                        let hasPending =
                            not (isNull pending?ok) && unbox<bool> pending?ok
                            && (unbox<string array> pending?pending).Length > 0
                        createObj [ "ok" ==> true; "evidence" ==> hasPending ]) with
                | Some evidence when not (isNull evidence?evidence) && unbox<bool> evidence?evidence -> epochId
                | _ -> ""
        member _.record(sessionId, epochId, providerRunId, toolCallId, estimate) =
            if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId then reject()
            else
                match current sessionId epochId with
                | Some state ->
                    match withJournal sessionId (fun journal ->
                        durableProgressRecord journal sessionId epochId providerRunId toolCallId estimate) with
                    | Some result -> result
                    | None -> state.Record(providerRunId, toolCallId, estimate)
                | None -> reject()
        member _.settle(sessionId, epochId, providerRunId) =
            match find sessionId with
            | Some state when state.Epoch = epochId ->
                match withJournal sessionId (fun journal -> durableProgressSettle journal sessionId epochId providerRunId) with
                | Some result -> result
                | None -> state.Settle providerRunId
            | None -> createObj [ "ok" ==> true; "charged" ==> false; "advisor" ==> false; "resetDue" ==> false ]
            | _ -> reject()
        member _.settlePending(sessionId, epochId) =
            match find sessionId with
            | Some state when state.Epoch = epochId ->
                match journalFor sessionId with
                | None -> state.SettlePending()
                | Some factory ->
                    let journal = factory sessionId
                    try
                        let pending = durableProgressPending journal sessionId epochId
                        if isNull pending?ok || not (unbox<bool> pending?ok) then
                            failwith ("durable Scope pending rounds are unknown: " + string pending?reason)
                        let runs = unbox<string array> pending?pending
                        let fresh =
                            runs
                            |> Array.map (fun runId ->
                                let result = durableProgressSettle journal sessionId epochId runId
                                if isNull result?ok || not (unbox<bool> result?ok) then
                                    failwith ("durable Scope settlement is unknown: " + string result?reason)
                                createObj [ "providerRunId" ==> runId; "result" ==> result ])
                        let due = durableProgressDue journal sessionId epochId
                        if isNull due?ok || not (unbox<bool> due?ok) then
                            failwith ("durable Advisor outbox is unknown: " + string due?reason)
                        let already = HashSet<string>(runs)
                        let previous: obj array = unbox due?due
                        let historic =
                            previous |> Array.filter (fun item -> not (already.Contains(string item?providerRunId)))
                        Array.append fresh historic
                    finally journal.close()
            | _ -> [||]
        member _.reset(sessionId, epochId) =
            sessions[sessionId] <- ScopeState(epochId)
        member _.status(sessionId) =
            match find sessionId with
            | None -> createObj [ "known" ==> false; "resetDue" ==> false ]
            | Some state ->
                match withJournal sessionId (fun journal -> durableProgressStatus journal sessionId state.Epoch) with
                | Some result -> result
                | None ->
                    createObj [ "known" ==> state.Previous.IsSome
                                "estimate" ==> (state.Previous |> Option.map box |> Option.defaultValue null)
                                "resetDue" ==> state.ResetDue
                                "epoch" ==> state.Epoch ]
        member _.clear(sessionId) = sessions.Remove sessionId |> ignore }

let scopeProgress = ScopeProgress()
