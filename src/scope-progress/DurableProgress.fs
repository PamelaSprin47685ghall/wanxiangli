module Wanxiangli.ScopeProgress.DurableProgress

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

type ProgressJournal =
    abstract read: stream: string -> string array
    abstract append: stream: string * expectedRevision: float * requestId: string * body: string -> obj
    abstract close: unit -> unit

[<Emit("JSON.stringify($0)")>]
let private serialize (_value: obj) : string = jsNative

[<Emit("JSON.parse($0)")>]
let private parse (_value: string) : obj = jsNative

let private valid (value: string) = not (String.IsNullOrWhiteSpace value) && not (value.Contains '\000')
let private field (value: string) = string value.Length + ":" + value
let private streamFor session epoch = "scope-progress:" + field session + ":" + field epoch

type private Reading =
    { Revision: int
      Calls: Dictionary<string, Dictionary<string, int>>
      Order: ResizeArray<string>
      Settled: Dictionary<string, obj>
      Previous: int option
      ResetDue: bool }

let private reading (journal: ProgressJournal) session epoch =
    let frames = journal.read(streamFor session epoch)
    let calls = Dictionary<string, Dictionary<string, int>>()
    let order = ResizeArray<string>()
    let settled = Dictionary<string, obj>()
    let mutable previous: int option = None
    let mutable resetDue = false
    for encoded in frames do
        let item = parse encoded
        match string item?kind with
        | "Recorded" ->
            let runId = string item?run
            let callId = string item?call
            let estimate = unbox<int> item?estimate
            if not (valid runId && valid callId) || estimate < 0 || settled.ContainsKey runId then
                failwith "Scope progress journal contains an invalid recorded call"
            let round =
                match calls.TryGetValue runId with
                | true, current -> current
                | _ ->
                    let fresh = Dictionary<string, int>()
                    calls[runId] <- fresh
                    order.Add runId
                    fresh
            match round.TryGetValue callId with
            | true, earlier when earlier <> estimate ->
                failwith "Scope progress journal has conflicting tool call identity"
            | true, _ -> ()
            | _ -> round[callId] <- estimate
        | "Settled" ->
            let runId = string item?run
            let estimate = unbox<int> item?estimate
            let round =
                match calls.TryGetValue runId with
                | true, existing when existing.Count > 0 -> existing
                | _ -> failwith "Scope progress journal settled a nonexistent provider run"
            if settled.ContainsKey runId || (round.Values |> Seq.min) <> estimate then
                failwith "Scope progress journal contains conflicting provider settlements"
            let prior = previous
            let expectedAdvisor = resetDue || (prior |> Option.exists (fun p -> estimate >= p))
            if unbox<bool> item?advisor <> expectedAdvisor
               || unbox<bool> item?resetDue <> (resetDue || estimate = 0)
               || (if isNull item?previous then None else Some(unbox<int> item?previous)) <> prior then
                failwith "Scope progress settlement history is internally inconsistent"
            settled[runId] <- item
            previous <- Some estimate
            resetDue <- resetDue || estimate = 0
        | _ -> failwith "Unknown Scope progress journal fact kind"
    { Revision = frames.Length; Calls = calls; Order = order; Settled = settled
      Previous = previous; ResetDue = resetDue }

let private error code reason =
    createObj [ "ok" ==> false; "status" ==> code; "reason" ==> reason ]

let private resultOf (item: obj) replayed =
    createObj [ "ok" ==> true; "charged" ==> true
                "replayed" ==> replayed
                "estimate" ==> item?estimate
                "previous" ==> item?previous
                "advisor" ==> item?advisor
                "resetDue" ==> item?resetDue ]

let private append (journal: ProgressJournal) (session: string) (epoch: string) (revision: int) (request: string) (body: string) =
    journal.append(streamFor session epoch, float revision, request, body)

