module Wanxiangli.Projection.Projection

open System
open Fable.Core
open Fable.Core.JsInterop

/// 请求投影的信息边界。消息从哪里来、游标怎样观测、保留下来的原消息怎样写回宿主线格式，由组合者决定。
[<AllowNullLiteral>]
type ProjectionMessages =
    /// 任期过滤：返回保留消息在输入中的下标（升序、冻结）。
    abstract tenure: messages: obj * openingCursor: obj -> obj

let private fail (message: string) : 'a = raise (ArgumentException message)

[<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
let private descriptorOf (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
let private hasOwn (_value: obj) (_name: string) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'object' && $0 !== null && !Array.isArray($0)")>]
let private isRecord (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'bigint' && $0 >= 0n")>]
let private isCursor (_value: obj) : bool = jsNative

[<Emit("$0 >= $1")>]
let private atOrAfter (_cursor: obj) (_opening: obj) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private isAbsent (value: obj) = isNull value || jsTypeof value = "undefined"

/// 只读自有数据字段；accessor 不被读取，直接拒绝。
let private field (what: string) (value: obj) (name: string) : obj =
    let descriptor = descriptorOf value name

    if isAbsent descriptor then
        null
    elif not (hasOwn descriptor "value") then
        fail ("Accessor field is not accepted: " + what + "." + name)
    else
        descriptor?value

let private snapshot (what: string) (value: obj) : obj[] =
    if not (isArray value) then
        fail (what + " must be an array")

    let items = unbox<obj[]> value

    for index in 0 .. items.Length - 1 do
        if isAbsent (descriptorOf value (string index)) then
            fail (what + " must not be sparse")

    Array.init items.Length (fun index -> field what value (string index))

type private TenureMessage =
    { Identified: bool
      Role: string
      Synthetic: bool
      Semantic: bool
      Cursor: obj option }

let private flag (what: string) (value: obj) (name: string) : bool =
    let item = field what value name

    if jsTypeof item <> "boolean" then
        fail (what + "." + name + " must be a boolean")

    unbox<bool> item

let private tenureMessageOf (index: int) (value: obj) : TenureMessage =
    let what = "messages[" + string index + "]"

    if not (isRecord value) then
        fail (what + " must be an object")

    let id = field what value "id"

    let identified =
        if isAbsent id then false
        elif jsTypeof id = "string" && not (String.IsNullOrEmpty(unbox<string> id)) then true
        else fail (what + ".id must be a non-empty string or null")

    let role = field what value "role"

    if jsTypeof role <> "string" then
        fail (what + ".role must be a string")

    let cursor = field what value "cursor"

    let cursorValue =
        if isAbsent cursor then None
        elif isCursor cursor then Some cursor
        else fail (what + ".cursor must be a nonnegative bigint or null")

    if cursorValue.IsSome && not identified then
        fail (what + ".cursor requires a Host message id")

    { Identified = identified
      Role = unbox<string> role
      Synthetic = flag what value "synthetic"
      Semantic = flag what value "semantic"
      Cursor = cursorValue }

/// 一条 assistant/tool 交换只在首次观测严格早于本任期开场时剥离；有宿主 id 但尚未捕获的保留；
/// 没有宿主 id 又带语义内容是契约违约，不编造游标、不整体保留或丢弃。
let private keepsInteraction (opening: obj) (message: TenureMessage) =
    match message.Cursor, message.Identified, message.Semantic with
    | Some cursor, _, _ -> atOrAfter cursor opening
    | None, true, _ -> true
    | None, false, false -> false
    | None, false, true -> fail "Plan interaction has no stable XTrace message identity"

let private keeps (opening: obj) (message: TenureMessage) =
    match message.Synthetic, message.Role with
    | true, _ -> false
    | false, "user" -> true
    | false, "assistant"
    | false, "tool" -> keepsInteraction opening message
    | false, _ -> false

let private tenureKept (messages: obj) (openingCursor: obj) : obj =
    if not (isCursor openingCursor) then
        fail "Plan opening cursor must be a nonnegative bigint"

    let parsed = snapshot "messages" messages |> Array.mapi tenureMessageOf

    parsed
    |> Array.indexed
    |> Array.choose (fun (index, message) -> if keeps openingCursor message then Some(box index) else None)
    |> box
    |> freeze

/// 请求投影的纯规则。每条消息独立、无状态：先完整校验输入，再给出冻结的回答。
let Projection () : ProjectionMessages =
    { new ProjectionMessages with
        member _.tenure(messages, openingCursor) = tenureKept messages openingCursor }
