module Wanxiangli.Compression.Compression

open System
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type CheckpointSettlementMessages =
    abstract observe: terminal: obj -> string
    abstract settle: call: obj * outcome: obj -> string

[<AllowNullLiteral>]
type CompressionMessages =
    abstract parseView: value: obj -> obj
    abstract parseCarry: value: obj -> obj
    abstract checkpoints: unit -> CheckpointSettlementMessages

let private fail (message: string) : 'a = raise (ArgumentException message)

[<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
let private descriptorOf (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
let private hasOwn (_value: obj) (_name: string) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("Reflect.ownKeys($0).every(key => key === 'prefixCount' || key === 'carry')")>]
let private hasOnlyViewFields (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'number' && Number.isInteger($0) && $0 >= 0 && $0 < 2147483647")>]
let private isNaturalNumber (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'object' && $0 !== null && !Array.isArray($0)")>]
let private isRecord (_value: obj) : bool = jsNative

let private isAbsent (value: obj) = isNull value || jsTypeof value = "undefined"

let private ownField (value: obj) (name: string) : obj option =
    let descriptor = descriptorOf value name

    if isAbsent descriptor then None
    elif not (hasOwn descriptor "value") then fail ("Accessor field is not accepted: " + name)
    else Some descriptor?value

let private requiredField (what: string) (value: obj) (name: string) : obj =
    if not (isRecord value) then
        fail (what + " must be an object")

    match ownField value name with
    | Some field -> field
    | None -> fail (what + "." + name + " is required")

let private invalid reason = freeze (createObj [ "ok" ==> false; "reason" ==> reason ])

let private carryOf value =
    if not (isArray value) then
        fail "carry must be an array of anchor numbers and literal strings"

    let length = (unbox<obj array> value).Length

    Array.init length (fun index ->
        match ownField value (string index) with
        | Some item when jsTypeof item = "string" || isNaturalNumber item -> item
        | Some _ -> fail (sprintf "carry[%d] must be a non-negative integer anchor or a literal string" index)
        | None -> fail "carry must not be sparse")
    |> box
    |> freeze

let private parseCarry value =
    freeze (createObj [ "ok" ==> true; "carry" ==> carryOf value ])

let private parseView value =
    if not (isRecord value) || not (hasOnlyViewFields value) then
        fail "view accepts only prefixCount and carry"

    let prefixCount = requiredField "view" value "prefixCount"

    if not (isNaturalNumber prefixCount) then
        fail "prefixCount must be a non-negative integer segment count"

    let carry = requiredField "view" value "carry" |> carryOf

    freeze (
        createObj
            [ "ok" ==> true
              "view" ==> freeze (createObj [ "prefixCount" ==> prefixCount; "carry" ==> carry ]) ]
    )

let private callKey (what: string) (value: obj) : string =
    let text name =
        let field = requiredField what value name

        if jsTypeof field <> "string" || String.IsNullOrEmpty(unbox<string> field) then
            fail (what + "." + name + " must be a non-empty string")

        unbox<string> field

    let session = text "session"
    let callId = text "callId"
    string session.Length + ":" + session + "|" + callId

let private checkpointSettlement () : CheckpointSettlementMessages =
    let settled = System.Collections.Generic.HashSet<string>()
    let pending = System.Collections.Generic.HashSet<string>()

    { new CheckpointSettlementMessages with
        member _.observe(terminal) =
            let key = callKey "terminal" terminal
            let status = requiredField "terminal" terminal "status"

            let completed =
                match (if jsTypeof status = "string" then unbox<string> status else "") with
                | "completed" -> true
                | "error" -> false
                | _ -> fail "terminal.status must be completed or error"

            if pending.Contains key then "join"
            elif not (settled.Add key) then "skip"
            elif completed then
                pending.Add key |> ignore
                "append"
            else
                "skip"

        member _.settle(call, outcome) =
            let key = callKey "call" call

            if not (pending.Contains key) then
                fail "call has no pending checkpoint append"

            match (if jsTypeof outcome = "string" then unbox<string> outcome else "") with
            | "committed" ->
                pending.Remove key |> ignore
                "settled"
            | "WriterUnavailable" ->
                pending.Remove key |> ignore
                settled.Remove key |> ignore
                "released"
            | "WriteUnknown"
            | "NoNewWriteReleaseFailed"
            | "FactRejected" -> "failed"
            | _ -> fail "outcome must be committed, WriterUnavailable, WriteUnknown, NoNewWriteReleaseFailed or FactRejected" }

let private receipt parser value =
    try
        parser value
    with :? ArgumentException as error ->
        invalid error.Message

let Compression () : CompressionMessages =
    { new CompressionMessages with
        member _.parseView(value) = receipt parseView value
        member _.parseCarry(value) = receipt parseCarry value
        member _.checkpoints() = checkpointSettlement () }
