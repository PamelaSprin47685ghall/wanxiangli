module Wanxiangli.Time.Time

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Time

/// JS 定时器等待上限（毫秒）。超过此值的等待必须由调用方分段。
let private maxTimerWaitMs: int = Deadline.MaxTimerWaitMs

let private parseIso (value: string) : DateTimeOffset = DateTimeOffset.Parse(value)

/// Deadline 保持不透明：JS 面只接受 ISO 时刻与毫秒预算，返回不透明句柄，
/// 读取走 remainingMs / isExpired / nextWaitMs。
let private deadlineCreate (nowIso: string) (budgetMs: float) : Deadline =
    Deadline.ofBudget (parseIso nowIso) (TimeSpan.FromMilliseconds budgetMs)

let private deadlineRemainingMs (nowIso: string) (deadline: Deadline) : float =
    (Deadline.remaining (fun () -> parseIso nowIso) deadline).TotalMilliseconds

let private deadlineIsExpired (nowIso: string) (deadline: Deadline) : bool =
    Deadline.isExpired (fun () -> parseIso nowIso) deadline

let private deadlineNextWaitMs (nowIso: string) (deadline: Deadline) : int =
    Deadline.nextWaitMs (fun () -> parseIso nowIso) deadline

/// 物理定时器端口：本库唯一封装 setTimeout / clearTimeout 的实例。
let private nodeTimerPort () : ITimerPort = NodeTiming.nodeTimerPort ()

/// 物理墙钟端口：本库唯一读取系统 UtcNow 的实例。
let private nodeClockPort () : IClockPort = NodeTiming.nodeClockPort ()

/// 单次延迟任务；≥1000ms 的延迟 unref。
let private timerTask (milliseconds: int) : Task<unit> = NodeTiming.timerTask milliseconds

/// 竞争一个已有退出任务与延迟：退出先到返回 true，延迟先到返回 false。
let private raceExit (exitTask: Task) (milliseconds: int) : Task<bool> = NodeTiming.raceExit exitTask milliseconds

/// 确定性虚拟时基（验证专用）。生产组合层不得注入。
/// 返回 { port, advance, nowMs }；port 实现 ITimerPort（Delay / Dispose）。
let private virtualTimerPort () : obj =
    let instance = VirtualTiming.createVirtualTimerPort ()
    createObj [ "port", box instance.Port; "advance", box instance.Advance; "nowMs", box instance.NowMs ]

/// 确定性虚拟墙钟（验证专用）。返回 { port, advanceMs, set }。
let private virtualClockPort () : obj =
    let instance = VirtualTiming.createVirtualClockPort ()
    createObj [ "port", box instance.Port; "advanceMs", box instance.AdvanceMs; "set", box instance.Set ]

/// 具名导出容器：esbuild 静态绑定契约（export { Time }）。
/// 直接引用函数值（Fable 顶层多参 let 生成 uncurried JS 函数），
/// 不用显式 lambda —— curried lambda 会让 JS 双参调用拿到偏函数。
let Time: obj =
    createObj [
        "maxTimerWaitMs" ==> maxTimerWaitMs
        "deadlineCreate" ==> deadlineCreate
        "deadlineRemainingMs" ==> deadlineRemainingMs
        "deadlineIsExpired" ==> deadlineIsExpired
        "deadlineNextWaitMs" ==> deadlineNextWaitMs
        "nodeTimerPort" ==> nodeTimerPort
        "nodeClockPort" ==> nodeClockPort
        "timerTask" ==> timerTask
        "raceExit" ==> raceExit
        "virtualTimerPort" ==> virtualTimerPort
        "virtualClockPort" ==> virtualClockPort
    ]
