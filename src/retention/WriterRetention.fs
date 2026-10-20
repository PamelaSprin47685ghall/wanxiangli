module Wanxiangli.Retention.WriterRetention

open Fable.Core
open Fable.Core.JsInterop

[<Emit("Number.isFinite($0)")>]
let private isFinite (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

let private dayMilliseconds = 24.0 * 60.0 * 60.0 * 1000.0

/// 非有限时间不是“很久以前”：把它当过期会删掉仍要服务的 writer，故直接拒绝。
let private requireTime (name: string) (value: obj) : float =
    if isFinite value then unbox<float> value
    else raise (System.ArgumentException(name + " must be a finite millisecond timestamp"))

let private utcDayOf (timeMs: float) = floor (timeMs / dayMilliseconds)

let private retained (nowMs: float) (lastActivityMs: float) =
    utcDayOf lastActivityMs >= utcDayOf nowMs - 1.0

[<Emit("(() => { try { return JSON.parse($0) } catch (_) { return undefined } })()")>]
let private tryParseJson (line: string) : obj = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isPlainObject (value: obj) : bool = jsNative

[<Emit("Date.parse($0)")>]
let private parseDateMs (value: string) : float = jsNative

[<Emit("$0[Symbol.iterator]()")>]
let private iteratorOf (value: obj) : obj = jsNative

[<Emit("$0 != null && typeof $0[Symbol.iterator] === 'function'")>]
let private isIterable (value: obj) : bool = jsNative

/// 尾行能说明什么活动。
type private TailKind =
    /// Journal 信封带有限的 ObservedAt：这就是 writer 的活动时刻。
    | Observed of float
    /// ProjectionCutTail 是前一条事实的整合元数据，自身不推进活动，须再往前看。
    | CutTail
    /// 其余一切（其它类型、无 ObservedAt、非有限时刻、坏 JSON）：尾部没有持久活动。
    | Silent

let private classify (line: string) : TailKind =
    let value = tryParseJson line
    if not (isPlainObject value) then Silent
    else
        match value?event_type with
        | eventType when isString eventType && unbox<string> eventType = "JournalEnvelope" ->
            let payload: obj = value?payload
            if not (isPlainObject payload) || not (isString payload?ObservedAt) then Silent
            else
                let observedAt = parseDateMs (unbox<string> payload?ObservedAt)
                if isFinite (box observedAt) then Observed observedAt else Silent
        | eventType when isString eventType && unbox<string> eventType = "ProjectionCutTail" -> CutTail
        | _ -> Silent

/// writer 保留规则（durable-convergence-011）：以最近活动时刻的 UTC 日期分组，今天与昨天保留，
/// 前天及更早整条过期。不读文件、不读时钟：截止时刻与活动时刻都由调用方给出。
[<AttachMembers>]
type WriterRetention() =
    /// 一个 UTC 日的毫秒数；只作 GC 分组单位，不携带历史语义。
    member _.dayMilliseconds = dayMilliseconds

    /// 时刻所在的 UTC 日序号（自 1970-01-01 起）。
    member _.utcDay(timeMs: obj) : float = utcDayOf (requireTime "timeMs" timeMs)

    member _.isRetained(nowMs: obj, lastActivityMs: obj) : bool =
        retained (requireTime "nowMs" nowMs) (requireTime "lastActivityMs" lastActivityMs)

    /// 同一截止时刻下筛出保留的 writer，保持输入顺序，按引用交还对象。
    /// 每个对象只读 `lastActivityMs`；整条保留或整条过期，不拆段。
    member _.retain(nowMs: obj, writers: obj) : obj array =
        let now = requireTime "nowMs" nowMs
        if not (isArray writers) then
            raise (System.ArgumentException "writers must be an array")
        unbox<obj array> writers
        |> Array.filter (fun writer ->
            if isNull writer then raise (System.ArgumentException "writer must be an object")
            retained now (requireTime "lastActivityMs" writer?lastActivityMs))

    /// 一条尾行的分类：`{ kind: 'observed', observedAtMs }`、`{ kind: 'cutTail' }` 或 `{ kind: 'silent' }`。
    member _.classifyTail(line: obj) : obj =
        if not (isString line) then raise (System.ArgumentException "line must be a string")
        match classify (unbox<string> line) with
        | Observed observedAt -> createObj [ "kind", box "observed"; "observedAtMs", box observedAt ]
        | CutTail -> createObj [ "kind", box "cutTail" ]
        | Silent -> createObj [ "kind", box "silent" ]

    /// writer 的持久活动时刻（durable-convergence-011）：从逻辑流最末一行起往前逐行看，
    /// 第一条 Journal ObservedAt 即是；连续的 ProjectionCutTail 可一路往前（跨段由调用方
    /// 把上一段的行接在后面）；遇到任何别的行、或行已读尽，就是“没有持久活动”，返回 null，
    /// 由调用方退回文件时间。只拉取需要的行：调用方可以惰性地逐行读盘。
    member _.lastActivity(linesNewestFirst: obj) : obj =
        if not (isIterable linesNewestFirst) then
            raise (System.ArgumentException "linesNewestFirst must be iterable")
        let iterator = iteratorOf linesNewestFirst
        // DSL-MUTABLE: algorithm-scratch — one pull loop; stops at the first verdict.
        let mutable verdict: obj option = None
        while verdict.IsNone do
            let step: obj = iterator?next ()
            if unbox<bool> step?``done`` then verdict <- Some null
            else
                let line: obj = step?value
                if not (isString line) then raise (System.ArgumentException "each line must be a string")
                match classify (unbox<string> line) with
                | Observed observedAt -> verdict <- Some(box observedAt)
                | CutTail -> ()
                | Silent -> verdict <- Some null
        verdict.Value
