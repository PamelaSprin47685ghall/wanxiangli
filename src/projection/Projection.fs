module Wanxiangli.Projection.Projection

open System
open Fable.Core
open Fable.Core.JsInterop

/// 请求投影的信息边界。消息从哪里来、游标怎样观测、保留下来的原消息怎样写回宿主线格式，由组合者决定。
[<AllowNullLiteral>]
type ProjectionMessages =
    /// 任期过滤：按已提交屏障切掉触发调用及其结果和更早的消息，只留后任。
    abstract tenure: messages: obj * barrier: obj -> obj
    /// 意图规划与渲染布局：去重、冲突裁决、规范排序，给出输出每一行的来源。
    abstract layout: intents: obj * baseLength: obj -> obj
    /// 只规划：去重、冲突裁决、规范顺序；不校验锚点范围。
    abstract plan: intents: obj -> obj
    /// 退休 attempt 判定：一次请求是否仍属于已被 Relayed 退休、带投影切点的 attempt。
    abstract retired: request: obj -> obj
    /// provider 线格式投影的规范字节（含 callId，同一会话内逐字节比较、封印摘要的原文）。
    abstract wire: projection: obj -> obj
    /// 一条线格式消息的规范字节（追加律逐条比较的单位）。
    abstract wireMessage: message: obj -> obj
    /// 语义投影的规范字节（不含任何 callId，跨会话比较、截止摘要的原文）。
    abstract semantic: projection: obj -> obj

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
      Cursor: obj option
      ToolCallId: string option
      ResultFor: string option
      TenureId: string option }

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

    let cursorDescriptor = descriptorOf value "cursor"

    let cursorValue =
        if isAbsent cursorDescriptor then None
        else
            let cursor = field what value "cursor"

            if isAbsent cursor then None
            elif isCursor cursor then Some cursor
            else fail (what + ".cursor must be a nonnegative bigint or null")

    if cursorValue.IsSome && not identified then
        fail (what + ".cursor requires a Host message id")

    let attribution name =
        let descriptor = descriptorOf value name

        if isAbsent descriptor then
            fail (what + "." + name + " is required")

        let item = field what value name

        if isAbsent item then None
        elif jsTypeof item = "string" && not (String.IsNullOrEmpty(unbox<string> item)) then Some(unbox<string> item)
        else fail (what + "." + name + " must be a non-empty string or null")

    { Identified = identified
      Role = unbox<string> role
      Synthetic = flag what value "synthetic"
      Semantic = flag what value "semantic"
      Cursor = cursorValue
      ToolCallId = attribution "toolCallId"
      ResultFor = attribution "resultFor"
      TenureId = attribution "tenureId" }

let private barrierOf (value: obj) =
    if not (isRecord value) then
        fail "Tenure barrier must be an object"

    let read name =
        let item = field "barrier" value name

        if isAbsent item || jsTypeof item <> "string" || String.IsNullOrEmpty(unbox<string> item) then
            fail ("barrier." + name + " must be a non-empty string")

        unbox<string> item

    read "toolCallId", read "successorTenureId"

/// 切点是触发调用与其结果中较晚的那一条。切点及其之前的其余内容都不可见。
/// 之后只保留标明同一后任、且不是合成行的消息。宿主 id 和游标都不能单独放行。
/// 用户消息（role=user 且不是合成行）不论在切点前后、属于哪个任期，都留给后任；
/// 触发接力的那次 review 调用与它的结果也留给后任。
let private tenureKept (messages: obj) (barrier: obj) : obj =
    let toolCallId, successor = barrierOf barrier
    let parsed = snapshot "messages" messages |> Array.mapi tenureMessageOf

    let indexOf predicate =
        parsed |> Array.tryFindIndex predicate

    match indexOf (fun message -> message.ToolCallId = Some toolCallId), indexOf (fun message -> message.ResultFor = Some toolCallId) with
    | Some callAt, Some resultAt ->
        let cut = max callAt resultAt

        parsed
        |> Array.indexed
        |> Array.choose (fun (index, message) ->
            let user = message.Role.ToLowerInvariant() = "user"

            if message.Synthetic then None
            elif user || index = callAt || index = resultAt then Some(box index)
            elif index <= cut || message.TenureId <> Some successor then None
            else Some(box index))
        |> box
        |> freeze
    | _ -> box ([||]: obj array) |> freeze

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

// ── 退休 attempt 的请求归属 ─────────────────────────────────────────────

type private RequestMessage =
    { User: bool
      Id: string option
      Cut: bool
      Accepted: string option }

let private optionalText (what: string) (value: obj) (name: string) : string option =
    let item = field what value name

    if isAbsent item then None
    elif jsTypeof item = "string" && not (String.IsNullOrEmpty(unbox<string> item)) then Some(unbox<string> item)
    else fail (what + "." + name + " must be a non-empty string or null")

let private requestMessageOf (index: int) (value: obj) : RequestMessage =
    let what = "messages[" + string index + "]"

    if not (isRecord value) then
        fail (what + " must be an object")

    let role = field what value "role"

    let user =
        if isAbsent role then false
        elif jsTypeof role = "string" then (unbox<string> role).ToLowerInvariant() = "user"
        else fail (what + ".role must be a string or null")

    { User = user
      Id = optionalText what value "id"
      Cut = flag what value "cut"
      Accepted = optionalText what value "accepted" }

