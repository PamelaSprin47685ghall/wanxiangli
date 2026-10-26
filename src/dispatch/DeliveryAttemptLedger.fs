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
    let isArray (value: obj) : bool = jsNative

    [<Emit("Array.isArray($0) ? Array.from($0) : []")>]
    let copyArray (x: obj) : obj array = jsNative

    [<Emit("typeof $0 === 'object' && $0 !== null")>]
    let isObject (x: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (x: obj) : bool = jsNative

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
            let sid =
                if not (isNull fenceObj?sessionId) then string fenceObj?sessionId
                elif not (isNull fenceObj?SessionId) then string fenceObj?SessionId
                else ""
            let pr =
                if not (isNull fenceObj?providerRun) then string fenceObj?providerRun
                elif not (isNull fenceObj?ProviderRun) then string fenceObj?ProviderRun
                else ""
            let cid =
                if not (isNull fenceObj?callId) then string fenceObj?callId
                elif not (isNull fenceObj?CallId) then string fenceObj?CallId
                elif not (isNull fenceObj?toolCallId) then string fenceObj?toolCallId
                elif not (isNull fenceObj?ToolCallId) then string fenceObj?ToolCallId
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
            let p =
                if not (isNull physicalInput?physicalUserMessageId) then string physicalInput?physicalUserMessageId
                elif not (isNull physicalInput?PhysicalUserMessageId) then string physicalInput?PhysicalUserMessageId
                elif not (isNull physicalInput?value) then string physicalInput?value
                elif not (isNull physicalInput?Value) then string physicalInput?Value
                else ""
            let pTrim = p.Trim()
            if String.IsNullOrWhiteSpace pTrim || pTrim = "undefined" || pTrim = "null" then None
            else Some pTrim
        else None

    let parseWitness (witness: obj) : (string * string * string * string) option =
        if isNull witness || not (isObject witness) then None
        else
            let sid =
                if not (isNull witness?sessionId) then string witness?sessionId
                elif not (isNull witness?SessionId) then string witness?SessionId
                else ""
            let pr =
                if not (isNull witness?providerRun) then string witness?providerRun
                elif not (isNull witness?ProviderRun) then string witness?ProviderRun
                else ""
            let cid =
                if not (isNull witness?callId) then string witness?callId
                elif not (isNull witness?CallId) then string witness?CallId
                elif not (isNull witness?toolCallId) then string witness?toolCallId
                elif not (isNull witness?ToolCallId) then string witness?ToolCallId
                else ""
            let phys =
                if not (isNull witness?physicalUserMessageId) then string witness?physicalUserMessageId
                elif not (isNull witness?PhysicalUserMessageId) then string witness?PhysicalUserMessageId
                elif not (isNull witness?physical) then string witness?physical
                elif not (isNull witness?Physical) then string witness?Physical
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
                records.[key] <-
                    { current with
                        physical = preservedPhysical
                        established = true
                        sequence = sequence }
                true
            | false, _ ->
                records.[key] <-
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
                records.[key] <-
                    { current with
                        presented = true
                        sequence = sequence }
                true
            | false, _ ->
                records.[key] <-
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
            else Some matches.[matches.Length - 1]

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
            records.[key] <-
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
            records.[key] <-
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
            else matches.[matches.Length - 1].interruptTask

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
                else Some confirmed.[confirmed.Length - 1]

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
