namespace Wanxiangli.Authority

/// 入口准入的输入：全部是宿主已经观察到的 plain 事实。participant 解析、身份种子与
/// 投影查找都由宿主完成；本模块只按固定次序裁决。
type PendingClaimFacts =
    { SessionId: string
      Origin: Origin
      /// 宿主从 claim 身份种子解析出的选定 participant（规范名）。
      SelectedAgent: string }

type AcceptedFacts =
    { SessionId: string
      PhysicalId: string
      Origin: Origin
      SelectedAgent: string }

type ActiveFacts =
    { Kind: RootKind
      SelectedAgent: string }

type AdmissionInput =
    { InvalidCarrier: string option
      SessionId: string option
      PhysicalId: string option
      PromptKey: string option
      /// 线上原样的显式 participant 字段。
      ExplicitAgent: string option
      /// 显式 participant 在根上解析成功且带角色时的规范名；解析失败为 None。
      ExplicitRootAgent: string option
      HostInternal: bool
      /// None：宿主拿不到 durable 权威快照。Some None：有快照但没有活跃运行。
      Authority: ActiveFacts option option
      AcceptedContinuation: string option
      LandedOrigin: Origin option
      PendingClaim: PendingClaimFacts option
      AcceptedEvidence: AcceptedFacts option }

[<RequireQualifiedAccess>]
type AdmissionRejection =
    | MalformedCarrier of string
    | MissingSession
    | MissingPhysical
    | AuthorityUnavailable
    | InvalidExplicitAgent
    | AcceptedParticipantConflict
    | PromptKeyNotClaimed
    | AgentOwnerRootPromptNotClaimed
    | ClaimSessionMismatch
    | ClaimOriginNotAdmissible
    | UnknownOriginWhileActive

[<RequireQualifiedAccess>]
type Admission =
    | Unmanaged
    | AlreadyAccepted of Origin
    | HostInternal
    /// 已接受 HumanRoot 物理消息的重放：沿用已接受的来源与身份种子。
    | AcceptedRootReplay
    /// 入口边界凭显式 participant 授予新的 HumanRoot（仅当没有活跃运行）。
    | ExternalRoot
    | ActiveHumanContinuation
    | PendingPrompt
    | Reject of AdmissionRejection

