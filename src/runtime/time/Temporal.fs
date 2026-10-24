namespace Wanxiangli.Time

open System
open System.Threading.Tasks

/// 可取消的一次性截止句柄。取消后 Delay 永远保持未决，不触发回调。
/// 纯契约，不含 Node / setTimeout / Fable JS。
type IDeadlineHandle =
    abstract Delay: Task<unit>
    abstract Cancel: unit -> unit

/// 中央延迟能力：生产为 Node 定时器，测试为虚拟时钟。
/// 长（≥1000ms）延迟在物理适配器中可 unref，避免拖住干净退出的进程。
type ITimerPort =
    abstract Delay: milliseconds: int -> IDeadlineHandle
    abstract Dispose: unit -> unit

/// 可注入的墙钟。业务只消费注入实例，不直接读 UtcNow。
type IClockPort =
    abstract UtcNow: unit -> DateTimeOffset
