namespace Wanxiangli.Wait

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core.JsInterop

/// 双通道完成邮箱（泛型版）。'agent 与 'pty 的类型参数由组合者特化，
/// 本库不绑定任何业务标识类型。
/// agent 通道只携带唤醒（无载荷）；pty 通道是物理完成队列，唯一写入者是后端 onExit。
type CompletionMailbox<'agent, 'pty>(gate: obj) =
    let agentWakes = Queue<'agent>()
    let ptyCompletions = Queue<'pty>()
    let waiters = Queue<TaskCompletionSource<MailboxWakeReason>>()
    let mutable cancelled = false

    let wakeAll (reason: MailboxWakeReason) =
        [ while waiters.Count > 0 do
              yield waiters.Dequeue() ]
        |> List.iter (fun waiter ->
            try
                waiter.SetResult(reason)
            with _ ->
                ())

    let enqueueWaiter () =
        let waiter =
            TaskCompletionSource<MailboxWakeReason>(TaskCreationOptions.RunContinuationsAsynchronously)

        waiters.Enqueue waiter
        waiter

    let hasQueued () =
        agentWakes.Count > 0 || ptyCompletions.Count > 0

    let drainQueue (q: Queue<'T>) maxCount =
        [ let mutable n = 0

          while n < maxCount && q.Count > 0 do
              n <- n + 1
              yield q.Dequeue() ]

    /// agent 唤醒：不携带完成载荷。
    member _.PulseAgentHandle(handle: 'agent) =
        lock gate (fun () ->
            if not cancelled then
                agentWakes.Enqueue handle
                wakeAll CompletionMayBeAvailable)

    /// pty 物理完成：pty 事实的唯一邮箱路径。
    member _.PublishPtyCompletion(item: 'pty) =
        lock gate (fun () ->
            if not cancelled then
                ptyCompletions.Enqueue item
                wakeAll CompletionMayBeAvailable)

    /// 假性唤醒：丢弃等待者，外层 journal/用户竞争不会堆积它们。
    /// 安全——调用者唤醒后总是重新排空。
    member _.PulseWake() =
        lock gate (fun () ->
            if cancelled then
                wakeAll MailboxCancelled
            else
                wakeAll CompletionMayBeAvailable)

    /// 只等 Publish/Pulse/Cancel（无用户中断）。外层再与 journal 变化、
    /// 本地中断竞争。
    member _.WaitForWake() : Task<MailboxWakeReason> =
        let pending =
            lock gate (fun () ->
                if cancelled then Choice1Of2 MailboxCancelled
                elif hasQueued () then Choice1Of2 CompletionMayBeAvailable
                else Choice2Of2(enqueueWaiter ()))

        match pending with
        | Choice1Of2 reason -> Task.FromResult reason
        | Choice2Of2 waiter -> waiter.Task

    /// 等待完成信号、类型化本地中断或永久取消。
    member this.WaitForSignal(interrupt: Task<JoinInterruptReason>) : Task<MailboxWakeReason> =
        // 先订阅唤醒再挂中断，保留就绪信号优先级。
        let tagWake (reason: MailboxWakeReason) : Choice<MailboxWakeReason, JoinInterruptReason> = Choice1Of2 reason

        let tagInterrupt (reason: JoinInterruptReason) : Choice<MailboxWakeReason, JoinInterruptReason> =
            Choice2Of2 reason

        let wakeChoice: Task<Choice<MailboxWakeReason, JoinInterruptReason>> =
            emitJsExpr (this.WaitForWake(), tagWake) "$0.then($1)"

        let interruptChoice: Task<Choice<MailboxWakeReason, JoinInterruptReason>> =
            emitJsExpr (interrupt, tagInterrupt) "$0.then($1)"

        let decideSignal (outcome: Choice<MailboxWakeReason, JoinInterruptReason>) : MailboxWakeReason =
            match outcome with
            | Choice1Of2 wakeReason -> wakeReason
            | Choice2Of2 interruptReason ->
                // 本地中断胜出：丢弃仍挂起的邮箱等待者。
                this.PulseWake()
                LocalInterrupt interruptReason

        task {
            let! (winner: Choice<MailboxWakeReason, JoinInterruptReason>) =
                emitJsExpr (wakeChoice, interruptChoice) "Promise.race([$0, $1])"

            return decideSignal winner
        }

    /// 排空 agent 唤醒令牌（无载荷）。唤醒后调用者重读事实源。
    member _.DrainAgentWakes(maxCount: int) : 'agent list =
        if maxCount <= 0 then
            []
        else
            lock gate (fun () -> drainQueue agentWakes maxCount)

    /// 有界排空排队的 pty 事实。
    member _.DrainPtyCompletions(maxCount: int) : 'pty list =
        if maxCount <= 0 then
            []
        else
            lock gate (fun () -> drainQueue ptyCompletions maxCount)

    /// 仅生命周期终止，不是工具调用中止。
    member _.Cancel() =
        lock gate (fun () ->
            if cancelled then
                false
            else
                cancelled <- true
                wakeAll MailboxCancelled
                true)

    member _.PendingCount = lock gate (fun () -> agentWakes.Count + ptyCompletions.Count)

    member _.PendingPtyCount = lock gate (fun () -> ptyCompletions.Count)
    member _.PendingAgentWakeCount = lock gate (fun () -> agentWakes.Count)
    member _.IsCancelled = lock gate (fun () -> cancelled)

    interface ICompletionMailbox<'agent, 'pty, JoinInterruptReason, MailboxWakeReason> with
        member this.PulseAgent handle = this.PulseAgentHandle handle
        member this.PublishPty item = this.PublishPtyCompletion item
        member this.PulseWake() = this.PulseWake()
        member this.WaitForWake() = this.WaitForWake()
        member this.WaitForSignal interrupt = this.WaitForSignal interrupt
        member this.DrainAgents maxCount = this.DrainAgentWakes maxCount
        member this.DrainPtys maxCount = this.DrainPtyCompletions maxCount
        member this.Cancel() = this.Cancel()
        member this.PendingCount = this.PendingCount
        member this.PendingPtyCount = this.PendingPtyCount
        member this.IsCancelled = this.IsCancelled

module CompletionMailboxRuntime =
    let create (gate: obj) : ICompletionMailbox<'agent, 'pty, JoinInterruptReason, MailboxWakeReason> =
        CompletionMailbox<'agent, 'pty>(gate)
