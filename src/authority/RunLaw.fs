namespace Wanxiangli.Authority

/// 两种根。HumanRoot 只能由入口边界凭显式 participant 授予，本模块从不推断它。
[<RequireQualifiedAccess>]
type RootKind =
    | HumanRoot
    | AgentOwnerRoot

/// 一个已接受的逻辑根。身份只看精确字段；seed 是宿主给出的身份种子规范键，
/// 本模块只比较它是否逐字相等，不解析、不推导 participant。
type RunRoot =
    { SessionId: string
      LogicalRunId: string
      RootId: string
      Kind: RootKind
      Seed: string }

/// 来源闭集合（interaction-authority-005）。
[<RequireQualifiedAccess>]
type Origin =
    | AuthorityRoot of RootKind
    | Continuation of string
    | HostInternal
    | UnknownOrigin

/// 注册一个根的结论：接纳为新的活跃根、精确重放（沿用活跃根）、或与活跃根冲突。
[<RequireQualifiedAccess>]
type Registration =
    | Admit
    | Replay
    | Conflict

/// 关闭一个逻辑运行的结论。
[<RequireQualifiedAccess>]
type Closure =
    /// 正是活跃运行：关闭它。
    | Close
    /// 没有活跃运行，且最后一个根正是它：重复关闭，幂等。
    | AlreadyClosed
    /// 活跃运行是别的运行：拒绝，旧运行的关闭不能命中新运行。
    | Mismatch
    /// 既不是活跃运行，也不是最后一个根：没有可关闭的权威。
    | NoAuthority
    /// 子工作关闭要求活跃根是非 Manager 的 AgentOwnerRoot。
    | NotChildWork

[<RequireQualifiedAccess>]
module RunLaw =

    let private sameRoot (a: RunRoot) (b: RunRoot) =
        a.SessionId = b.SessionId
        && a.LogicalRunId = b.LogicalRunId
        && a.RootId = b.RootId
        && a.Kind = b.Kind
        && a.Seed = b.Seed

    /// 同一物理根的持久重放：会话、根消息、根种类与身份种子都精确相同。
    /// 逻辑运行号由根派生，重放时不作为身份的一部分。
    let private isDurableReplay (active: RunRoot) (requested: RunRoot) =
        active.SessionId = requested.SessionId
        && active.RootId = requested.RootId
        && active.Kind = requested.Kind
        && active.Seed = requested.Seed

    /// interaction-authority-003/017：活跃运行存在时，只有精确同一根（或其持久重放）可沿用；
    /// 其余一律冲突，必须先关闭旧运行。没有活跃运行时接纳。
    let register (active: RunRoot option) (requested: RunRoot) : Registration =
        match active with
        | None -> Registration.Admit
        | Some current when sameRoot current requested || isDurableReplay current requested -> Registration.Replay
        | Some _ -> Registration.Conflict

    /// interaction-authority-018 的精确关闭：只关闭由 (LogicalRunId, RootId) 精确命名的活跃运行。
    let close (active: RunRoot option) (last: RunRoot option) (logicalRunId: string) (rootId: string) : Closure =
        let named (root: RunRoot) = root.LogicalRunId = logicalRunId && root.RootId = rootId

        match active with
        | Some current when named current -> Closure.Close
        | Some _ -> Closure.Mismatch
        | None when last |> Option.exists named -> Closure.AlreadyClosed
        | None -> Closure.NoAuthority

    /// 已完成子工作的关闭：活跃根必须是非 Manager participant 的 AgentOwnerRoot；没有活跃根时按普通关闭判。
    let closeChildWork
        (active: RunRoot option)
        (activeIsManager: bool)
        (last: RunRoot option)
        (logicalRunId: string)
        (rootId: string)
        : Closure =
        match active with
        | Some current when current.Kind = RootKind.AgentOwnerRoot && not activeIsManager ->
            close active last logicalRunId rootId
        | Some _ -> Closure.NotChildWork
        | None -> close active last logicalRunId rootId

    /// interaction-authority-008/009 的来源解析优先级（D-01：未知失败关闭）：
    /// 已接受的 continuation 物理消息 → 已 claim 的 PromptKey 自身来源 → Host 内部压缩/合成
    /// → 带 PromptKey 且活跃根为 AgentOwnerRoot → UnknownOrigin。
    /// 纯计算从不返回新的 HumanRoot；无法证明的来源一律 UnknownOrigin。
    let resolveOrigin
        (acceptedContinuation: string option)
        (claimOrigin: Origin option)
        (hasPromptKey: bool)
        (hostCompaction: bool)
        (activeKind: RootKind option)
        : Origin =
        match acceptedContinuation, claimOrigin, hostCompaction, hasPromptKey, activeKind with
        | Some continuation, _, _, _, _ -> Origin.Continuation continuation
        | None, Some origin, _, _, _ -> origin
        | None, None, true, _, _ -> Origin.HostInternal
        | None, None, false, true, Some RootKind.AgentOwnerRoot -> Origin.AuthorityRoot RootKind.AgentOwnerRoot
        | _ -> Origin.UnknownOrigin