/// 只有 Relayed 退休且带投影切点时才可能过时。请求归属后任（不过时）当且仅当：
/// 最后一条 user 消息有宿主 id，并且（它在切点之后且是会话当前逻辑运行的根；或它是该退休的
/// 门控 nudge 被接纳的物理消息；或它在切点之后且本请求已被接纳），或者切点已不在线格式中、
/// 它带有的 ChatExecution 接纳证据的根正是当前逻辑运行的根。切点 = 第一条带切点工具调用/结果的消息。
let private retiredOf (request: obj) : obj =
    if not (isRecord request) then
        fail "request must be an object"

    let relayed = flag "request" request "relayed"
    let acceptedRequest = flag "request" request "acceptedRequest"
    let activeRoot = optionalText "request" request "activeRoot"
    let gatePhysical = optionalText "request" request "gatePhysical"

    let messages =
        snapshot "request.messages" (field "request" request "messages")
        |> Array.mapi requestMessageOf

    let lastUser = messages |> Array.tryFindIndexBack (fun message -> message.User)
    let cutIndex = messages |> Array.tryFindIndex (fun message -> message.Cut)
    let last = lastUser |> Option.map (fun index -> messages[index])
    let physical = last |> Option.bind (fun message -> message.Id)

    let afterCut =
        match lastUser, cutIndex with
        | Some user, Some cut -> user > cut
        | _ -> false

    let freshRoot = if afterCut then activeRoot else None

    let successor =
        match physical with
        | Some current -> freshRoot = Some current || gatePhysical = Some current || (afterCut && acceptedRequest)
        | None -> false

    let acceptedRun =
        cutIndex.IsNone
        && physical.IsSome
        && (match last |> Option.bind (fun message -> message.Accepted), activeRoot with
            | Some accepted, Some active -> accepted = active
            | _ -> false)

    box (relayed && not (successor || acceptedRun))

// ── provider 投影的规范字节 ────────────────────────────────────────────────
//
// 手写而非反射序列化：线格式字节会成为持久封印的摘要原文，语义字节会成为夹具键，
// 依赖升级不得改变其中任何一个。转义只处理 \\ " \n \r \t 五种（历史格式，逐字节保持）。

let private quote (text: string) =
    let escaped =
        text
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t")

    "\"" + escaped + "\""

let private jsonArray (items: string seq) = "[" + String.Join(",", items) + "]"
let private member' name value = quote name + ":" + value
let private jsonObject (fields: string list) = "{" + String.Join(",", fields) + "}"

let private text (what: string) (value: obj) (name: string) : string =
    let item = field what value name

    if jsTypeof item <> "string" then
        fail (what + "." + name + " must be a string")

    unbox<string> item

/// 缺省或 null 渲染为 null；字符串（含空串）原样渲染。
let private nullableText (what: string) (value: obj) (name: string) : string =
    let item = field what value name

    if isAbsent item then "null"
    elif jsTypeof item = "string" then quote (unbox<string> item)
    else fail (what + "." + name + " must be a string or null")

let private texts (what: string) (value: obj) (name: string) : string =
    let path = what + "." + name

    snapshot path (field what value name)
    |> Array.mapi (fun index item ->
        if jsTypeof item <> "string" then
            fail (path + "[" + string index + "] must be a string")

        quote (unbox<string> item))
    |> jsonArray

let private record (what: string) (value: obj) =
    if not (isRecord value) then
        fail (what + " must be an object")

/// 线格式部件必须带 callId；语义部件不得带 callId（两种投影不可混用）。
let private partBytes (identified: bool) (what: string) (part: obj) : string =
    record what part
    let kind = text what part "kind"
    let kindField = member' "kind" (quote kind)

    let callId () =
        if identified then
            [ member' "callId" (quote (text what part "callId")) ]
        elif not (isAbsent (field what part "callId")) then
            fail (what + " is a semantic part and must not carry a callId")
        else
            []

    match kind with
    | "text"
    | "reasoning" -> jsonObject [ kindField; member' "text" (quote (text what part "text")) ]
    | "tool-call" ->
        jsonObject (
            [ kindField ]
            @ callId ()
            @ [ member' "name" (quote (text what part "name"))
                member' "args" (quote (text what part "args")) ]
        )
    | "tool-result" -> jsonObject ([ kindField ] @ callId () @ [ member' "result" (quote (text what part "result")) ])
    | "media" ->
        jsonObject
            [ kindField
              member' "mediaType" (nullableText what part "mediaType")
              member' "contentDigest" (quote (text what part "contentDigest")) ]
    | other -> fail (what + ".kind is not a provider part kind: " + other)

let private messageBytes (identified: bool) (what: string) (message: obj) : string =
    record what message

    let parts =
        snapshot (what + ".parts") (field what message "parts")
        |> Array.mapi (fun index part -> partBytes identified (what + ".parts[" + string index + "]") part)

    jsonObject [ member' "role" (quote (text what message "role")); member' "parts" (jsonArray parts) ]

let private projectionBytes (identified: bool) (projection: obj) : string =
    let what = "projection"
    record what projection

    let messages =
        snapshot "projection.messages" (field what projection "messages")
        |> Array.mapi (fun index message -> messageBytes identified ("projection.messages[" + string index + "]") message)

    jsonObject
        [ member' "provider" (nullableText what projection "provider")
          member' "model" (nullableText what projection "model")
          member' "variant" (nullableText what projection "variant")
          member' "tools" (texts what projection "tools")
          member' "system" (texts what projection "system")
          member' "messages" (jsonArray messages) ]

/// 请求投影的纯规则。每条消息独立、无状态：先完整校验输入，再给出冻结的回答。
let Projection () : ProjectionMessages =
    { new ProjectionMessages with
        member _.tenure(messages, barrier) = tenureKept messages barrier
        member _.layout(intents, baseLength) = layoutOf intents baseLength
        member _.plan(intents) = planOf intents
        member _.retired(request) = retiredOf request
        member _.wire(projection) = box (projectionBytes true projection)
        member _.wireMessage(message) = box (messageBytes true "message" message)
        member _.semantic(projection) = box (projectionBytes false projection) }
