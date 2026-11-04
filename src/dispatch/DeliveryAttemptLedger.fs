module Wanxiangli.Dispatch.DeliveryAttemptLedger

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type DeliveryFence =
    { sessionId: string
      providerRun: string
      callId: string }

[<AttachMembers>]
type InterruptFacts =
    { issued: bool
      observed: obj option }

[<AttachMembers>]
type DeliveryAttemptRecord =
    { fence: DeliveryFence
      physical: string option
      established: bool
      presented: bool
      interrupt: InterruptFacts
      interruptTask: obj option
      sequence: int }

module private LedgerInternal =

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0) ? Array.from($0) : []")>]
    let copyArray (_x: obj) : obj array = jsNative

    [<Emit("typeof $0 === 'object' && $0 !== null")>]
    let isObject (_x: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (_x: obj) : bool = jsNative

    let emptyFacts: InterruptFacts = { issued = false; observed = None }

    let emptyRecord (fence: DeliveryFence) : DeliveryAttemptRecord =
        { fence = fence
          physical = None
          established = false
          presented = false
          interrupt = emptyFacts
          interruptTask = None
          sequence = 0 }

    let fenceKey (fence: DeliveryFence) : string =
        fence.sessionId + ":" + fence.providerRun + ":" + fence.callId

    let parseFence (fenceObj: obj) : DeliveryFence option =
        if isNull fenceObj || not (isObject fenceObj) then None
        else
            let sid1: obj = fenceObj?sessionId
            let sid2: obj = fenceObj?SessionId
            let sid =
                if not (isNull sid1) then string sid1
                elif not (isNull sid2) then string sid2
                else ""
            let pr1: obj = fenceObj?providerRun
            let pr2: obj = fenceObj?ProviderRun
            let pr =
                if not (isNull pr1) then string pr1
                elif not (isNull pr2) then string pr2
                else ""
            let cid1: obj = fenceObj?callId
            let cid2: obj = fenceObj?CallId
            let cid3: obj = fenceObj?toolCallId
            let cid4: obj = fenceObj?ToolCallId
            let cid =
                if not (isNull cid1) then string cid1
                elif not (isNull cid2) then string cid2
                elif not (isNull cid3) then string cid3
                elif not (isNull cid4) then string cid4
                else ""
            let sTrim = sid.Trim()
            let pTrim = pr.Trim()
            let cTrim = cid.Trim()
            if String.IsNullOrWhiteSpace sTrim || sTrim = "undefined" || sTrim = "null"
               || String.IsNullOrWhiteSpace pTrim || pTrim = "undefined" || pTrim = "null"
               || String.IsNullOrWhiteSpace cTrim || cTrim = "undefined" || cTrim = "null" then
                None
            else
                Some { sessionId = sTrim; providerRun = pTrim; callId = cTrim }

    let parsePhysical (physicalInput: obj) : string option =
        if isNull physicalInput then None
        elif isString physicalInput then
            let s = (string physicalInput).Trim()
            if String.IsNullOrWhiteSpace s || s = "undefined" || s = "null" then None
            else Some s
        elif isObject physicalInput then
            let p1: obj = physicalInput?physicalUserMessageId
            let p2: obj = physicalInput?PhysicalUserMessageId
            let p3: obj = physicalInput?value
            let p4: obj = physicalInput?Value
            let p =
                if not (isNull p1) then string p1
                elif not (isNull p2) then string p2
                elif not (isNull p3) then string p3
                elif not (isNull p4) then string p4
                else ""
            let pTrim = p.Trim()
            if String.IsNullOrWhiteSpace pTrim || pTrim = "undefined" || pTrim = "null" then None
            else Some pTrim
        else None

    let parseWitness (witness: obj) : (string * string * string * string) option =
        if isNull witness || not (isObject witness) then None
        else
            let sid1: obj = witness?sessionId
            let sid2: obj = witness?SessionId
            let sid =
                if not (isNull sid1) then string sid1
                elif not (isNull sid2) then string sid2
                else ""
            let pr1: obj = witness?providerRun
            let pr2: obj = witness?ProviderRun
            let pr =
                if not (isNull pr1) then string pr1
                elif not (isNull pr2) then string pr2
                else ""
            let cid1: obj = witness?callId
            let cid2: obj = witness?CallId
            let cid3: obj = witness?toolCallId
            let cid4: obj = witness?ToolCallId
            let cid =
                if not (isNull cid1) then string cid1
                elif not (isNull cid2) then string cid2
                elif not (isNull cid3) then string cid3
                elif not (isNull cid4) then string cid4
                else ""
            let phys1: obj = witness?physicalUserMessageId
            let phys2: obj = witness?PhysicalUserMessageId
            let phys3: obj = witness?physical
            let phys4: obj = witness?Physical
            let phys =
                if not (isNull phys1) then string phys1
                elif not (isNull phys2) then string phys2
                elif not (isNull phys3) then string phys3
                elif not (isNull phys4) then string phys4
                else ""
            let sTrim = sid.Trim()
            let pTrim = pr.Trim()
            let cTrim = cid.Trim()
            let phTrim = phys.Trim()
            if String.IsNullOrWhiteSpace sTrim || sTrim = "undefined" || sTrim = "null"
               || String.IsNullOrWhiteSpace pTrim || pTrim = "undefined" || pTrim = "null"
               || String.IsNullOrWhiteSpace cTrim || cTrim = "undefined" || cTrim = "null"
               || String.IsNullOrWhiteSpace phTrim || phTrim = "undefined" || phTrim = "null" then
                None
            else
                Some (sTrim, pTrim, cTrim, phTrim)

[<AttachMembers>]
type DeliveryAttemptLedger() =
    let records = Dictionary<string, DeliveryAttemptRecord>()
    let mutable sequence = 0

    member _.recordEstablished(fenceInput: obj, physicalInput: obj) : bool =
        match LedgerInternal.parseFence fenceInput with
        | None -> false
        | Some fence ->
            let physical = LedgerInternal.parsePhysical physicalInput
            sequence <- sequence + 1
            let key = LedgerInternal.fenceKey fence
            match records.TryGetValue key with
            | true, current ->
                let preservedPhysical =
                    match current.physical with
                    | Some existing -> Some existing
                    | None -> physical
                records[key] <-
                    { current with
                        physical = preservedPhysical
                        established = true
                        sequence = sequence }
                true
            | false, _ ->
                records[key] <-
                    { fence = fence
                      physical = physical
                      established = true
                      presented = false
                      interrupt = LedgerInternal.emptyFacts
                      interruptTask = None
                      sequence = sequence }
                true

    member _.recordPresented(fenceInput: obj) : bool =
        match LedgerInternal.parseFence fenceInput with
        | None -> false
        | Some fence ->
            sequence <- sequence + 1
            let key = LedgerInternal.fenceKey fence
            match records.TryGetValue key with
            | true, current ->
                records[key] <-
                    { current with
                        presented = true
                        sequence = sequence }
                true
            | false, _ ->
                records[key] <-
                    { fence = fence
                      physical = None
                      established = false
                      presented = true
                      interrupt = LedgerInternal.emptyFacts
                      interruptTask = None
                      sequence = sequence }
                true

    member _.tryFindEstablished(sessionId: string, physicalInput: obj) : DeliveryAttemptRecord option =
        if String.IsNullOrWhiteSpace sessionId then None
        else
            let sTrim = sessionId.Trim()
            let physicalStr = LedgerInternal.parsePhysical physicalInput
            let matches =
                records.Values
                |> Seq.filter (fun r ->
                    r.fence.sessionId = sTrim
                    && r.established
                    && (match physicalStr with
                        | Some expected -> r.physical = Some expected
                        | None -> r.physical.IsNone))
                |> Seq.sortBy (fun r -> r.sequence)
                |> Seq.toArray
            if matches.Length = 0 then None
            else Some matches[matches.Length - 1]

    member _.hasEstablished(sessionId: string) : bool =
        if String.IsNullOrWhiteSpace sessionId then false
        else
            let sTrim = sessionId.Trim()
            records.Values
            |> Seq.exists (fun r -> r.fence.sessionId = sTrim && r.established)

    member _.recordInterruptIssued(fenceInput: obj, task: obj) : bool =
        match LedgerInternal.parseFence fenceInput with
        | None -> false
        | Some fence ->
            sequence <- sequence + 1
            let key = LedgerInternal.fenceKey fence
            let current =
                match records.TryGetValue key with
                | true, c -> c
                | false, _ -> LedgerInternal.emptyRecord fence
            records[key] <-
                { current with
                    interrupt = { current.interrupt with issued = true }
                    interruptTask = (if isNull task then None else Some task)
                    sequence = sequence }
            true

    member _.recordInterruptObserved(fenceInput: obj, outcome: obj) : bool =
        match LedgerInternal.parseFence fenceInput with
        | None -> false
        | Some fence ->
            sequence <- sequence + 1
            let key = LedgerInternal.fenceKey fence
            let current =
                match records.TryGetValue key with
                | true, c -> c
                | false, _ -> LedgerInternal.emptyRecord fence
            records[key] <-
                { current with
                    interrupt = { current.interrupt with observed = (if isNull outcome then None else Some outcome) }
                    sequence = sequence }
            true

    member _.interruptFacts(fenceInput: obj) : InterruptFacts =
        match LedgerInternal.parseFence fenceInput with
        | None -> LedgerInternal.emptyFacts
        | Some fence ->
            let key = LedgerInternal.fenceKey fence
            match records.TryGetValue key with
            | true, r -> r.interrupt
            | false, _ -> LedgerInternal.emptyFacts

    member _.activeInterruptTask(sessionId: string, providerRun: string) : obj option =
        if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace providerRun then None
        else
            let sTrim = sessionId.Trim()
            let pTrim = providerRun.Trim()
            let matches =
                records.Values
                |> Seq.filter (fun r ->
                    r.fence.sessionId = sTrim
                    && r.fence.providerRun = pTrim
                    && r.interruptTask.IsSome)
                |> Seq.sortBy (fun r -> r.sequence)
                |> Seq.toArray
            if matches.Length = 0 then None
            else matches[matches.Length - 1].interruptTask

    member _.dropSession(sessionId: string) : unit =
        if not (String.IsNullOrWhiteSpace sessionId) then
            let sTrim = sessionId.Trim()
            let toRemove =
                records
                |> Seq.filter (fun kv -> kv.Value.fence.sessionId = sTrim)
                |> Seq.map (fun kv -> kv.Key)
                |> Seq.toArray
            for k in toRemove do
                records.Remove k |> ignore

    member _.clear() : unit =
        records.Clear()
        sequence <- 0

    member _.confirmedFence(witness: obj, sessionId: string, physical: string) : DeliveryFence option =
        match LedgerInternal.parseWitness witness with
        | None -> None
        | Some (wSessionId, wProviderRun, wCallId, wPhysical) ->
            if wSessionId = sessionId && wPhysical = physical then
                Some { sessionId = sessionId; providerRun = wProviderRun; callId = wCallId }
            else
                None

    member this.tryFindDurableEstablished(witnesses: obj, sessionId: string, physicalInput: obj) : DeliveryFence option =
        if isNull witnesses || String.IsNullOrWhiteSpace sessionId then None
        else
            let sTrim = sessionId.Trim()
            match LedgerInternal.parsePhysical physicalInput with
            | None -> None
            | Some expectedPhysical ->
                let rawList = LedgerInternal.copyArray witnesses
                let confirmed =
                    rawList
                    |> Array.choose (fun item -> this.confirmedFence(item, sTrim, expectedPhysical))
                if confirmed.Length = 0 then None
                else Some confirmed[confirmed.Length - 1]

    member _.hasDurableEstablished(witnesses: obj, sessionId: string) : bool =
        if isNull witnesses || String.IsNullOrWhiteSpace sessionId then false
        else
            let sTrim = sessionId.Trim()
            let rawList = LedgerInternal.copyArray witnesses
            rawList
            |> Array.exists (fun item ->
                match LedgerInternal.parseWitness item with
                | Some (wSessionId, _, _, _) -> wSessionId = sTrim
                | None -> false)

let deliveryAttemptLedger = DeliveryAttemptLedger()