let durableProgressRecord
    (journal: ProgressJournal)
    (session: string)
    (epoch: string)
    (runId: string)
    (callId: string)
    (estimate: int) : obj =
    if not (valid session && valid epoch && valid runId && valid callId) || estimate < 0 then
        error "Invalid" "valid session, Scope, Provider round, call and nonnegative estimate required"
    else
        try
            let rec attempt retries =
                let observed = reading journal session epoch
                if observed.Settled.ContainsKey runId then
                    error "Conflict" "provider round already durably settled"
                else
                    let recorded = observed.Calls.TryGetValue runId
                    match recorded with
                    | true, calls when calls.ContainsKey callId ->
                        if calls[callId] <> estimate then
                            error "Conflict" "same tool identity supplied a different estimate"
                        else
                            createObj [ "ok" ==> true; "replayed" ==> true
                                        "minimum" ==> (calls.Values |> Seq.min) ]
                    | _ ->
                        let body = serialize(createObj [
                            "kind" ==> "Recorded"; "run" ==> runId
                            "call" ==> callId; "estimate" ==> estimate ])
                        let answer = append journal session epoch observed.Revision
                                            ("record:" + field runId + ":" + field callId) body
                        let status = string answer?status
                        let reason = if isNull answer?reason then "" else string answer?reason
                        match status with
                        | "Committed" ->
                            let minimum =
                                match recorded with
                                | true, calls -> min estimate (calls.Values |> Seq.min)
                                | _ -> estimate
                            createObj [ "ok" ==> true; "replayed" ==> false; "minimum" ==> minimum ]
                        | "Conflict" when reason = "RevisionConflict" && retries < 8 -> attempt (retries + 1)
                        | "Replayed" when retries < 8 -> attempt (retries + 1)
                        | _ -> error status reason
            attempt 0
        with ex -> error "Unknown" ("Scope progress admission outcome unknown: " + ex.Message)

let durableProgressSettle
    (journal: ProgressJournal)
    (session: string)
    (epoch: string)
    (runId: string) : obj =
    if not (valid session && valid epoch && valid runId) then
        error "Invalid" "valid session, Scope and Provider run required"
    else
        try
            let rec attempt retries =
                let observed = reading journal session epoch
                match observed.Settled.TryGetValue runId with
                | true, item -> resultOf item true
                | _ ->
                    match observed.Calls.TryGetValue runId with
                    | false, _ ->
                        createObj [ "ok" ==> true; "charged" ==> false
                                    "advisor" ==> false; "resetDue" ==> observed.ResetDue ]
                    | true, calls ->
                        let estimate = calls.Values |> Seq.min
                        let prior = observed.Previous
                        let advisor = observed.ResetDue || (prior |> Option.exists (fun old -> estimate >= old))
                        let resetDue = observed.ResetDue || estimate = 0
                        let body = serialize(createObj [
                            "kind" ==> "Settled"; "run" ==> runId
                            "estimate" ==> estimate
                            "previous" ==> (prior |> Option.map box |> Option.defaultValue null)
                            "advisor" ==> advisor; "resetDue" ==> resetDue ])
                        let answer = append journal session epoch observed.Revision ("settle:" + field runId) body
                        let status = string answer?status
                        let reason = if isNull answer?reason then "" else string answer?reason
                        match status with
                        | "Committed" ->
                            resultOf (parse body) false
                        | "Conflict" when reason = "RevisionConflict" && retries < 8 -> attempt (retries + 1)
                        | "Replayed" when retries < 8 -> attempt (retries + 1)
                        | _ -> error status reason
            attempt 0
        with ex -> error "Unknown" ("Scope progress settlement outcome unknown: " + ex.Message)

let durableProgressStatus (journal: ProgressJournal) (session: string) (epoch: string) : obj =
    try
        let current = reading journal session epoch
        createObj [ "ok" ==> true; "known" ==> current.Previous.IsSome
                    "epoch" ==> epoch
                    "estimate" ==> (current.Previous |> Option.map box |> Option.defaultValue null)
                    "resetDue" ==> current.ResetDue ]
    with ex -> error "Unknown" ("Scope progress status cannot be recovered: " + ex.Message)

let durableProgressPending (journal: ProgressJournal) (session: string) (epoch: string) : obj =
    try
        let current = reading journal session epoch
        let runs =
            current.Order
            |> Seq.filter (fun run -> not (current.Settled.ContainsKey run))
            |> Seq.toArray
        createObj [ "ok" ==> true; "pending" ==> runs ]
    with ex -> error "Unknown" ("Pending Provider rounds cannot be recovered: " + ex.Message)

let durableProgressDue (journal: ProgressJournal) (session: string) (epoch: string) : obj =
    try
        let current = reading journal session epoch
        let due =
            current.Order
            |> Seq.choose (fun runId ->
                match current.Settled.TryGetValue runId with
                | true, item when unbox<bool> item?advisor ->
                    Some(createObj [
                        "providerRunId" ==> runId
                        "result" ==> resultOf item true ])
                | _ -> None)
            |> Seq.toArray
        createObj [ "ok" ==> true; "due" ==> due ]
    with ex ->
        error "Unknown" ("Settled Advisor obligations cannot be recovered: " + ex.Message)
