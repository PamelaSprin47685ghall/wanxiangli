namespace Wanxiangli.Wait

open System
open System.Threading.Tasks

module JoinBatch =
    let Max = 32
    let MaxJoinBatch = Max

type NonEmptyBatch<'item> = private NonEmptyBatch of head: 'item * tail: 'item list

module NonEmptyBatch =
    let ofHeadTail (head: 'item) (tail: 'item list) = NonEmptyBatch(head, tail)

    let tryOfList =
        function
        | [] -> None
        | head :: tail -> Some(NonEmptyBatch(head, tail))

    let toList (NonEmptyBatch(head, tail)) = head :: tail

    let length (NonEmptyBatch(_, tail)) = 1 + List.length tail

    let map (f: 'a -> 'b) (NonEmptyBatch(head, tail)) = NonEmptyBatch(f head, List.map f tail)

[<RequireQualifiedAccess>]
type JoinInterruptReason =
    | OperatorAbort
    | UserMessageArrived
    | DeadlineExpired

type JoinWaitOutcome<'item> =
    | ResultsAvailable of NonEmptyBatch<'item>
    | Interrupted of JoinInterruptReason

type MailboxWakeReason =
    | CompletionMayBeAvailable
    | LocalInterrupt of JoinInterruptReason
    | MailboxCancelled

type JoinInterrupt =
    { Wait: Task<JoinInterruptReason>
      Signal: JoinInterruptReason -> unit }

type ICompletionMailbox<'agent, 'pty, 'interrupt, 'wake> =
    abstract PulseAgent: 'agent -> unit
    abstract PublishPty: 'pty -> unit
    abstract PulseWake: unit -> unit
    abstract WaitForWake: unit -> Task<'wake>
    abstract WaitForSignal: Task<'interrupt> -> Task<'wake>
    abstract DrainAgents: int -> 'agent list
    abstract DrainPtys: int -> 'pty list
    abstract Cancel: unit -> bool
    abstract PendingCount: int
    abstract PendingPtyCount: int
    abstract IsCancelled: bool

/// 可取消的一次性截止句柄，与 wanxiangli/runtime 的 Time 的同名契约结构一致。
/// 本模块按库仓惯例本地声明消费方视角的最窄契约，不做源码跨工程引用；
/// 运行时由组合者注入 time 模块（或测试替身）产生的实例。
type IDeadlineHandle =
    abstract Delay: Task<unit>
    abstract Cancel: unit -> unit

/// 进程内、无业务权威的因果等待观测。
///
/// 等待观测只描述当前等待；它绝不决定业务分支、铸造许可、写 Journal、
/// 参与恢复或影响提示构建。WaitKind / Subject 字符串只用于诊断呈现，
/// 不是领域词汇。退出名以 Wait 为前缀，避免与业务终态词汇碰撞。
type CausalOwnerRef =
    { Kind: string
      Identity: (string * string) list }

type CausalProducerRef =
    | WorkflowProducer of CausalOwnerRef
    | ExternalProducer of kind: string * identity: (string * string) list

type WaitEscape =
    | DeadlineAt of DateTimeOffset
    | CancelledBy of CausalOwnerRef
    | ProcessLifetime
    | SessionLifetime
    | OpenEndedExternal

type DiagnosticWait =
    { WaitKind: string
      Owner: CausalOwnerRef
      Subject: (string * string) list
      Producer: CausalProducerRef
      Escapes: WaitEscape list
      Source: string }

type DiagnosticWaitExit =
    | WaitResolved
    | WaitFailed
    | WaitCancelled
    | WaitTimedOut
    | WaitDisposed

type WaitTransitionKind =
    | Entered
    | Left

type WaitTransition =
    { Sequence: int64
      Kind: WaitTransitionKind
      Wait: DiagnosticWait
      Exit: DiagnosticWaitExit option }

type DiagnosticWaitSnapshot =
    { Active: DiagnosticWait list
      History: WaitTransition list
      Sequence: int64 }

/// Enter 返回的租约。MarkExit 记录诊断退出原因；
/// Dispose 总是清除活跃等待（未标记时默认 WaitDisposed）。
type IWaitLease =
    inherit IDisposable
    abstract MarkExit: DiagnosticWaitExit -> unit

/// 业务工作流可登记等待；绝不读取快照。
type IWaitObserver =
    abstract Enter: DiagnosticWait -> IWaitLease

/// 诊断面可读取；业务不得持有此接口。
type IWaitSnapshotReader =
    abstract Snapshot: unit -> DiagnosticWaitSnapshot

/// 物理诊断目标。组合者向进程内运行时绑定一次；
/// 业务工作流永远拿不到这个能力。
type IWaitDiagnosticSink =
    abstract Publish: DiagnosticWaitSnapshot -> unit

module CausalOwner =

    let key (owner: CausalOwnerRef) : string =
        let ids =
            owner.Identity
            |> List.sortBy fst
            |> List.map (fun (k, v) -> k + "=" + v)
            |> String.concat ","

        owner.Kind + ":" + ids

    let create (kind: string) (identity: (string * string) list) : CausalOwnerRef = { Kind = kind; Identity = identity }

module CausalProducer =

    let key (producer: CausalProducerRef) : string =
        match producer with
        | WorkflowProducer owner -> "workflow:" + CausalOwner.key owner
        | ExternalProducer(kind, identity) -> "external:" + CausalOwner.key { Kind = kind; Identity = identity }

    let asOwner (producer: CausalProducerRef) : CausalOwnerRef option =
        match producer with
        | WorkflowProducer owner -> Some owner
        | ExternalProducer _ -> None

