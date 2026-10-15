namespace Wanxiangli.Wait

open System
open System.Collections.Generic

/// 进程内诊断等待注册表。不是业务事实源、恢复输入、去重键、
/// 工作流分支输入或 Journal 投影。
type CausalWaitRegistry(?historyCapacity: int) =
    let capacity =
        match historyCapacity with
        | Some n when n > 0 -> n
        | _ -> 256

    let gate = obj ()
    let active = Dictionary<int64, DiagnosticWait>()
    let history = Queue<WaitTransition>()
    let mutable nextId = 0L
    let mutable snapshotSequence = 0L

    let pushHistory (transition: WaitTransition) =
        history.Enqueue transition

        while history.Count > capacity do
            history.Dequeue() |> ignore

    let leave (leaseId: int64) (exit: DiagnosticWaitExit) =
        lock gate (fun () ->
            match active.TryGetValue leaseId with
            | false, _ -> ()
            | true, wait ->
                active.Remove leaseId |> ignore
                nextId <- nextId + 1L
                snapshotSequence <- snapshotSequence + 1L

                pushHistory
                    { Sequence = nextId
                      Kind = WaitTransitionKind.Left
                      Wait = wait
                      Exit = Some exit })

    member _.HistoryCapacity = capacity

    interface IWaitObserver with
        member _.Enter(wait: DiagnosticWait) : IWaitLease =
            let leaseId =
                lock gate (fun () ->
                    nextId <- nextId + 1L
                    snapshotSequence <- snapshotSequence + 1L
                    let id = nextId
                    active.[id] <- wait

                    pushHistory
                        { Sequence = id
                          Kind = WaitTransitionKind.Entered
                          Wait = wait
                          Exit = None }

                    id)

            let mutable exitMarked: DiagnosticWaitExit option = None
            let mutable disposed = false

            { new IWaitLease with
                member _.MarkExit(exit: DiagnosticWaitExit) =
                    if not disposed then
                        exitMarked <- Some exit

                member _.Dispose() =
                    if not disposed then
                        disposed <- true
                        leave leaseId (defaultArg exitMarked DiagnosticWaitExit.WaitDisposed) }

    interface IWaitSnapshotReader with
        member _.Snapshot() : DiagnosticWaitSnapshot =
            lock gate (fun () ->
                { Active = active.Values |> Seq.toList
                  History = history |> Seq.toList
                  Sequence = snapshotSequence })

type private PublishingWaitLease(inner: IWaitLease, publish: unit -> unit) =
    interface IWaitLease with
        member _.MarkExit(exit) = inner.MarkExit exit

        member _.Dispose() =
            inner.Dispose()
            publish ()

/// 一个注册表加其只写业务能力。诊断目标首绑唯一：
/// 后来的插件实例不能重定向进程诊断。
type CausalWaitRuntime(?historyCapacity: int) =
    let registry = CausalWaitRegistry(?historyCapacity = historyCapacity)
    let reader = registry :> IWaitSnapshotReader
    let inner = registry :> IWaitObserver
    let targetGate = obj ()
    let mutable diagnosticTarget: IWaitDiagnosticSink option = None

    let publish () =
        let target = lock targetGate (fun () -> diagnosticTarget)

        target
        |> Option.iter (fun sink ->
            try
                sink.Publish(reader.Snapshot())
            with _ ->
                ())

    let observer: IWaitObserver =
        { new IWaitObserver with
            member _.Enter(wait) =
                let lease = inner.Enter wait
                publish ()
                new PublishingWaitLease(lease, publish) :> IWaitLease }

    member _.BindDiagnosticTarget(target: IWaitDiagnosticSink) =
        // 首绑唯一；绑定本身不发布快照——首个快照来自下一次状态变化
        // （主仓 causal-wait-003 契约：received[0] 是 enter 后的快照）。
        lock targetGate (fun () ->
            match diagnosticTarget with
            | Some _ -> false
            | None ->
                diagnosticTarget <- Some target
                true)

    member _.Observer = observer
    member _.SnapshotReader = reader
    member _.HistoryCapacity = registry.HistoryCapacity
