# delegate-batch

层：内核。纯计算与进程内状态自治，不得 import 宿主 SDK 或其它 wanxiangli 模块；不完成任何 Task；不订阅或拉取物理宿主事件，只接收宿主已提取的中立事实；拥有进程内语义批次自治状态，但不持有宿主异步运行时资源。npm 入口 `wanxiangli/delegate-batch`。

# AXIOM

1. [使用者] 一个专属 delegate（owner scope × role）同时至多一个已准入批次；新调用在已有批次时被拒，不排队、不另建重复工作。
    - 理由：EXEC-026；busy 时另建重复工作。
2. [使用者] 语义批次只由 ProviderRun 与 provider 的工具调用次序定义，不由调度时序定义；批次齐了才整批准入，按 provider 次序。
    - 理由：EXEC-031；按到达时序拼批会把两次 provider 运行混成一批。
3. [使用者] 专属 delegate 呼叫与退役严格具备单飞互斥；已退役子代理在父作用域下至多暂存一项，后续退役显式替换并促成旧草稿清理。
    - 理由：EXEC-026 / Package-14；避免孤儿会话与状态悬空。

# LEMMA

1. [AXIOM 1] admit：active → ActiveBatch；无批次身份且有 pending → BatchPending，否则 single。
2. [AXIOM 2] 有批次身份：callOrder 为空、有重复或不含 currentCall → InvalidBatch；pending 存在但 providerRun 或 callOrder 不同 → OtherRunPending；currentCall 已收到 → DuplicateCall；否则收下，齐（收到数 = callOrder 长度）→ ready（order = callOrder），不齐 → wait；无 pending 时 open = true。
3. [AXIOM 2] observedBatch：同 role 的宿主观察调用按宿主次序，含 currentCall 才成批，否则 null。
4. [AXIOM 3] RetiredDelegateRegistry：
   - stage(scope, sid)：记录当前暂存代理，若已有旧值返回 Some previous 供即时草稿清理；
   - tryTake(scope)：原子取出并消费；
   - clearAll()：清空全部暂存代理。
5. [AXIOM 1, 2] SyncDelegateBatchStore：
   - 纯 Key 结算协议：库内仅维系纯数据键（ownerScope, role, delegateSession, callId）与阶段，不持宿主 TCS/IDisposable；
   - 双向调用索引：callsByOwnerScope 与 callsByDelegate 在单锁内原子一致变更；
   - 批次状态机：Pending → Ready → Active → Closed 显式受控；
   - cancelScope / clearAll 返回结构化纯 Key Settlement 列表，供宿主解耦释放资源。

# SPEC

1. [LEMMA 1, 2, 3] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `SyncDelegateStoreOps` 逐项对照见 vibe-fs `evidence/CUT-13/`。
2. [Package-15] JoinGuardReservationStore 证明：`tests/002.test.mjs`。
3. [LEMMA 4, 5] SyncDelegateBatchStore 与 RetiredDelegateRegistry 证明：`tests/003.test.mjs`。

# Package-15 JoinGuardReservationStore

1. [使用者] 进程内 JoinGuard 针对 (sessionId, terminalProviderRun) 的单飞提醒去重由 JoinGuardReservationStore 自治拥有。
2. [规矩] formatKey 严格生成 "join-guard:" + sessionId + ":" + terminalProviderRun。
3. [原子性] tryReserve 在全局锁内原子检查外部 hasOutstandingJoinClaim 谓词、全局 processKeys 以及传入的局部 scope：任一已占用或外部有未决 claim 则拒绝（返回 None/undefined）；通过时原子写入 processKeys 与 scope 并返回 Some(key)。
4. [释放与清理] release 同步从 processKeys、传入 scope 与已追踪 scopes 移除 key；clearSession 按前缀同步清理指定会话；clearAll 清空全部状态。