module DiagnosticWait =

    let create
        (waitKind: string)
        (owner: CausalOwnerRef)
        (subject: (string * string) list)
        (producer: CausalProducerRef)
        (escapes: WaitEscape list)
        (source: string)
        : DiagnosticWait =
        { WaitKind = waitKind
          Owner = owner
          Subject = subject
          Producer = producer
          Escapes = escapes
          Source = source }

/// 前沿结果只是最小未满足因果边的诊断解释，绝不驱动工作流控制。
type CausalFrontierKind =
    | ExternalProducerFrontier
    | BrokenCausalEdge
    | ProducerRunningWithoutWait
    | CausalWaitCycle
    | Empty

type CausalFrontierNode =
    { Owner: CausalOwnerRef
      Wait: DiagnosticWait option }

type CausalFrontier =
    { Kind: CausalFrontierKind
      Chain: CausalFrontierNode list
      FrontierProducer: CausalProducerRef option
      Cycle: CausalOwnerRef list
      Detail: string }

module CausalFrontier =

    let private ownerKey = CausalOwner.key

    let private waitsByOwner (active: DiagnosticWait list) =
        active |> List.groupBy (fun wait -> ownerKey wait.Owner) |> Map.ofList

    let private producerOwners (active: DiagnosticWait list) =
        active
        |> List.choose (fun wait -> CausalProducer.asOwner wait.Producer)
        |> List.map ownerKey
        |> Set.ofList

    let private rootOwners (active: DiagnosticWait list) =
        let produced = producerOwners active

        active
        |> List.map (fun wait -> wait.Owner)
        |> List.distinctBy ownerKey
        |> List.filter (fun owner -> not (Set.contains (ownerKey owner) produced))

    let private walk (byOwner: Map<string, DiagnosticWait list>) (start: CausalOwnerRef) : CausalFrontier list =
        let rec go (owner: CausalOwnerRef) (chain: CausalFrontierNode list) (seen: Set<string>) =
            let key = ownerKey owner

            if Set.contains key seen then
                let cycle =
                    chain
                    |> List.rev
                    |> List.map (fun node -> node.Owner)
                    |> List.skipWhile (fun o -> ownerKey o <> key)
                    |> fun prefix -> prefix @ [ owner ]

                [ { Kind = CausalWaitCycle
                    Chain = List.rev chain
                    FrontierProducer = None
                    Cycle = cycle
                    Detail = "CAUSAL WAIT CYCLE" } ]
            else
                resolveOwner byOwner go owner chain seen

        and resolveOwner byOwner continueWalk owner chain seen =
            let key = ownerKey owner

            match Map.tryFind key byOwner with
            | None ->
                [ { Kind = BrokenCausalEdge
                    Chain = List.rev ({ Owner = owner; Wait = None } :: chain)
                    FrontierProducer = None
                    Cycle = []
                    Detail =
                      "BROKEN CAUSAL EDGE: consumer waits for "
                      + key
                      + " but no active wait declares that owner" } ]
            | Some [] ->
                [ { Kind = ProducerRunningWithoutWait
                    Chain = List.rev ({ Owner = owner; Wait = None } :: chain)
                    FrontierProducer = None
                    Cycle = []
                    Detail = "PRODUCER RUNNING WITHOUT DECLARED WAIT: " + key } ]
            | Some waits ->
                let nextSeen = Set.add key seen

                waits
                |> List.collect (fun wait ->
                    let nextChain = { Owner = owner; Wait = Some wait } :: chain
                    resolveProducer byOwner continueWalk key wait nextChain nextSeen)

        and resolveProducer byOwner continueWalk key wait nextChain nextSeen =
            match wait.Producer with
            | ExternalProducer _ as producer ->
                [ { Kind = ExternalProducerFrontier
                    Chain = List.rev nextChain
                    FrontierProducer = Some producer
                    Cycle = []
                    Detail = "FRONTIER: waiting for external producer " + CausalProducer.key producer } ]
            | WorkflowProducer next -> resolveWorkflow byOwner continueWalk key wait next nextChain nextSeen

        and resolveWorkflow byOwner continueWalk key wait next nextChain nextSeen =
            match Map.tryFind (ownerKey next) byOwner with
            | None ->
                [ { Kind = BrokenCausalEdge
                    Chain = List.rev ({ Owner = next; Wait = None } :: nextChain)
                    FrontierProducer = Some wait.Producer
                    Cycle = []
                    Detail =
                      "BROKEN CAUSAL EDGE: "
                      + key
                      + " waits for "
                      + ownerKey next
                      + " but no active wait exists for that producer" } ]
            | Some _ -> continueWalk next nextChain nextSeen

        go start [] Set.empty

    let private walkUnvisited byOwner (frontiers, visited) owner =
        if Set.contains (ownerKey owner) visited then
            frontiers, visited
        else
            let found = walk byOwner owner

            let reached =
                found
                |> List.collect (fun frontier -> frontier.Chain)
                |> List.fold (fun seen node -> Set.add (ownerKey node.Owner) seen) visited

            frontiers @ found, reached

    /// 纯诊断算法：从活跃根 owner 沿 consumer→producer 边走到每条未满足分支，
    /// 再包含不相连的循环分量。
    let ofSnapshot (snapshot: DiagnosticWaitSnapshot) : CausalFrontier list =
        match snapshot.Active with
        | [] ->
            [ { Kind = Empty
                Chain = []
                FrontierProducer = None
                Cycle = []
                Detail = "no active waits" } ]
        | active ->
            let byOwner = waitsByOwner active
            let starts = rootOwners active @ (active |> List.map (fun wait -> wait.Owner))
            starts |> List.fold (walkUnvisited byOwner) ([], Set.empty) |> fst
