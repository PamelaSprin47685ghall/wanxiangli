namespace Wanxiangli.Time

open System

type Deadline = private Deadline of expiresAt: DateTimeOffset

module Deadline =

    /// JS/Int32 定时器上限：超过此值的 setTimeout 会被运行时钳制或拒绝，
    /// 更长的等待必须分段。0x7FFFFFFF ms（约 24.8 天）。
    ///
    /// 普通 `let` 而非 [<Literal>]：Fable 会内联 literal 且不发射导出，
    /// 测试就读不到它必须断言的这个上界。
    let MaxTimerWaitMs = 2_147_483_647

    /// 由当前时刻与预算构造截止时间，钳制到 DateTimeOffset.MaxValue，
    /// 计算不溢出。
    let ofBudget (now: DateTimeOffset) (budget: TimeSpan) : Deadline =
        let safeBudget =
            try
                let maxBudget = DateTimeOffset.MaxValue - now
                if budget > maxBudget then maxBudget else budget
            with _ ->
                budget

        Deadline(now.Add(safeBudget))

    let remaining (clock: unit -> DateTimeOffset) (Deadline expiresAt: Deadline) : TimeSpan =
        let rem = expiresAt - clock ()
        if rem < TimeSpan.Zero then TimeSpan.Zero else rem

    let isExpired (clock: unit -> DateTimeOffset) (Deadline expiresAt: Deadline) : bool = clock () >= expiresAt

    /// 对绝对截止时间的下一段等待毫秒数，封顶在 JS 定时器上限。
    /// 极大合法预算（数十天）返回封顶值而不是溢出 int，调用方分段等待。
    let private capWaitMs total =
        if total > int64 MaxTimerWaitMs then
            MaxTimerWaitMs
        else
            int total

    let nextWaitMs (clock: unit -> DateTimeOffset) (Deadline expiresAt: Deadline) : int =
        let rem = expiresAt - clock ()

        if rem <= TimeSpan.Zero then
            0
        else
            capWaitMs (int64 rem.TotalMilliseconds)
