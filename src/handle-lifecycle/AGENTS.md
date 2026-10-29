# handle-lifecycle

层：内核。纯计算与进程内状态自治，不得 import 宿主 SDK 或其它 wanxiangli 模块；npm 入口 `wanxiangli/handle-lifecycle`。

# AXIOM

1. [使用者] 一个委派 handle（及其下每个已准入 work）的终局只有一个赢家：terminal、send-failure、cancel 竞争同一格，先到者胜，后到者被拒，不覆盖。
    - 理由：EXEC-004；覆盖会让 join 报告与子会话真实结局不一致。
2. [使用者] 放弃是持久的；join 只消费可报告的终局（完成或放弃）一次并写墓碑，Active 没有可消费的载荷。
    - 理由：EXEC-009；同一结果被报告两次或旧 handle 结算新任务。
3. [使用者] 错误的完成补偿只能撤销与其 ref/digest 精确相同的完成格；真完成不能被坏补偿撤销。
    - 理由：clean-break 迁移；坏补偿撤销真终局会让工作重跑。
4. [使用者] 重启恢复只能从持久事实与可证明的 Host 观察下结论：中断（abort）不是 Host 观察，也不是完成；旧的 AbortedObserved 字符串进到恢复入口时按畸形观察拒绝。未证明的状态不得发放许可。
    - 理由：P0-RECOVERY-JOIN-001、GREEN-4；把 abort 装成观察、当成完成，或把未知当活着，会让 join 报告假结局。
5. [使用者] 进程内 Join 尝试租约（JoinAttemptRegistry）对同一目标会话严格独占；可见用户消息仅唤醒当前活跃租约，无租约时仅作去重防重放，不排队不补发。
    - 理由：EXEC-017 / Package-08；重复消息不能打断后继 Join，多个并发 Join 必须互斥裁决。

# LEMMA

1. [AXIOM 1, 2] handle：complete 只从 Active 到 CompletedAwaitingJoin；abandon 从 Active/CompletedAwaitingJoin 到 Abandoned；retire 从 CompletedAwaitingJoin/Abandoned 到 Retired（Active 拒 NotCompleted）。拒绝次序：无格 UnknownHandle → Retired HandleIsRetired → Abandoned AlreadyAbandoned → 已完成 AlreadyCompleted。
2. [AXIOM 3] rejectFalseCompletion：Active 幂等 keep；CompletedAwaitingJoin 且格匹配 → Active，否则 AlreadyCompleted。
3. [AXIOM 1, 2] work：先无格 WorkNotAdmitted，再遗留 LegacyWorkAmbiguous；complete 需 Active 且 kind≠Cancelled、ref 与 digest 俱在；abandon/void 只从 Active（到 Abandoned/Retired）；consume 先拒空白 consumptionId，完成格等于期望或放弃格配空 Cancelled 期望 → Retired。
4. [AXIOM 4] recoverChild 次序：持久 Abandoned → abandoned(durable)，durableReason 只接受 ParentCancelled/DeadlineExceeded/HostSessionGone/Voided 之一；持久 CompletedAwaitingJoin → terminal(durable)；持久 Retired → blocked；其余看快照：Terminal 证据成立 → terminal(snapshot)，不成立 → blocked(原因)；Unreadable → incomplete；Missing/Active 看观察。
5. [AXIOM 5] JoinAttemptRegistry 契约：
   - acquire(target, attempt): 同一 target 若已有租约返回 AlreadyAcquired 冲突；无则授予租约。
   - release(target, attempt): 幂等注销活跃租约；释放后同一 target 可再次 acquire。
   - signalVisibleUserMessage(target, messageId): 重复 messageId 返回 DuplicateMessage 且不唤醒；新 messageId 在有活跃租约时返回 UserMessageArrived 唤醒事实并标记租约，无活跃租约时仅记入去重集合并返回 NoActiveLease，不唤醒后继租约。
   - clearSession(target): 隔离排空指定会话的租约与去重集合，不污染其他会话。

# SPEC

1. [LEMMA 1, 2, 3, 4] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `HandleProjection` 逐项对照见 vibe-fs `evidence/CUT-13/`。
2. [LEMMA 5] 证明：`tests/002.test.mjs`；覆盖独占冲突、Release 后再 Acquire、无租约去重不唤醒、有租约立即唤醒、重复消息不唤醒、会话清理隔离。
