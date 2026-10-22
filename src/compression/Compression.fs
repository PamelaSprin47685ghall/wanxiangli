module Wanxiangli.Compression.Compression

open System
open Fable.Core
open Fable.Core.JsInterop

/// view 检查点的追加准入。组合者负责真正的持久写入与等待者的会合；本对象只回答
/// 这一次终态观测该做什么、这次写入结局之后这条调用是否还能再试。
[<AllowNullLiteral>]
type CheckpointSettlementMessages =
    abstract observe: terminal: obj -> string
    abstract settle: call: obj * outcome: obj -> string

/// ANCHOR 视图覆盖定律的公开消息。锚点编号从哪里来、正文怎样计量、摘要怎样呈现回宿主消息，由组合者决定。
[<AllowNullLiteral>]
type CompressionMessages =
    abstract parseView: value: obj -> obj
    abstract live: anchors: obj * history: obj -> obj
    abstract plan: anchors: obj * history: obj * view: obj -> obj
    abstract project: positions: obj * history: obj * prefixUntil: obj -> obj
    /// 新的 view 检查点追加准入台账（有状态，每个组合者进程一个）。
    abstract checkpoints: unit -> CheckpointSettlementMessages

type private Replacement =
    { Anchor: int
      Until: int
      Summary: string }

/// A mapped anchor is either kept as written, replaced by a summary, or
/// omitted. Omission is a decision: the interval is not carried forward.
type private Mapping =
    | Keep
    | Replace of string
    | Drop

type private View =
    { PrefixUntil: int
      ThenMap: (int * string option) list }

type private Entry =
    | Kept of index: int
    | Summarized of index: int * summary: string
    | Opening of summary: string

type private Row = { Position: int; Entry: Entry }

let private fail (message: string) : 'a = raise (ArgumentException message)

