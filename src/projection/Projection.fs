module Wanxiangli.Projection.Projection

open System
open Fable.Core
open Fable.Core.JsInterop

/// 请求投影的信息边界。消息从哪里来、游标怎样观测、保留下来的原消息怎样写回宿主线格式，由组合者决定。
[<AllowNullLiteral>]
type ProjectionMessages =
    /// 任期过滤：返回保留消息在输入中的下标（升序、冻结）。
    abstract tenure: messages: obj * openingCursor: obj -> obj
    /// 意图规划与渲染布局：去重、冲突裁决、规范排序，给出输出每一行的来源。
    abstract layout: intents: obj * baseLength: obj -> obj
    /// 只规划：去重、冲突裁决、规范顺序；不校验锚点范围。
    abstract plan: intents: obj -> obj

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

// ── 意图规划与渲染布局 ─────────────────────────────────────────────────────

[<Emit("Number.isSafeInteger($0) && $0 >= 0")>]
let private isCount (_value: obj) : bool = jsNative

[<Emit("$0 < $1 ? -1 : ($0 > $1 ? 1 : 0)")>]
let private ordinal (_a: string) (_b: string) : int = jsNative

type private Intent =
    { Position: int
      Replace: bool
      Key: string
      Anchor: int option
      Rows: int
      Fingerprint: string }

/// 同值判定：键、锚点、行数与所有者给出的行内容指纹全部相同。
let private sameValue (a: Intent) (b: Intent) =
    a.Replace = b.Replace
    && a.Key = b.Key
    && a.Anchor = b.Anchor
    && a.Rows = b.Rows
    && a.Fingerprint = b.Fingerprint

let private countField (what: string) (value: obj) (name: string) : int =
    let item = field what value name

    if not (isCount item) then
        fail (what + "." + name + " must be a nonnegative safe integer")

    unbox<int> item

let private stringField (what: string) (value: obj) (name: string) : string =
    let item = field what value name

    if jsTypeof item <> "string" then
        fail (what + "." + name + " must be a string")

    unbox<string> item

let private intentOf (index: int) (value: obj) : Intent =
    let what = "intents[" + string index + "]"

    if not (isRecord value) then
        fail (what + " must be an object")

    let kind = stringField what value "kind"

    let replace =
        match kind with
        | "ReplaceMessageBase" -> true
        | "InsertMessageRows" -> false
        | _ -> fail (what + ".kind must be ReplaceMessageBase or InsertMessageRows")

    let anchor = field what value "anchor"

    let anchorValue =
        if replace then
            if not (isAbsent anchor) then
                fail (what + ".anchor is not accepted on ReplaceMessageBase")

            None
        elif isAbsent anchor then
            None
        elif isCount anchor then
            Some(unbox<int> anchor)
        else
            fail (what + ".anchor must be null (append) or a nonnegative safe integer")

    { Position = index
      Replace = replace
      Key = stringField what value "key"
      Anchor = anchorValue
      Rows = countField what value "rows"
      Fingerprint = stringField what value "fingerprint" }

let private conflict (name: string) (key: string option) : obj =
    match key with
    | Some key -> freeze (createObj [ "ok" ==> false; "conflict" ==> name; "key" ==> key ])
    | None -> freeze (createObj [ "ok" ==> false; "conflict" ==> name ])

let private row (intent: obj) (index: int) : obj =
    freeze (createObj [ "intent" ==> intent; "row" ==> index ])

/// 规划：同批不同基底冲突；同键不同值冲突、同值幂等（首次出现为代表）；基底冲突优先，行冲突报最小 key。
/// 采用的插入按 anchor 升序、append 最后，再按 key 排列。不看锚点是否落在基底之内——那是布局的事。
let private planned (intents: obj) : Result<Intent option * Intent[], obj> =
    let parsed = snapshot "intents" intents |> Array.mapi intentOf
    let bases = parsed |> Array.filter (fun intent -> intent.Replace)

    let insertions =
        parsed
        |> Array.filter (fun intent -> not intent.Replace)
        |> Array.groupBy (fun intent -> intent.Key)
        |> Array.sortWith (fun (a, _) (b, _) -> ordinal a b)

    if bases.Length > 0 && not (bases |> Array.forall (sameValue bases[0])) then
        Error(conflict "ConflictingMessageBase" None)
    else
        match insertions |> Array.tryFind (fun (_, group) -> not (group |> Array.forall (sameValue group[0]))) with
        | Some(key, _) -> Error(conflict "ConflictingMessageRows" (Some key))
        | None ->
            let chosen =
                insertions
                |> Array.map (fun (_, group) -> group[0])
                |> Array.sortWith (fun a b ->
                    match a.Anchor, b.Anchor with
                    | Some x, Some y when x <> y -> compare x y
                    | Some _, None -> -1
                    | None, Some _ -> 1
                    | _ -> ordinal a.Key b.Key)

            Ok(Array.tryHead bases, chosen)

let private orderOf (replacement: Intent option) (chosen: Intent[]) : obj =
    Array.append (replacement |> Option.toArray) chosen
    |> Array.map (fun intent -> box intent.Position)
    |> box
    |> freeze

let private planOf (intents: obj) : obj =
    match planned intents with
    | Error refusal -> refusal
    | Ok(replacement, chosen) -> freeze (createObj [ "ok" ==> true; "order" ==> orderOf replacement chosen ])

/// 布局：锚点指向（替换后或原始）基底的下标，插在该行之前，互不移位；同一锚点按 key 序紧邻；
/// append 在全部锚定行之后按 key 序；锚点超出基底长度整次拒绝。
let private layoutOf (intents: obj) (baseLength: obj) : obj =
    if not (isCount baseLength) then
        fail "baseLength must be a nonnegative safe integer"

    match planned intents with
    | Error refusal -> refusal
    | Ok(replacement, chosen) ->
        let rowsOf (intent: Intent) =
            Array.init intent.Rows (fun index -> row (box intent.Position) index)

        let baseRows: obj[] =
            match replacement with
            | Some intent -> rowsOf intent
            | None -> Array.init (unbox<int> baseLength) (fun index -> row Unchecked.defaultof<obj> index)

        for intent in chosen do
            match intent.Anchor with
            | Some anchor when anchor > baseRows.Length ->
                fail (
                    "intents["
                    + string intent.Position
                    + "].anchor "
                    + string anchor
                    + " is past the end of the message base ("
                    + string baseRows.Length
                    + ")"
                )
            | _ -> ()

        let anchoredAt (position: int) =
            chosen
            |> Array.filter (fun intent -> intent.Anchor = Some position)
            |> Array.collect rowsOf

        let output =
            Array.append
                (Array.init (baseRows.Length + 1) (fun position ->
                    Array.append
                        (anchoredAt position)
                        (if position < baseRows.Length then [| baseRows[position] |] else [||]))
                 |> Array.concat)
                (chosen |> Array.filter (fun intent -> intent.Anchor.IsNone) |> Array.collect rowsOf)

        freeze (
            createObj
                [ "ok" ==> true
                  "order" ==> orderOf replacement chosen
                  "rows" ==> freeze (box output) ]
        )

/// 请求投影的纯规则。每条消息独立、无状态：先完整校验输入，再给出冻结的回答。
let Projection () : ProjectionMessages =
    { new ProjectionMessages with
        member _.tenure(messages, openingCursor) = tenureKept messages openingCursor
        member _.layout(intents, baseLength) = layoutOf intents baseLength
        member _.plan(intents) = planOf intents }
