namespace Wanxiangli.DelegateBatch

open Fable.Core
open Fable.Core.JsInterop

module DelegateBatchLawCore =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBool (_value: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isAbsent (_value: obj) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArrayValue (_value: obj) : bool = jsNative

    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    let malformed (what: string) : 'T =
        raise (System.ArgumentException(sprintf "wanxiangli/delegate-batch: malformed %s" what))

    let text (what: string) (value: obj) : string =
        if isString value then unbox<string> value else malformed what

    let flag (what: string) (value: obj) : bool =
        if isBool value then unbox<bool> value else malformed what

    let texts (what: string) (value: obj) : string list =
        if not (isArrayValue value) then malformed what
        unbox<obj array> value |> Array.map (text (what + "[]")) |> Array.toList

    let frozenArray (items: string list) : obj = freeze (box (List.toArray items))

    type Batch =
        { ProviderRun: string
          CallOrder: string list
          CurrentCall: string }

    type Pending =
        { ProviderRun: string
          CallOrder: string list
          Received: string list }

    let batchOf (value: obj) : Batch option =
        if isAbsent value then
            None
        else
            if not (isObject value) then malformed "batch"
            Some
                { ProviderRun = text "batch.providerRun" (field value "providerRun")
                  CallOrder = texts "batch.callOrder" (field value "callOrder")
                  CurrentCall = text "batch.currentCall" (field value "currentCall") }

    let pendingOf (value: obj) : Pending option =
        if isAbsent value then
            None
        else
            if not (isObject value) then malformed "pending"
            Some
                { ProviderRun = text "pending.providerRun" (field value "providerRun")
                  CallOrder = texts "pending.callOrder" (field value "callOrder")
                  Received = texts "pending.received" (field value "received") }

    let reject (reason: string) =
        freeze (createObj [ "verdict" ==> "reject"; "reason" ==> reason ])

[<AttachMembers>]
type DelegateBatchLawCore() =

    member _.admit(input: obj) : obj =
        if not (DelegateBatchLawCore.isObject input) then DelegateBatchLawCore.malformed "input"
        let active = DelegateBatchLawCore.flag "active" (DelegateBatchLawCore.field input "active")
        let pending = DelegateBatchLawCore.pendingOf (DelegateBatchLawCore.field input "pending")
        let batch = DelegateBatchLawCore.batchOf (DelegateBatchLawCore.field input "batch")

        if active then
            DelegateBatchLawCore.reject "ActiveBatch"
        else
            match batch with
            | None ->
                match pending with
                | Some _ -> DelegateBatchLawCore.reject "BatchPending"
                | None -> DelegateBatchLawCore.freeze (createObj [ "verdict" ==> "single" ])
            | Some batch ->
                let order = batch.CallOrder

                if
                    List.isEmpty order
                    || List.length (List.distinct order) <> List.length order
                    || not (List.contains batch.CurrentCall order)
                then
                    DelegateBatchLawCore.reject "InvalidBatch"
                else
                    let resolved =
                        match pending with
                        | Some p when p.ProviderRun = batch.ProviderRun && p.CallOrder = order -> Ok(false, p.Received)
                        | Some _ -> Error "OtherRunPending"
                        | None -> Ok(true, [])

                    match resolved with
                    | Error reason -> DelegateBatchLawCore.reject reason
                    | Ok(_, received) when List.contains batch.CurrentCall received -> DelegateBatchLawCore.reject "DuplicateCall"
                    | Ok(opened, received) ->
                        let received = batch.CurrentCall :: received

                        if List.length (List.distinct received) <> List.length order then
                            DelegateBatchLawCore.freeze (createObj [ "verdict" ==> "wait"; "open" ==> opened ])
                        else
                            DelegateBatchLawCore.freeze (
                                createObj
                                    [ "verdict" ==> "ready"
                                      "open" ==> opened
                                      "order" ==> DelegateBatchLawCore.frozenArray order ]
                            )

    member _.observedBatch(input: obj) : obj =
        if not (DelegateBatchLawCore.isObject input) then DelegateBatchLawCore.malformed "input"
        let role = DelegateBatchLawCore.text "role" (DelegateBatchLawCore.field input "role")
        let current = DelegateBatchLawCore.text "currentCall" (DelegateBatchLawCore.field input "currentCall")
        let calls = DelegateBatchLawCore.field input "calls"
        if not (DelegateBatchLawCore.isArrayValue calls) then DelegateBatchLawCore.malformed "calls"

        let order =
            unbox<obj array> calls
            |> Array.toList
            |> List.choose (fun call ->
                if not (DelegateBatchLawCore.isObject call) then DelegateBatchLawCore.malformed "calls[]"
                let r = DelegateBatchLawCore.text "calls[].role" (DelegateBatchLawCore.field call "role")
                let id = DelegateBatchLawCore.text "calls[].callId" (DelegateBatchLawCore.field call "callId")
                if r = role then Some id else None)

        if List.contains current order then DelegateBatchLawCore.frozenArray order else null