[<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
let private descriptorOf (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
let private hasOwn (_value: obj) (_name: string) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("Object.keys($0)")>]
let private keysOf (_value: obj) : string[] = jsNative

[<Emit("typeof $0 === 'number' && Number.isInteger($0) && $0 >= 0 && $0 < 2147483647")>]
let private isAnchorNumber (_value: obj) : bool = jsNative

[<Emit("$0 === null")>]
let private isNullValue (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'object' && $0 !== null && !Array.isArray($0)")>]
let private isRecord (_value: obj) : bool = jsNative

let private isAbsent (value: obj) = isNull value || jsTypeof value = "undefined"

/// 只读数据字段；accessor 在读取前被拒绝。缺失字段返回 None。
let private ownField (value: obj) (name: string) : obj option =
    let descriptor = descriptorOf value name

    if isAbsent descriptor then None
    elif not (hasOwn descriptor "value") then fail ("Accessor field is not accepted: " + name)
    else Some descriptor?value

/// 只接受真正的数组，并在读取任何元素前拍下快照，调用方之后改动不影响本次判断。
let private snapshot (what: string) (value: obj) : obj[] =
    if not (isArray value) then
        fail (what + " must be an array")
    else
        let items = unbox<obj[]> value

        Array.init items.Length (fun index ->
            match ownField value (string index) with
            | Some item -> item
            | None -> fail (what + " must not be sparse"))

let private anchorOf (what: string) (value: obj) : int =
    if isAnchorNumber value then
        int (unbox<float> value)
    else
        fail (what + " must be a non-negative integer anchor number")

let private requiredField (what: string) (value: obj) (name: string) : obj =
    if not (isRecord value) then
        fail (what + " must be an object")

    match ownField value name with
    | Some field -> field
    | None -> fail (what + "." + name + " is required")

let private anchorsOf (value: obj) : int list =
    snapshot "anchors" value |> Array.map (anchorOf "anchor") |> Array.toList

let private positionsOf (value: obj) : int list =
    snapshot "positions" value |> Array.map (anchorOf "position") |> Array.toList

let private replacementOf (value: obj) : Replacement =
    let summary = requiredField "replacement" value "summary"

    if jsTypeof summary <> "string" then
        fail "replacement.summary must be a string"

    { Anchor = anchorOf "replacement.anchor" (requiredField "replacement" value "anchor")
      Until = anchorOf "replacement.until" (requiredField "replacement" value "until")
      Summary = unbox<string> summary }

let private historyOf (value: obj) : Replacement list =
    snapshot "history" value |> Array.map replacementOf |> Array.toList

/// 已解析的声明：`thenMap` 为 `[anchor, summary | null]` 有序对。
let private viewOf (value: obj) : View =
    let pairOf (pair: obj) =
        let items = snapshot "thenMap entry" pair

        if items.Length <> 2 then
            fail "thenMap entry must be an [anchor, summary] pair"

        let summary = items[1]

        let text =
            if isNull summary then None
            elif jsTypeof summary = "string" then Some(unbox<string> summary)
            else fail "thenMap summary must be a string or null"

        anchorOf "thenMap anchor" items[0], text

    { PrefixUntil = anchorOf "view.prefixUntil" (requiredField "view" value "prefixUntil")
      ThenMap = snapshot "view.thenMap" (requiredField "view" value "thenMap") |> Array.map pairOf |> Array.toList }

let private replacementValue (change: Replacement) : obj =
    freeze (
        createObj
            [ "anchor" ==> change.Anchor
              "until" ==> change.Until
              "summary" ==> change.Summary ]
    )

let private frozenArray (items: obj list) : obj = freeze (box (List.toArray items))

// ---- 形状：view 声明 ----------------------------------------------------------

let private invalid (reason: string) : obj =
    freeze (createObj [ "ok" ==> false; "reason" ==> reason ])

let private pairFromRecord (source: obj) (key: string) : Result<int * string option, string> =
    match Int32.TryParse key with
    | true, anchor when anchor >= 0 && anchor < Int32.MaxValue && string anchor = key ->
        match ownField source key with
        | Some value when isNullValue value -> Ok(anchor, None)
        | Some value when jsTypeof value = "string" && not (String.IsNullOrWhiteSpace(unbox<string> value)) ->
            Ok(anchor, Some(unbox<string> value))
        | _ -> Error(sprintf "thenMap[%s] must be null or a non-blank summary string" key)
    | _ -> Error(sprintf "thenMap key '%s' must be a non-negative anchor number" key)

/// view 只接受 `{ prefixUntil, thenMap }`；错误只报第一处，原因文字与宿主原实现逐字一致。
let private parse (value: obj) : obj =
    if not (isRecord value) then
        invalid "view must contain prefixUntil and thenMap"
    elif keysOf value |> Array.exists (fun key -> key <> "prefixUntil" && key <> "thenMap") then
        invalid "view accepts only prefixUntil and thenMap"
    else
        let prefix = ownField value "prefixUntil" |> Option.defaultValue null
        let mapping = ownField value "thenMap" |> Option.defaultValue null

        if not (isAnchorNumber prefix) then
            invalid "prefixUntil is required and must be a non-negative integer anchor number"
        elif not (isRecord mapping) then
            invalid "thenMap is required and must map anchor numbers to summaries or null"
        else
            let parsed =
                keysOf mapping
                |> Array.toList
                |> List.map (pairFromRecord mapping)
                |> List.fold
                    (fun result pair ->
                        match result, pair with
                        | Ok pairs, Ok entry -> Ok(entry :: pairs)
                        | Error reason, _
                        | _, Error reason -> Error reason)
                    (Ok [])

            match parsed with
            | Error reason -> invalid reason
            | Ok pairs ->
                let thenMap =
                    pairs
                    |> List.sortBy fst
                    |> List.map (fun (anchor, summary) ->
                        freeze (box [| box anchor; (summary |> Option.map box |> Option.defaultValue null) |]))

                freeze (
                    createObj
                        [ "ok" ==> true
                          "view"
                          ==> freeze (
                              createObj
                                  [ "prefixUntil" ==> int (unbox<float> prefix)
                                    "thenMap" ==> frozenArray thenMap ]
                          ) ]
                )

// ---- 覆盖：存活分区与永久替换 -------------------------------------------------

/// 锚点 0 永远存活；被替换过的真实锚点退出，不复活。
let private liveAnchors (anchors: int list) (history: Replacement list) : int list =
    let removed = history |> List.map _.Anchor |> Set.ofList

    0
    :: (anchors
        |> List.filter (fun anchor -> anchor > 0 && not (Set.contains anchor removed)))
    |> List.distinct
    |> List.sort

/// 声明在本轮输入的存活分区上定位；边界在替换前拍下，后来的锚点不会落入旧替换。
/// 映射里的摘要替换该区间，`null` 原样保留，没写的区间不传下去。
let private planChanges (anchors: int list) (history: Replacement list) (view: View) : Replacement list =
    let surviving = liveAnchors anchors history
    let endOfInput = (anchors |> List.fold max 0) + 1
    let mapped = view.ThenMap |> Map.ofList

    let decision anchor =
        match Map.tryFind anchor mapped with
        | Some(Some text) -> Replace text
        | Some None -> Keep
        | None -> Drop

    let untilOf anchor =
        surviving
        |> List.tryFind (fun candidate -> candidate > anchor)
        |> Option.defaultValue endOfInput

    view.ThenMap
    |> List.choose (fun (anchor, summary) ->
        if anchor < view.PrefixUntil || not (List.contains anchor surviving) then
            None
        else
            summary
            |> Option.map (fun text ->
                { Anchor = anchor
                  Until =
                    untilOf anchor
                  Summary = text }))
    |> List.append (
        surviving
        |> List.filter (fun anchor -> anchor >= view.PrefixUntil)
        |> List.choose (fun anchor ->
            match decision anchor with
            | Drop ->
                Some
                    { Anchor = anchor
                      Until = untilOf anchor
                      Summary = "" }
            | Keep
            | Replace _ -> None)
    )
    |> List.sortBy _.Anchor

let private indexOf (entry: Entry) : int =
    match entry with
    | Kept index
    | Summarized(index, _) -> index
    | Opening _ -> fail "a real anchor cannot replace the opening row"

/// 一次替换覆盖它拍下的最新完整区间，连同区间内此前的摘要。
let private replace (rows: Row list) (change: Replacement) : Row list =
    let before = rows |> List.takeWhile (fun row -> row.Position < change.Anchor)
    let remaining = rows |> List.skip before.Length

    let covered, after =
        remaining |> List.partition (fun row -> row.Position < change.Until)

    match change.Anchor, covered with
    | 0, _ when change.Summary = "" -> before @ after
    | 0, _ ->
        before
        @ [ { Position = 0
              Entry = Opening change.Summary } ]
        @ after
    | _, [] -> rows
    | _, first :: _ ->
        if change.Summary = "" then
            before @ after
        else
            before
            @ [ { Position = change.Anchor
                  Entry = Summarized(indexOf first.Entry, change.Summary) } ]
            @ after

let private projectRows (positions: int list) (history: Replacement list) (prefixUntil: int) : obj =
    let rows =
        positions
        |> List.mapi (fun index position -> { Position = position; Entry = Kept index })

    let projected = history |> List.fold replace rows

    let entries =
        projected
        |> List.map (fun row ->
            let cached = row.Position < prefixUntil

            match row.Entry with
            | Kept index ->
                freeze (
                    createObj
                        [ "kind" ==> "kept"
                          "position" ==> row.Position
                          "index" ==> index
                          "cached" ==> cached ]
                )
            | Summarized(index, summary) ->
                freeze (
                    createObj
                        [ "kind" ==> "summarized"
                          "position" ==> row.Position
                          "index" ==> index
                          "summary" ==> summary
                          "cached" ==> cached ]
                )
            | Opening summary ->
                freeze (
                    createObj
                        [ "kind" ==> "opening"
                          "position" ==> 0
                          "summary" ==> summary
                          "cached" ==> cached ]
                ))

    let kept =
        projected
        |> List.sumBy (fun row ->
            match row.Entry with
            | Kept _ -> 1
            | _ -> 0)

    let opening =
        projected
        |> List.sumBy (fun row ->
            match row.Entry with
            | Opening _ -> 1
            | _ -> 0)

    freeze (
        createObj
            [ "entries" ==> frozenArray entries
              "kept" ==> kept
              "summarized" ==> projected.Length - kept
              "folded" ==> max 0 (positions.Length - projected.Length + opening)
              "replaced"
              ==> frozenArray (history |> List.map _.Anchor |> List.distinct |> List.sort |> List.map box) ]
    )

// ---- checkpoint：一次终态调用至多一次持久追加 -----------------------------------

let private callKey (what: string) (value: obj) : string =
    let text (name: string) =
        let field = requiredField what value name

        if jsTypeof field <> "string" || String.IsNullOrEmpty(unbox<string> field) then
            fail (what + "." + name + " must be a non-empty string")

        unbox<string> field

    let session = text "session"
    let callId = text "callId"
    string session.Length + ":" + session + "|" + callId

/// 有状态：每个实例只服务一个组合者进程；重启后由持久事实与 prefix 窗口去重承接。
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

/// ANCHOR 视图覆盖定律。每条消息独立、无状态：先完整校验输入，再给出冻结的回答；
/// 唯一例外是 `checkpoints()`，它每次返回一个新的有状态准入台账。
let Compression () : CompressionMessages =
    { new CompressionMessages with
        member _.parseView(value) =
            try
                parse value
            with :? ArgumentException as error ->
                invalid error.Message

        member _.live(anchors, history) =
            let anchorList = anchorsOf anchors
            liveAnchors anchorList (historyOf history) |> List.map box |> frozenArray

        member _.plan(anchors, history, view) =
            let anchorList = anchorsOf anchors
            let historyList = historyOf history
            planChanges anchorList historyList (viewOf view) |> List.map replacementValue |> frozenArray

        member _.project(positions, history, prefixUntil) =
            let positionList = positionsOf positions
            let historyList = historyOf history
            projectRows positionList historyList (anchorOf "prefixUntil" prefixUntil)

        member _.checkpoints() = checkpointSettlement () }
