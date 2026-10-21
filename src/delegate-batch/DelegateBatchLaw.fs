module Wanxiangli.DelegateBatch.DelegateBatchLaw

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArrayValue (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/delegate-batch: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private flag (what: string) (value: obj) : bool =
    if isBool value then unbox<bool> value else malformed what

let private texts (what: string) (value: obj) : string list =
    if not (isArrayValue value) then malformed what
    unbox<obj array> value |> Array.map (text (what + "[]")) |> Array.toList

let private frozenArray (items: string list) : obj = freeze (box (List.toArray items))

type private Batch =
    { ProviderRun: string
      CallOrder: string list
      CurrentCall: string }

type private Pending =
    { ProviderRun: string
      CallOrder: string list
      Received: string list }

let private batchOf (value: obj) : Batch option =
    if isAbsent value then
        None
    else
        if not (isObject value) then malformed "batch"
        Some
            { ProviderRun = text "batch.providerRun" (field value "providerRun")
              CallOrder = texts "batch.callOrder" (field value "callOrder")
              CurrentCall = text "batch.currentCall" (field value "currentCall") }

let private pendingOf (value: obj) : Pending option =
    if isAbsent value then
        None
    else
        if not (isObject value) then malformed "pending"
        Some
            { ProviderRun = text "pending.providerRun" (field value "providerRun")
              CallOrder = texts "pending.callOrder" (field value "callOrder")
              Received = texts "pending.received" (field value "received") }

let private reject (reason: string) =
    freeze (createObj [ "verdict" ==> "reject"; "reason" ==> reason ])

/// EXEC-026/031: a SyncDelegate semantic batch is defined by ProviderRun plus the
/// provider's tool-call order, never by scheduler timing. The caller keeps the
/// rendezvous buffers; this law decides admission of one invocation.
[<AttachMembers>]
type DelegateBatchLaw() =

    /// One invocation for one (owner scope, role) key.
    /// `active`: the key already has an admitted batch. `pending`: the
    /// incomplete batch buffered for the key (providerRun, callOrder, call ids
    /// already received) or null. `batch`: the invocation's batch identity
    /// (providerRun, callOrder, currentCall) or null for an ungrouped call.
    member _.admit(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let active = flag "active" (field input "active")
        let pending = pendingOf (field input "pending")
        let batch = batchOf (field input "batch")

        if active then
            reject "ActiveBatch"
        else
            match batch with
            | None ->
                match pending with
                | Some _ -> reject "BatchPending"
                | None -> freeze (createObj [ "verdict" ==> "single" ])
            | Some batch ->
                let order = batch.CallOrder

                if
                    List.isEmpty order
                    || List.length (List.distinct order) <> List.length order
                    || not (List.contains batch.CurrentCall order)
                then
                    reject "InvalidBatch"
                else
                    let resolved =
                        match pending with
                        | Some p when p.ProviderRun = batch.ProviderRun && p.CallOrder = order -> Ok(false, p.Received)
                        | Some _ -> Error "OtherRunPending"
                        | None -> Ok(true, [])

                    match resolved with
                    | Error reason -> reject reason
                    | Ok(_, received) when List.contains batch.CurrentCall received -> reject "DuplicateCall"
                    | Ok(opened, received) ->
                        let received = batch.CurrentCall :: received

                        if List.length (List.distinct received) <> List.length order then
                            freeze (createObj [ "verdict" ==> "wait"; "open" ==> opened ])
                        else
                            freeze (
                                createObj
                                    [ "verdict" ==> "ready"
                                      "open" ==> opened
                                      "order" ==> frozenArray order ]
                            )

    /// Which batch the Host-observed tool calls of one ProviderRun imply for the
    /// current call: the call ids of `role`, in Host order, when the current call
    /// is among them; otherwise null. `calls` are { role, callId } in Host order.
    member _.observedBatch(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let role = text "role" (field input "role")
        let current = text "currentCall" (field input "currentCall")
        let calls = field input "calls"
        if not (isArrayValue calls) then malformed "calls"

        let order =
            unbox<obj array> calls
            |> Array.toList
            |> List.choose (fun call ->
                if not (isObject call) then malformed "calls[]"
                let r = text "calls[].role" (field call "role")
                let id = text "calls[].callId" (field call "callId")
                if r = role then Some id else None)

        if List.contains current order then frozenArray order else null
