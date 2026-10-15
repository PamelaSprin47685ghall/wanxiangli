namespace Wanxiangli.Wait

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

/// 在真实 Task 周围登记诊断等待租约的括号辅助。
/// 业务次序不变：CE 挂起 → 观测 → Task 结算 → 释放。
module CausalAwait =

    let private classifyExn (exn: exn) : DiagnosticWaitExit =
        match exn with
        | :? OperationCanceledException -> DiagnosticWaitExit.WaitCancelled
        | :? TimeoutException -> DiagnosticWaitExit.WaitTimedOut
        | _ when exn.Message.Contains("cancel") || exn.Message.Contains("Cancel") -> DiagnosticWaitExit.WaitCancelled
        | _ when exn.Message.Contains("timed out") || exn.Message.Contains("Timeout") -> DiagnosticWaitExit.WaitTimedOut
        | _ -> DiagnosticWaitExit.WaitFailed

    let awaitTask (observer: IWaitObserver) (descriptor: DiagnosticWait) (pending: Task<'T>) : Task<'T> =
        task {
            use lease = observer.Enter descriptor

            try
                let! value = pending
                lease.MarkExit DiagnosticWaitExit.WaitResolved
                return value
            with ex ->
                lease.MarkExit(classifyExn ex)
                return raise ex
        }

    let awaitUnit (observer: IWaitObserver) (descriptor: DiagnosticWait) (pending: Task) : Task =
        task {
            use lease = observer.Enter descriptor

            try
                do! pending
                lease.MarkExit DiagnosticWaitExit.WaitResolved
            with ex ->
                lease.MarkExit(classifyExn ex)
                return raise ex
        }
        :> Task

    /// 主任务对抗预构建的 escape 败者任务；呈现为一个复合等待。
    /// Fable Task 没有 WhenAny，用 Promise.race。
    let race
        (observer: IWaitObserver)
        (descriptor: DiagnosticWait)
        (primary: Task<'T>)
        (escape: Task<DiagnosticWaitExit>)
        : Task<Result<'T, DiagnosticWaitExit>> =
        task {
            use lease = observer.Enter descriptor

            let taggedPrimary: Task<obj> =
                task {
                    let! value = primary
                    return box (Choice1Of2 value)
                }

            let taggedEscape: Task<obj> =
                task {
                    let! exit = escape
                    return box (Choice2Of2 exit)
                }

            let! winnerObj = emitJsExpr (taggedPrimary, taggedEscape) "Promise.race([$0, $1])": Task<obj>

            match unbox<Choice<'T, DiagnosticWaitExit>> winnerObj with
            | Choice1Of2 value ->
                lease.MarkExit DiagnosticWaitExit.WaitResolved
                return Ok value
            | Choice2Of2 exit ->
                lease.MarkExit exit
                return Error exit
        }

    /// 机制词汇：先 tryRead；否则让一个真实信号对抗一个 IDeadlineHandle。
    /// 信号胜出 → 重读（同一截止时间）。到期 → Error WaitTimedOut。
    /// 没有分段定时器、没有轮询间隔、没有 UtcNow 循环。
    let untilSignalOrDeadline
        (observer: IWaitObserver)
        (descriptor: DiagnosticWait)
        (deadline: IDeadlineHandle)
        (tryRead: unit -> 'T option)
        (awaitSignal: unit -> Task<unit>)
        : Task<Result<'T, DiagnosticWaitExit>> =
        task {
            use lease = observer.Enter descriptor

            let interpretWinner continueLoop winnerObj =
                task {
                    match unbox<Choice<unit, unit>> winnerObj with
                    | Choice1Of2() -> return! continueLoop ()
                    | Choice2Of2() ->
                        lease.MarkExit DiagnosticWaitExit.WaitTimedOut
                        return Error DiagnosticWaitExit.WaitTimedOut
                }

            let rec loop () =
                task {
                    match tryRead () with
                    | Some value ->
                        deadline.Cancel()
                        lease.MarkExit DiagnosticWaitExit.WaitResolved
                        return Ok value
                    | None ->
                        let taggedSignal: Task<obj> =
                            task {
                                do! awaitSignal ()
                                return box (Choice1Of2())
                            }

                        let taggedDeadline: Task<obj> =
                            task {
                                do! deadline.Delay
                                return box (Choice2Of2())
                            }

                        let! winnerObj = emitJsExpr (taggedSignal, taggedDeadline) "Promise.race([$0, $1])": Task<obj>
                        return! interpretWinner loop winnerObj
                }

            try
                return! loop ()
            with ex ->
                lease.MarkExit(classifyExn ex)
                deadline.Cancel()
                return raise ex
        }