[<RequireQualifiedAccess>]
module AdmissionLaw =

    /// claim 自身来源能否进入准入：AgentOwnerRoot 与 continuation 可以；HumanRoot、
    /// HostInternal、UnknownOrigin 不行（HumanRoot 不能由 claim 签发）。
    let claimOriginAdmissible (origin: Origin) : bool =
        match origin with
        | Origin.AuthorityRoot RootKind.AgentOwnerRoot
        | Origin.Continuation _ -> true
        | Origin.AuthorityRoot RootKind.HumanRoot
        | Origin.HostInternal
        | Origin.UnknownOrigin -> false

    let private managedCarrier (input: AdmissionInput) =
        input.PromptKey.IsSome || input.ExplicitAgent.IsSome

    let private acceptedRootReplay (input: AdmissionInput) : Admission option =
        match input.AcceptedEvidence, input.SessionId, input.PhysicalId, input.PromptKey with
        | Some accepted, Some sessionId, Some physicalId, None when
            accepted.SessionId = sessionId
            && accepted.PhysicalId = physicalId
            && accepted.Origin = Origin.AuthorityRoot RootKind.HumanRoot
            && not input.HostInternal
            ->
            match input.ExplicitAgent with
            | Some explicitAgent when explicitAgent <> accepted.SelectedAgent ->
                Some(Admission.Reject AdmissionRejection.AcceptedParticipantConflict)
            | _ -> Some Admission.AcceptedRootReplay
        | _ -> None

    let private pendingPrompt (sessionId: string) (claim: PendingClaimFacts) (explicitAgent: string option) =
        match claim.SessionId = sessionId, claimOriginAdmissible claim.Origin, explicitAgent with
        | false, _, _ -> Admission.Reject AdmissionRejection.ClaimSessionMismatch
        | true, false, _ -> Admission.Reject AdmissionRejection.ClaimOriginNotAdmissible
        | true, true, Some agent when agent <> claim.SelectedAgent ->
            Admission.Reject AdmissionRejection.InvalidExplicitAgent
        | true, true, _ -> Admission.PendingPrompt

    let private externalRoot (input: AdmissionInput) (active: ActiveFacts option) =
        match input.ExplicitRootAgent, active with
        | None, _ -> Admission.Reject AdmissionRejection.InvalidExplicitAgent
        | Some agent, Some current when agent = current.SelectedAgent -> Admission.ActiveHumanContinuation
        | Some _, Some _ -> Admission.Reject AdmissionRejection.UnknownOriginWhileActive
        | Some _, None -> Admission.ExternalRoot

    let private unaccepted (input: AdmissionInput) (active: ActiveFacts option) =
        match input.PromptKey, input.ExplicitAgent, active with
        | Some _, _, Some current when current.Kind = RootKind.AgentOwnerRoot ->
            Admission.Reject AdmissionRejection.AgentOwnerRootPromptNotClaimed
        | Some _, _, _ -> Admission.Reject AdmissionRejection.PromptKeyNotClaimed
        | None, Some _, _ -> externalRoot input active
        // interaction-authority-009：省略 participant 字段的消息按 durable 活跃档案解析，省略本身不是 UnknownOrigin。
        | None, None, Some _ -> Admission.ActiveHumanContinuation
        | None, None, None -> Admission.Unmanaged

    let private withPhysical (input: AdmissionInput) (sessionId: string) (active: ActiveFacts option) =
        match input.AcceptedContinuation, input.LandedOrigin, input.PendingClaim, input.HostInternal with
        | Some continuation, _, _, _ -> Admission.AlreadyAccepted(Origin.Continuation continuation)
        | None, Some origin, _, _ -> Admission.AlreadyAccepted origin
        | None, None, Some claim, _ -> pendingPrompt sessionId claim input.ExplicitAgent
        | None, None, None, true -> Admission.HostInternal
        | None, None, None, false -> unaccepted input active

    let private resolveValid (input: AdmissionInput) : Admission =
        match input.SessionId, input.Authority, input.PhysicalId with
        | None, _, _ when input.HostInternal -> Admission.HostInternal
        | None, _, _ when managedCarrier input -> Admission.Reject AdmissionRejection.MissingSession
        | None, _, _ -> Admission.Unmanaged
        | Some _, None, _ when input.HostInternal -> Admission.HostInternal
        | Some _, None, _ when managedCarrier input -> Admission.Reject AdmissionRejection.AuthorityUnavailable
        | Some _, None, _ -> Admission.Unmanaged
        | Some _, Some active, None when managedCarrier input || active.IsSome ->
            Admission.Reject AdmissionRejection.MissingPhysical
        | Some _, Some _, None when input.HostInternal -> Admission.HostInternal
        | Some _, Some _, None -> Admission.Unmanaged
        | Some sessionId, Some active, Some _ -> withPhysical input sessionId active

    /// 入口准入的固定次序：畸形身份载体 → 已接受 HumanRoot 的重放 → 会话/快照/物理 id
    /// 的缺失 → 已接受或已落地的物理消息 → 精确 pending claim → Host 内部 → 未接受消息。
    /// HumanRoot 只在没有活跃运行、且宿主给出根上解析成功的显式 participant 时授予（ExternalRoot）。
    let admit (input: AdmissionInput) : Admission =
        match input.InvalidCarrier with
        | Some carrier -> Admission.Reject(AdmissionRejection.MalformedCarrier carrier)
        | None -> acceptedRootReplay input |> Option.defaultWith (fun () -> resolveValid input)
