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
