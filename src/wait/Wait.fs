module Wanxiangli.Wait.Wait

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Wait

[<Emit("$0($1)")>]
let private call1 (fn: obj) (value: obj) : obj = jsNative

[<Emit("$0()")>]
let private call0 (fn: obj) : obj = jsNative

[<Emit("Promise.resolve($0)")>]
let private asPromise (value: obj) : JS.Promise<obj> = jsNative

let private property (value: obj) (name: string) : obj = emitJsExpr (value, name) "$0[$1]"

let private optionObj (value: 'T option) : obj =
    match value with
    | Some value -> box value
    | None -> null

[<Emit("$0==null")>]
let private isNullish (value: obj) : bool = jsNative

let private stringOf (value: obj) =
    if isNullish value then "" else string value

let private pairsOf (value: obj) : (string * string) list =
    if isNullish value then
        []
    else
        let keys: string array = emitJsExpr value "Object.keys($0)"
        keys |> Array.toList |> List.map (fun key -> key, stringOf (property value key))

let private objectOfPairs (pairs: (string * string) list) : obj =
    pairs |> List.map (fun (key, value) -> key, box value) |> createObj

let private ownerOf (value: obj) : CausalOwnerRef =
    { Kind = stringOf (property value "kind")
      Identity = pairsOf (property value "identity") }

let private ownerObject (owner: CausalOwnerRef) : obj =
    box
        {| kind = owner.Kind
           identity = objectOfPairs owner.Identity |}

let private producerOf (value: obj) : CausalProducerRef =
    let kind = stringOf (property value "kind")

    if kind = "workflow" then
        WorkflowProducer(ownerOf (property value "owner"))
    else
        ExternalProducer(stringOf (property value "producerKind"), pairsOf (property value "identity"))

let private producerObject (producer: CausalProducerRef) : obj =
    match producer with
    | WorkflowProducer owner ->
        box
            {| kind = "workflow"
               owner = ownerObject owner |}
    | ExternalProducer(kind, identity) ->
        box
            {| kind = "external"
               producerKind = kind
               identity = objectOfPairs identity |}

let private escapeOf (value: obj) : WaitEscape =
    match stringOf (property value "kind") with
    | "deadlineAt" -> DeadlineAt(DateTimeOffset.Parse(stringOf (property value "at")))
    | "cancelledBy" -> CancelledBy(ownerOf (property value "owner"))
    | "processLifetime" -> ProcessLifetime
    | "sessionLifetime" -> SessionLifetime
    | "openEndedExternal" -> OpenEndedExternal
    | unknown -> invalidArg "escape" ("unknown wait escape: " + unknown)

let private escapeObject (escape: WaitEscape) : obj =
    match escape with
    | DeadlineAt at ->
        box
            {| kind = "deadlineAt"
               at = at.ToUniversalTime().ToString("o") |}
    | CancelledBy owner ->
        box
            {| kind = "cancelledBy"
               owner = ownerObject owner |}
    | ProcessLifetime -> box {| kind = "processLifetime" |}
    | SessionLifetime -> box {| kind = "sessionLifetime" |}
    | OpenEndedExternal -> box {| kind = "openEndedExternal" |}

let private waitOf (value: obj) : DiagnosticWait =
    let subject = pairsOf (property value "subject")

    let escapes =
        let rawEscapes = property value "escapes"

        if isNullish rawEscapes then
            []
        else
            unbox<obj array> rawEscapes |> Array.toList |> List.map escapeOf

    DiagnosticWait.create
        (stringOf (property value "waitKind"))
        (ownerOf (property value "owner"))
        subject
        (producerOf (property value "producer"))
        escapes
        (stringOf (property value "source"))

let private waitObject (wait: DiagnosticWait) : obj =
    box
        {| waitKind = wait.WaitKind
           owner = ownerObject wait.Owner
           subject = objectOfPairs wait.Subject
           producer = producerObject wait.Producer
           escapes = wait.Escapes |> List.map escapeObject |> List.toArray
           source = wait.Source |}

let private exitOf (name: string) =
    match name with
    | "WaitResolved"
    | "resolved" -> DiagnosticWaitExit.WaitResolved
    | "WaitFailed"
    | "failed" -> DiagnosticWaitExit.WaitFailed
    | "WaitCancelled"
    | "cancelled" -> DiagnosticWaitExit.WaitCancelled
    | "WaitTimedOut"
    | "timedOut" -> DiagnosticWaitExit.WaitTimedOut
    | "WaitDisposed"
    | "disposed" -> DiagnosticWaitExit.WaitDisposed
    | unknown -> invalidArg "exit" ("unknown wait exit: " + unknown)

let private exitName =
    function
    | DiagnosticWaitExit.WaitResolved -> "WaitResolved"
    | DiagnosticWaitExit.WaitFailed -> "WaitFailed"
    | DiagnosticWaitExit.WaitCancelled -> "WaitCancelled"
    | DiagnosticWaitExit.WaitTimedOut -> "WaitTimedOut"
    | DiagnosticWaitExit.WaitDisposed -> "WaitDisposed"

let private transitionObject (transition: WaitTransition) : obj =
    box
        {| sequence = transition.Sequence
           kind =
            match transition.Kind with
            | WaitTransitionKind.Entered -> "Entered"
            | WaitTransitionKind.Left -> "Left"
           wait = waitObject transition.Wait
           exit = optionObj (transition.Exit |> Option.map exitName) |}

let private snapshotObject (snapshot: DiagnosticWaitSnapshot) : obj =
    box
        {| active = snapshot.Active |> List.map waitObject |> List.toArray
           history = snapshot.History |> List.map transitionObject |> List.toArray
           sequence = int snapshot.Sequence |}

/// JS 原生边界：描述符与快照为纯对象；registry 与租约是不透明的进程内能力。
module private Handles =

    type RuntimeHandle(runtime: CausalWaitRuntime) =
        member _.Runtime = runtime

    [<AttachMembers>]
    type ObserverHandle(observer: IWaitObserver) =
        member _.Enter(wait: DiagnosticWait) = observer.Enter wait

    [<AttachMembers>]
    type SnapshotReaderHandle(reader: IWaitSnapshotReader) =
        member _.Snapshot() = snapshotObject (reader.Snapshot())

/// 租约句柄是不透明能力：句柄对象本身不带任何成员，租约本体留在模块私有弱表里，
/// 只能经 markExit / dispose 操作。句柄是租约唯一的强引用；句柄被回收后租约随之可回收。
[<Emit("new WeakMap()")>]
let private newLeaseTable () : obj = jsNative

let private leaseTable = newLeaseTable ()

let private registerLease (lease: IWaitLease) : obj =
    let handle = createObj []
    emitJsExpr (leaseTable, handle, box lease) "$0.set($1, $2)" |> ignore
    handle

let private leaseOf (handle: obj) : IWaitLease =
    let lease = emitJsExpr (leaseTable, handle) "$0.get($1)"

    if isNullish lease then
        invalidArg "lease" "wait lease required"
    else
        unbox<IWaitLease> lease

let private frontierKindName =
    function
    | ExternalProducerFrontier -> "ExternalProducerFrontier"
    | BrokenCausalEdge -> "BrokenCausalEdge"
    | ProducerRunningWithoutWait -> "ProducerRunningWithoutWait"
    | CausalWaitCycle -> "CausalWaitCycle"
    | Empty -> "Empty"

let private frontierObject (frontier: CausalFrontier) : obj =
    let chain =
        frontier.Chain
        |> List.map (fun node ->
            box
                {| owner = ownerObject node.Owner
                   waitKind = optionObj (node.Wait |> Option.map (fun wait -> wait.WaitKind)) |})
        |> List.toArray

    box
        {| kind = frontierKindName frontier.Kind
           detail = frontier.Detail
           chain = chain
           cycle = frontier.Cycle |> List.map ownerObject |> List.toArray
           producer = optionObj (frontier.FrontierProducer |> Option.map producerObject) |}

let private runtimeOf (registry: obj) : CausalWaitRuntime =
    (registry :?> Handles.RuntimeHandle).Runtime

/// 创建进程内等待注册表。historyCapacity 为 null 或正整数。
let createRegistry (historyCapacity: obj) : obj =
    let capacity =
        if isNullish historyCapacity then
            None
        else
            Some(int (string historyCapacity))

    Handles.RuntimeHandle(CausalWaitRuntime(?historyCapacity = capacity)) :> obj

/// 描述符构造辅助：owner / externalProducer / workflowProducer / escape。
let owner (kind: string) (identity: obj) : obj =
    box
        {| kind = kind
           identity = objectOfPairs (pairsOf identity) |}

let externalProducer (kind: string) (identity: obj) : obj =
    box
        {| kind = "external"
           producerKind = kind
           identity = objectOfPairs (pairsOf identity) |}

let workflowProducer (ownerValue: obj) : obj = box {| kind = "workflow"; owner = ownerValue |}

let escape (kind: string) (value: obj) : obj =
    match kind with
    | "deadlineAt" -> box {| kind = kind; at = stringOf value |}
    | "cancelledBy" -> box {| kind = kind; owner = value |}
    | _ -> box {| kind = kind |}

let observerCapability (registry: obj) : obj =
    Handles.ObserverHandle((runtimeOf registry).Observer) :> obj

let snapshotReaderCapability (registry: obj) : obj =
    Handles.SnapshotReaderHandle((runtimeOf registry).SnapshotReader) :> obj

let private requireObserver (value: obj) =
    match value with
    | :? Handles.ObserverHandle as handle -> handle
    | _ -> invalidArg "observer" "observer capability required"

let private requireSnapshotReader (value: obj) =
    match value with
    | :? Handles.SnapshotReaderHandle as handle -> handle
    | _ -> invalidArg "reader" "snapshot reader capability required"

let observerEnter (observer: obj) (descriptor: obj) : obj =
    registerLease ((requireObserver observer).Enter(waitOf descriptor))

let readerSnapshot (reader: obj) : obj =
    // SnapshotReaderHandle.Snapshot 已返回 JS 视图（snapshotObject）。
    (requireSnapshotReader reader).Snapshot()

let enter (registry: obj) (descriptor: obj) : obj =
    observerEnter (observerCapability registry) descriptor

let markExit (lease: obj) (exit: string) : unit =
    (leaseOf lease).MarkExit(exitOf exit)

let dispose (lease: obj) : unit = (leaseOf lease).Dispose()

let snapshot (registry: obj) : obj = readerSnapshot (snapshotReaderCapability registry)

let historyCapacity (registry: obj) : int = (runtimeOf registry).HistoryCapacity

/// 绑定诊断 sink（首绑唯一，返回是否绑定成功）。
/// sink 形状：{ Publish(snapshotPlainObject): void }。
/// runtime 发布的是 F# DiagnosticWaitSnapshot；此处转成 JS 视图再交给 sink。
let bindDiagnosticTarget (registry: obj) (sink: obj) : bool =
    let target =
        { new IWaitDiagnosticSink with
            member _.Publish(snapshotValue) =
                call1 (property sink "Publish") (snapshotObject snapshotValue) |> ignore }

    (runtimeOf registry).BindDiagnosticTarget(target)

let ownerKey (value: obj) : string = CausalOwner.key (ownerOf value)

let producerKey (value: obj) : string = CausalProducer.key (producerOf value)

let frontiers (active: obj array) : obj array =
    let waits = active |> Array.toList |> List.map waitOf

    let snapshotValue =
        { Active = waits
          History = []
          Sequence = 1L }

    CausalFrontier.ofSnapshot snapshotValue |> List.map frontierObject |> List.toArray

let frontiersOfSnapshot (snapshotValue: obj) : obj array =
    let waits =
        unbox<obj array> (property snapshotValue "active") |> Array.toList |> List.map waitOf

    let typed =
        { Active = waits
          History = []
          Sequence = 1L }

    CausalFrontier.ofSnapshot typed |> List.map frontierObject |> List.toArray

let awaitTask (registry: obj) (descriptor: obj) (pending: obj) : Task<obj> =
    let task: Task<obj> = unbox (asPromise pending)
    CausalAwait.awaitTask (runtimeOf registry).Observer (waitOf descriptor) task

/// 信号与截止时间竞争的复合等待。deadline 为 { Delay: Promise, Cancel(): void }。
/// tryRead / awaitSignal 为无参函数；tryRead 返回 null 表示未就绪。
/// 返回 Promise<{ ok, value | reason }>。
let untilSignalOrDeadline
    (registry: obj)
    (descriptor: obj)
    (deadline: obj)
    (tryRead: obj)
    (awaitSignal: obj)
    : Task<obj> =
    let inner = unbox<IDeadlineHandle> deadline

    let deadlineHandle =
        { new IDeadlineHandle with
            member _.Delay = inner.Delay
            member _.Cancel() = inner.Cancel() }

    let read () =
        let value = call0 tryRead
        if isNullish value then None else Some value

    let signal () : Task<unit> = unbox (asPromise (call0 awaitSignal))

    task {
        let! result =
            CausalAwait.untilSignalOrDeadline (runtimeOf registry).Observer (waitOf descriptor) deadlineHandle read signal

        match result with
        | Ok value -> return box {| ok = true; value = value |}
        | Error exitValue -> return box {| ok = false; reason = exitName exitValue |}
    }

/// 泛型完成邮箱：agent / pty 通道元素由调用方给定（不透明值）。
/// 形状：{ pulseAgent, publishPty, pulseWake, waitForWake, waitForSignal,
/// drainAgents, drainPtys, cancel, pendingCount, pendingPtyCount, isCancelled }。
/// 唤醒原因以 JS 值表达：'CompletionMayBeAvailable' | 'MailboxCancelled' |
/// { LocalInterrupt: 'OperatorAbort' | 'UserMessageArrived' | 'DeadlineExpired' }。
let completionMailboxCreate () : obj =
    let mailbox = CompletionMailbox<obj, obj>(obj ())

    let interruptName =
        function
        | JoinInterruptReason.OperatorAbort -> "OperatorAbort"
        | JoinInterruptReason.UserMessageArrived -> "UserMessageArrived"
        | JoinInterruptReason.DeadlineExpired -> "DeadlineExpired"

    let wakeReasonObject =
        function
        | CompletionMayBeAvailable -> box "CompletionMayBeAvailable"
        | MailboxCancelled -> box "MailboxCancelled"
        | LocalInterrupt reason -> box {| LocalInterrupt = interruptName reason |}

    let view =
        createObj
            [ "pulseAgent", box (fun (handle: obj) -> mailbox.PulseAgentHandle handle)
              "publishPty", box (fun (item: obj) -> mailbox.PublishPtyCompletion item)
              "pulseWake", box (fun () -> mailbox.PulseWake())
              "waitForWake", box (fun () -> task { let! reason = mailbox.WaitForWake() in return wakeReasonObject reason })
              "waitForSignal",
                box (fun (interrupt: obj) ->
                    task {
                        let! reason = mailbox.WaitForSignal(unbox<Task<JoinInterruptReason>> interrupt)
                        return wakeReasonObject reason
                    })
              "drainAgents", box (fun (maxCount: int) -> mailbox.DrainAgentWakes maxCount |> List.toArray)
              "drainPtys", box (fun (maxCount: int) -> mailbox.DrainPtyCompletions maxCount |> List.toArray)
              "cancel", box (fun () -> mailbox.Cancel())
              "pendingCount", box (fun () -> mailbox.PendingCount)
              "pendingPtyCount", box (fun () -> mailbox.PendingPtyCount)
              "pendingAgentWakeCount", box (fun () -> mailbox.PendingAgentWakeCount)
              "isCancelled", box (fun () -> mailbox.IsCancelled) ]

    view

/// 构造一个本地 join 中断源：{ wait: Promise<JoinInterruptReason>, signal(reason) }。
/// reason 取 "OperatorAbort" | "UserMessageArrived" | "DeadlineExpired"。
let interrupt () : obj =
    let reasonOf (name: string) =
        match name with
        | "OperatorAbort" -> JoinInterruptReason.OperatorAbort
        | "UserMessageArrived" -> JoinInterruptReason.UserMessageArrived
        | "DeadlineExpired" -> JoinInterruptReason.DeadlineExpired
        | unknown -> invalidArg "reason" ("unknown interrupt reason: " + unknown)

    let source = TaskCompletionSource<JoinInterruptReason>()

    let view =
        createObj
            [ "wait", box source.Task
              "signal", box (fun (name: obj) -> source.SetResult(reasonOf (stringOf name))) ]

    view

let maxJoinBatch = JoinBatch.MaxJoinBatch

/// 具名导出容器：esbuild 静态绑定契约（export { Wait }）。
/// 直接引用顶层函数值（Fable 顶层多参 let 生成 uncurried JS 函数）。
let Wait: obj =
    createObj [
        "createRegistry" ==> createRegistry
        "owner" ==> owner
        "externalProducer" ==> externalProducer
        "workflowProducer" ==> workflowProducer
        "escape" ==> escape
        "observerCapability" ==> observerCapability
        "snapshotReaderCapability" ==> snapshotReaderCapability
        "observerEnter" ==> observerEnter
        "readerSnapshot" ==> readerSnapshot
        "enter" ==> enter
        "markExit" ==> markExit
        "dispose" ==> dispose
        "snapshot" ==> snapshot
        "historyCapacity" ==> historyCapacity
        "bindDiagnosticTarget" ==> bindDiagnosticTarget
        "ownerKey" ==> ownerKey
        "producerKey" ==> producerKey
        "frontiers" ==> frontiers
        "frontiersOfSnapshot" ==> frontiersOfSnapshot
        "awaitTask" ==> awaitTask
        "untilSignalOrDeadline" ==> untilSignalOrDeadline
        "completionMailbox" ==> completionMailboxCreate
        "interrupt" ==> interrupt
        "maxJoinBatch" ==> maxJoinBatch
    ]
