module Wanxiangli.DelegateBatch.SyncDelegateBatchStore

open Wanxiangli.DelegateBatch

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

type BatchStage =
    | Pending
    | Ready
    | Active
    | Closed

type CallStage =
    | Dispatched
    | Closed

type private InFlightCall =
    { callId: string
      ownerSessionId: string
      ownerScope: string
      role: string
      delegateSessionId: string
      agent: string
      invocationKeys: string list
      mutable stage: CallStage }

type private BatchRecord =
    { mutable stage: BatchStage
      providerRun: string
      callOrder: string list
      received: Dictionary<string, string>
      mutable orderedInvocations: string list }

type private ObservedRunRecord =
    { calls: ResizeArray<string * string>
      seen: HashSet<string> }

/// EXEC-026/031: process-local SyncDelegate batch and in-flight call state store.
/// 1. Synchronous dual-index: callsByOwnerScope <-> callsByDelegate updated under single lock.
/// 2. Batch lifecycle state machine: Pending -> Ready -> Active -> Closed.
/// 3. Observed provider tool calls deduplication (Seen) with explicit session clearing.
/// 4. Pure Key Settlement: store holds only string IDs and domain stages; returns
///    structured settlement key lists so host can resolve TCS and dispose resources.
[<AttachMembers>]
type SyncDelegateBatchStore() =
    let gate = obj ()
    let law = DelegateBatchLawCore()

    let callsByOwnerScope = Dictionary<string, ResizeArray<string>>()
    let callsByDelegate = Dictionary<string, string>()
    let callRecords = Dictionary<string, InFlightCall>()

    let batches = Dictionary<string, BatchRecord>()
    let observedProviderRuns = Dictionary<string, ObservedRunRecord>()

    let cleanKey (s: string) : string =
        if isNull s then "" else s.Trim()

    let batchKey (ownerScope: string) (role: string) : string =
        (cleanKey ownerScope) + ":" + (cleanKey role)

    let observedKey (ownerSessionId: string) (providerRun: string) : string =
        (cleanKey ownerSessionId) + ":" + (cleanKey providerRun)

    let removeOwnerCall (ownerKey: string) (callId: string) =
        match callsByOwnerScope.TryGetValue ownerKey with
        | true, list ->
            list.Remove callId |> ignore
            if list.Count = 0 then
                callsByOwnerScope.Remove ownerKey |> ignore
        | false, _ -> ()

    member _.observeProviderToolCall(ownerSessionId: string, providerRun: string, role: string, callId: string) : unit =
        let oKey = cleanKey ownerSessionId
        let pKey = cleanKey providerRun
        let rKey = cleanKey role
        let cKey = cleanKey callId
        if not (String.IsNullOrEmpty oKey || String.IsNullOrEmpty pKey || String.IsNullOrEmpty cKey) then
            lock gate (fun () ->
                let k = observedKey oKey pKey
                let observed =
                    match observedProviderRuns.TryGetValue k with
                    | true, cur -> cur
                    | false, _ ->
                        let created =
                            { calls = ResizeArray<string * string>()
                              seen = HashSet<string>() }
                        observedProviderRuns.[k] <- created
                        created
                if observed.seen.Add cKey then
                    observed.calls.Add(rKey, cKey))

    member _.tryObservedBatch(ownerSessionId: string, providerRun: string, role: string, currentCall: string) : string array option =
        let oKey = cleanKey ownerSessionId
        let pKey = cleanKey providerRun
        let rKey = cleanKey role
        let cKey = cleanKey currentCall
        lock gate (fun () ->
            let k = observedKey oKey pKey
            match observedProviderRuns.TryGetValue k with
            | false, _ -> None
            | true, observed ->
                let rawCalls =
                    observed.calls
                    |> Seq.map (fun (r, cid) -> createObj [ "role" ==> r; "callId" ==> cid ])
                    |> Seq.toArray
                let orderObj: obj =
                    law.observedBatch(
                        createObj
                            [ "role" ==> rKey
                              "currentCall" ==> cKey
                              "calls" ==> rawCalls ]
                    )
                if isNull orderObj then
                    None
                else
                    Some (unbox<string array> orderObj))

    member _.clearSessionObserved(ownerSessionId: string) : unit =
        let oKey = cleanKey ownerSessionId
        if not (String.IsNullOrEmpty oKey) then
            lock gate (fun () ->
                let prefix = oKey + ":"
                let keysToRemove =
                    observedProviderRuns.Keys
                    |> Seq.filter (fun k -> k.StartsWith prefix)
                    |> Seq.toList
                for k in keysToRemove do
                    observedProviderRuns.Remove k |> ignore)

    member _.admit(ownerScope: string, role: string, invocationKey: string, batchObj: obj option) : obj =
        let sKey = cleanKey ownerScope
        let rKey = cleanKey role
        let invKey = cleanKey invocationKey
        let bKey = batchKey sKey rKey

        lock gate (fun () ->
            let existingBatchOpt =
                match batches.TryGetValue bKey with
                | true, b -> Some b
                | false, _ -> None

            let hasActive =
                match existingBatchOpt with
                | Some b when b.stage = Active || b.stage = Ready -> true
                | _ -> false

            let pendingInput =
                match existingBatchOpt with
                | Some b when b.stage = Pending ->
                    createObj
                        [ "providerRun" ==> b.providerRun
                          "callOrder" ==> (b.callOrder |> List.toArray)
                          "received" ==> (b.received.Keys |> Seq.toArray) ]
                | _ -> null

            let batchInput =
                match batchObj with
                | Some b -> b
                | None -> null

            let verdict: obj =
                law.admit(
                    createObj
                        [ "active" ==> hasActive
                          "pending" ==> pendingInput
                          "batch" ==> batchInput ]
                )

            let verdictKind = unbox<string> verdict?verdict

            match verdictKind with
            | "reject" ->
                createObj [ "verdict" ==> "reject"; "reason" ==> (unbox<string> verdict?reason) ]
            | "single" ->
                let singleBatch =
                    { stage = Ready
                      providerRun = ""
                      callOrder = []
                      received = Dictionary<string, string>()
                      orderedInvocations = [ invKey ] }
                batches.[bKey] <- singleBatch
                createObj [ "verdict" ==> "single"; "invocations" ==> [| invKey |] ]
            | "wait" ->
                let currentCall = unbox<string> batchInput?currentCall
                let order = unbox<string array> batchInput?callOrder |> Array.toList
                let pRun = unbox<string> batchInput?providerRun
                let batch =
                    if unbox<bool> verdict?``open`` || Option.isNone existingBatchOpt then
                        let created =
                            { stage = Pending
                              providerRun = pRun
                              callOrder = order
                              received = Dictionary<string, string>()
                              orderedInvocations = [] }
                        batches.[bKey] <- created
                        created
                    else
                        existingBatchOpt.Value
                batch.received.[currentCall] <- invKey
                createObj [ "verdict" ==> "wait" ]
            | "ready" ->
                let currentCall = unbox<string> batchInput?currentCall
                let order = unbox<string array> batchInput?callOrder |> Array.toList
                let pRun = unbox<string> batchInput?providerRun
                let batch =
                    if unbox<bool> verdict?``open`` || Option.isNone existingBatchOpt then
                        let created =
                            { stage = Pending
                              providerRun = pRun
                              callOrder = order
                              received = Dictionary<string, string>()
                              orderedInvocations = [] }
                        batches.[bKey] <- created
                        created
                    else
                        existingBatchOpt.Value
                batch.received.[currentCall] <- invKey
                let readyOrder = unbox<string array> verdict?order |> Array.toList
                let orderedInvs = readyOrder |> List.map (fun callId -> batch.received.[callId])
                batch.stage <- Ready
                batch.orderedInvocations <- orderedInvs
                createObj
                    [ "verdict" ==> "ready"
                      "invocations" ==> (orderedInvs |> List.toArray) ]
            | other ->
                invalidOp ("Unexpected admit verdict from DelegateBatchLawCore: " + other))

    member _.releaseAdmission(ownerScope: string, role: string) : unit =
        let bKey = batchKey ownerScope role
        lock gate (fun () ->
            batches.Remove bKey |> ignore)

    member _.beginCall
        (
            ownerSessionId: string,
            ownerScope: string,
            role: string,
            delegateSessionId: string,
            agent: string,
            invocationKeys: string list,
            callId: string
        ) : obj =
        let sKey = cleanKey ownerScope
        let dKey = cleanKey delegateSessionId
        let cKey = cleanKey callId
        let bKey = batchKey sKey role

        lock gate (fun () ->
            match batches.TryGetValue bKey with
            | false, _ ->
                createObj [ "ok" ==> false; "error" ==> "sync delegate call was cancelled before dispatch" ]
            | true, batch when batch.stage <> Ready && batch.stage <> Active ->
                createObj [ "ok" ==> false; "error" ==> "sync delegate call was cancelled before dispatch" ]
            | true, batch ->
                if callsByDelegate.ContainsKey dKey then
                    createObj [ "ok" ==> false; "error" ==> "sync delegate rejected: dedicated delegate already has an in-flight call" ]
                else
                    batch.stage <- Active
                    let inFlight =
                        { callId = cKey
                          ownerSessionId = cleanKey ownerSessionId
                          ownerScope = sKey
                          role = cleanKey role
                          delegateSessionId = dKey
                          agent = cleanKey agent
                          invocationKeys = invocationKeys
                          stage = Dispatched }
                    callRecords.[cKey] <- inFlight
                    callsByDelegate.[dKey] <- cKey

                    let list =
                        match callsByOwnerScope.TryGetValue sKey with
                        | true, l -> l
                        | false, _ ->
                            let l = ResizeArray<string>()
                            callsByOwnerScope.[sKey] <- l
                            l
                    list.Add cKey
                    createObj [ "ok" ==> true ])

    member _.tryPeekCallByDelegate(delegateSessionId: string) : string option =
        let dKey = cleanKey delegateSessionId
        lock gate (fun () ->
            match callsByDelegate.TryGetValue dKey with
            | true, cKey -> Some cKey
            | false, _ -> None)

    member _.tryPopCallByDelegate(delegateSessionId: string) : string option =
        let dKey = cleanKey delegateSessionId
        lock gate (fun () ->
            match callsByDelegate.TryGetValue dKey with
            | true, cKey ->
                callsByDelegate.Remove dKey |> ignore
                match callRecords.TryGetValue cKey with
                | true, record ->
                    record.stage <- Closed
                    callRecords.Remove cKey |> ignore
                    removeOwnerCall record.ownerScope cKey
                | false, _ -> ()
                Some cKey
            | false, _ -> None)

    member _.tryPopExactCall(delegateSessionId: string, callId: string) : string option =
        let dKey = cleanKey delegateSessionId
        let cKey = cleanKey callId
        lock gate (fun () ->
            match callsByDelegate.TryGetValue dKey with
            | true, current when current = cKey ->
                callsByDelegate.Remove dKey |> ignore
                match callRecords.TryGetValue cKey with
                | true, record ->
                    record.stage <- Closed
                    callRecords.Remove cKey |> ignore
                    removeOwnerCall record.ownerScope cKey
                | false, _ -> ()
                Some cKey
            | _ -> None)

    member _.cancelScope(ownerScope: string) : obj =
        let sKey = cleanKey ownerScope
        lock gate (fun () ->
            let cancelledCalls = ResizeArray<string>()
            let cancelledInvocations = ResizeArray<string>()

            let prefix = sKey + ":"
            let batchKeys =
                batches.Keys
                |> Seq.filter (fun k -> k.StartsWith prefix)
                |> Seq.toList

            for k in batchKeys do
                match batches.TryGetValue k with
                | true, b ->
                    for invKey in b.received.Values do
                        cancelledInvocations.Add invKey
                    for invKey in b.orderedInvocations do
                        if not (cancelledInvocations.Contains invKey) then
                            cancelledInvocations.Add invKey
                    batches.Remove k |> ignore
                | false, _ -> ()

            let obsKeys =
                observedProviderRuns.Keys
                |> Seq.filter (fun k -> k.StartsWith prefix)
                |> Seq.toList
            for k in obsKeys do
                observedProviderRuns.Remove k |> ignore

            match callsByOwnerScope.TryGetValue sKey with
            | true, list ->
                for cKey in list do
                    cancelledCalls.Add cKey
                    match callRecords.TryGetValue cKey with
                    | true, call ->
                        call.stage <- Closed
                        callsByDelegate.Remove call.delegateSessionId |> ignore
                        callRecords.Remove cKey |> ignore
                    | false, _ -> ()
                callsByOwnerScope.Remove sKey |> ignore
            | false, _ -> ()

            createObj
                [ "cancelledCalls" ==> (cancelledCalls.ToArray())
                  "cancelledInvocations" ==> (cancelledInvocations.ToArray()) ])

    member _.clearAll() : obj =
        lock gate (fun () ->
            let allCalls = ResizeArray<string>()
            let allInvocations = ResizeArray<string>()

            for b in batches.Values do
                for inv in b.received.Values do
                    allInvocations.Add inv
                for inv in b.orderedInvocations do
                    if not (allInvocations.Contains inv) then
                        allInvocations.Add inv

            for cKey in callRecords.Keys do
                allCalls.Add cKey

            batches.Clear()
            observedProviderRuns.Clear()
            callsByOwnerScope.Clear()
            callsByDelegate.Clear()
            callRecords.Clear()

            createObj
                [ "cancelledCalls" ==> (allCalls.ToArray())
                  "cancelledInvocations" ==> (allInvocations.ToArray()) ])

    member _.activeCallsCount : int =
        lock gate (fun () -> callsByDelegate.Count)

    member _.batchesCount : int =
        lock gate (fun () -> batches.Count)

    member _.observedRunsCount : int =
        lock gate (fun () -> observedProviderRuns.Count)

let syncDelegateBatchStore = SyncDelegateBatchStore()
