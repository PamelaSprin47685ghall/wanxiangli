namespace Wanxiangli.Dispatch

/// 一次派发认领的生命周期事件（dispatch-protocol [002]）。
[<RequireQualifiedAccess>]
type ClaimEvent =
    | Submit
    | Accept
    | Abandon

/// 认领结算后宿主须对投影做的编辑；只描述"改什么"，不持有投影。
[<RequireQualifiedAccess>]
type LedgerEdit =
    /// 在待决认领上记下传输回执；认领仍待决（[003] 回执不是物理身份）。
    | RecordReceipt
    /// 从待决集合移除该认领。
    | DropPending
    /// 按 (会话, 载荷摘要) 覆盖写 occasion 视图（[006]）。
    | LandOccasion
    /// 按物理消息精确保留落地证据（[006]，永不被覆盖或抹去）。
    | LandExact
    /// 记下该物理消息是哪种 continuation（仅 Continuation 来源）。
    | RecordContinuation
    /// 清掉同载荷的 occasion 视图，使后续重入可以重新认领（[006][008]）。
    | ClearOccasion

/// 恢复核对的结论（[004][007]）：只有真实物理证据能证明落地，否则保持待决，不重发。
[<RequireQualifiedAccess>]
type Recovery =
    | Proven of physicalUserMessageId: string
    | StillPending of hasReceipt: bool

/// Host 对一次发送调用的回答（宿主 SendOutcome 的五种形状）。
[<RequireQualifiedAccess>]
type SendAnswer =
    | AdmittedWithReceipt
    | AdmittedWithPhysicalMessage
    | Retryable
    | Fatal
    | AcceptanceUnknown

/// 同步发送后认领账要做的事（dispatch-protocol [002][003][007]）。
[<RequireQualifiedAccess>]
type SendLedger =
    /// 记 Submitted（回执），认领仍待决；物理身份只由真实 ingress 建立。
    | Submit
    /// Host 直接给了真实物理 id：先记 Submitted 再记 PhysicalAccepted，四段链不跳级。
    | SubmitThenAccept
    /// 物理承接前的确定拒绝：显式 Abandoned(SendFailed)。
    | Abandon
    /// 结局未知：什么都不写，认领保持待决，留给恢复核对；绝不重发。
    | KeepPending

/// Detached 发送的观察结论（[009]）。
[<RequireQualifiedAccess>]
type DetachedVerdict =
    /// 已由 Host 承接；Detached 不凭 SDK 返回值写 PhysicalAccepted。
    | OwnedSettled
    | Refused
    | OutcomeUnknown

type SendVerdict =
    { Ledger: SendLedger
      /// 只有确定未发送（Retryable/Fatal 拒绝）才允许把 exact quiescence permit 归还为可重试（[007]）。
      DefinitelyNotSent: bool
      Detached: DetachedVerdict }

type RecoveryMessage =
    { Role: string
      PromptKey: string option
      Id: string }

module ClaimLaw =

    /// 恢复只搜最近这么多条消息（PROMPT-011 有界读；搜更远也不许重发）。
    let recoveryTailWindow = 50

    /// 缺席的身份作为显式标记参与摘要，"还没有逻辑运行"不会与"id 恰好为空串"相撞。
    let private field (value: string option) =
        match value with
        | Some text -> text
        | None -> "\u0000absent"

    /// ClaimSequence 的计数作用域：(SessionId, LogicalRunId, Origin, PayloadDigest)（[006]）。
    let claimScope (sessionId: string) (logicalRunId: string option) (origin: string) (payloadDigest: string) =
        System.String.Join("\u001f", [| sessionId; field logicalRunId; origin; payloadDigest |])

    /// PromptKey 的哈希原文（[005]）：确定性，不含 agent/peer/model，任一要素变动 key 都迁移。
    let promptKeyMaterial
        (sessionId: string)
        (logicalRunId: string option)
        (authorityRoot: string option)
        (origin: string)
        (payloadDigest: string)
        (claimSequence: int)
        =
        System.String.Join(
            "\u001f",
            [| sessionId
               field logicalRunId
               field authorityRoot
               origin
               payloadDigest
               string claimSequence |]
        )

    /// 下一个认领在该作用域携带的序号；注册即消费（[006]），放弃后再发得到新序号。
    let nextClaimSequence (consumed: int option) = (defaultArg consumed 0) + 1

    /// 该作用域是否已经认领过（无论结局）。失败的修复同样不许再来一次。
    let alreadyClaimed (consumed: int option) = nextClaimSequence consumed > 1

    /// 结算一个事件。pending = None 表示该 key 不在待决集合：已落地、已放弃或从未认领，
    /// 一律不改投影（确认不回退、重复回执不重复派发）。
    let settle (event: ClaimEvent) (pending: bool) (continuation: bool) : LedgerEdit list =
        if not pending then
            []
        else
            match event with
            | ClaimEvent.Submit -> [ LedgerEdit.RecordReceipt ]
            | ClaimEvent.Accept ->
                [ LedgerEdit.DropPending
                  LedgerEdit.LandOccasion
                  LedgerEdit.LandExact
                  if continuation then
                      LedgerEdit.RecordContinuation ]
            | ClaimEvent.Abandon -> [ LedgerEdit.DropPending; LedgerEdit.ClearOccasion ]

    /// 精确 occasion 是否已被准入（[007][008]）：同 (会话, 运行, 来源, 载荷) 仍有待决认领，
    /// 或该载荷的 occasion 视图以同一来源落地。只有显式放弃才重新打开。
    let occasionAdmitted (pendingSameOccasion: bool) (landedOrigin: string option) (origin: string) =
        pendingSameOccasion || landedOrigin = Some origin

    /// Host 对发送的回答 → 认领账动作、是否确定未发送、Detached 观察结论。
    let answer (sent: SendAnswer) : SendVerdict =
        match sent with
        | SendAnswer.AdmittedWithReceipt ->
            { Ledger = SendLedger.Submit
              DefinitelyNotSent = false
              Detached = DetachedVerdict.OwnedSettled }
        | SendAnswer.AdmittedWithPhysicalMessage ->
            { Ledger = SendLedger.SubmitThenAccept
              DefinitelyNotSent = false
              Detached = DetachedVerdict.OwnedSettled }
        | SendAnswer.Retryable
        | SendAnswer.Fatal ->
            { Ledger = SendLedger.Abandon
              DefinitelyNotSent = true
              Detached = DetachedVerdict.Refused }
        | SendAnswer.AcceptanceUnknown ->
            { Ledger = SendLedger.KeepPending
              DefinitelyNotSent = false
              Detached = DetachedVerdict.OutcomeUnknown }

    /// 恢复核对：只看最近 recoveryTailWindow 条，只认 role=user 且 PromptKey 完全一致的消息。
    let recover (promptKey: string) (hasReceipt: bool) (messages: RecoveryMessage list) =
        let count = List.length messages

        let window =
            if count <= recoveryTailWindow then
                messages
            else
                List.skip (count - recoveryTailWindow) messages

        window
        |> List.tryPick (fun message ->
            if message.Role = "user" && message.PromptKey = Some promptKey then
                Some message.Id
            else
                None)
        |> function
            | Some physical -> Recovery.Proven physical
            | None -> Recovery.StillPending hasReceipt
