# dispatch

层：账本规则。派发认领账（dispatch claim ledger）的唯一规则 owner；不得 import 宿主 SDK，不持有投影、不哈希、不读 journal、不调用 Host 发送。npm 入口 `wanxiangli/dispatch`。

# AXIOM

1. [使用者] 插件发出的每一条 user-shaped 消息至多产生一次逻辑效果；结局未知时宁可保留待决也不重发，也不伪称成功。
    - 理由：重复派发会让模型收到两遍同一指令、重复消耗预算；伪造的落地会让后续阶段在不存在的消息上推进。

# LEMMA

1. [本模块 AXIOM 1] PromptKey 是 (会话, 逻辑运行, 根, 来源, 载荷摘要, ClaimSequence) 的确定性原文的哈希；缺席字段用显式标记，不含 agent/peer/model。
    - 推理：dispatch-protocol [005]；同一逻辑交互在任何进程派生同一 key，空串与缺席不得相撞。
2. [本模块 AXIOM 1] ClaimSequence 在 (会话, 逻辑运行, 来源, 载荷) 作用域内注册即消费；放弃后再发得到新序号。
    - 推理：dispatch-protocol [006]；否则放弃的派发与其重试派生同一 key，恢复会把两次行为当成一次。
3. [本模块 AXIOM 1] 只有待决认领能被结算：Submit 只记回执、认领仍待决；Accept 移出待决、覆盖 occasion 视图并按物理消息精确留证（continuation 另记种类）；Abandon 移出待决并清 occasion，永不抹去精确落地证据；不在待决集合的 key 一律不改投影。
    - 推理：dispatch-protocol [002][003][006]，effect-accounting [004] 确认不回退、重复回执不重复派发。
4. [本模块 AXIOM 1] 精确 occasion 只要仍有同 occasion 的待决认领、或以同一来源落地，就已被准入；只有显式放弃才重新打开。
    - 推理：dispatch-protocol [007][008]；Pending/Submitted/PhysicalAccepted 都不可重发。
5. [本模块 AXIOM 1] 恢复只凭最近 50 条中 role=user 且 PromptKey 完全一致的物理消息证明落地；找不到就保留待决并区分有无回执，绝不重发或放弃。
    - 推理：dispatch-protocol [004][007]，effect-accounting [002][005]。

6. [本模块 AXIOM 1] Host 的发送回答只决定一次认领账动作：回执 → Submitted；真实物理 id → Submitted 再 PhysicalAccepted；物理承接前的确定拒绝 → 显式放弃且只有它算"确定未发送"；结局未知 → 不写任何事实、保持待决。Detached 不凭 SDK 返回值写 PhysicalAccepted。
    - 推理：dispatch-protocol [002][003][007][009]，effect-accounting [002][006]。

7. [本模块 AXIOM 1] 运行边界（新根登记或精确关闭）上，运行作用域的待决认领、序号计数、continuation 映射与提问随运行结束；还没有逻辑运行的根认领和本会话的根计数属于会话，保留。
    - 推理：旧运行的认领不能在新运行里落地；根计数若随运行重置，同会话下一次同载荷根认领会派生出与被放弃的那次相同的 PromptKey（dispatch-protocol [006]）。

# SPEC

1. [LEMMA 1] 原文确定、任一要素变动即迁移、缺席标记与空串不相撞、序号必须 ≥ 1。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2] 序号从 1 开始逐次递增；已认领判定。
    - 证明：`tests/001.test.mjs`。
3. [LEMMA 3] 三种事件 × 待决与否 × 来源种类的编辑与独立 oracle 一致；投影模型上同载荷两次落地保留两条精确证据。
    - 证明：`tests/001.test.mjs`。
4. [LEMMA 4] occasion 准入真值表。
    - 证明：`tests/001.test.mjs`。
5. [LEMMA 5] 窗口边界、非 user 角色、近似 key、回执区分。
    - 证明：`tests/001.test.mjs`。
6. [LEMMA 6] 五种回答的 ledger/definitelyNotSent/detached 与独立 oracle 一致；未知回答形状抛错。
    - 证明：`tests/002.test.mjs`。
7. [LEMMA 7] 留下的认领与计数与独立 oracle 一致（含他会话根计数、空串运行 id 不算缺席）；保持输入顺序；畸形输入抛错。
    - 证明：`tests/003.test.mjs`。

# LEMMA (DeliveryAttemptLedger)

8. [本模块 AXIOM 1] 交付 attempt 台账（DeliveryAttemptLedger）进程内持有精确围栏记录（session * providerRun * callId），区隔已成立（提交面）、已呈现、中断发出、中断观察四类事实；登记时的物理用户消息构成防误停新输入的物理围栏，已有物理围栏不被后来的登记改写。
    - 进门校验与 fail-closed 契约：所有接收 `fence`、`physical` 或 `witness` 的成员均在进门处做严格形状与非空校验。缺少字段、非对象或包含空白/undefined/null 字符串的畸形输入一律 fail-closed（修改成员返回 `false`，查询成员返回 `None` / `undefined`），绝不静默拼装垃圾键或向状态字典写入脏记录。
    - 返回值语义：`recordEstablished`、`recordPresented`、`recordInterruptIssued`、`recordInterruptObserved` 返回 `bool`，`true` 表示入参围栏合规且状态已成功登记或合并，`false` 表示围栏畸形遭拒绝且内部状态严格保持不变。
    - activeInterruptTask 键语义与 sequence 最新规则：记录键为三元 `sessionId:providerRun:callId`，查找按二元 `sessionId + providerRun` 聚合。同一 run 下若存在多个 callId 均持有中断任务，严格按内部单调递增 `sequence` 降序选取最新者（即最后一次执行中断发出的 attempt 任务胜出），消除多 callId 并发查询的随机性。
    - InterruptTask 生命周期与宿主所有权契约：`InterruptTask` 为宿主拥有的并发 Task / Promise 原生句柄，库侧仅以不透明 `obj option` 原样持有并按序返回，库端绝不主动触发 await、检查状态或管理生命周期；宿主（`HostTurnObserver.fs`）负责单点 unbox 并在安全上下文中 await。已 fault、已被前序分支 await 或插件重启导致的陈旧句柄由 .NET Task 完成态契约天然化解（已完成的任务再次 await 为立即完成无害 no-op）。
    - clear() 生产隔离定位：`clear()` 属于测试与隔离沙箱专用的全量重置通道。生产路径严禁调用 `clear()`（必须且只能按会话调用 `dropSession(sessionId)`），以根绝跨插件实例或多会话并发环境下的误清扫与数据污染。
    - Durable 见证解耦：进程内快速路径与 durable 见证严格分离。durable 见证作为纯数据切片输入，按 `confirmedFence` 精确比对物理输入且最新见证胜出；未查得见证不等于未曾交付，只是当前无法证明其已落盘。

# SPEC (DeliveryAttemptLedger)

8. [LEMMA 8] 物理输入不匹配的陈旧见证被拒、最新匹配见证胜出、重复记录不重复完成、清空后 hasDurableEstablished 为假、不同 ToolCallId 互不影响、畸形输入严格 fail-closed 拒绝且不污染状态、同 run 多 callId 中断任务按 sequence 最新胜出。
    - 证明：`tests/004.test.mjs`。

# LEMMA (PromptPhysicalAcceptance)

9. [本模块 AXIOM 1] 物理确认（PromptPhysicalAcceptance）进程内自治持有每个 PromptKey 对应的单次确认回调与异步等待者字典；物理到达时原子提取并排空，且单次结算；取消与超时具备局部性，旧租约释放绝不误删覆盖后的新条目（ABA 防御）。
    - Exactly-once 结算：accepted(key, pid) 与 cancel(key) 在 gate 锁内原子取走全部 callbacks 与 waiters 并物理移除键，排空后再执行外部回调通知与 waiters 结算。
    - 引用同一性防误注销（ABA 防御）：register 返回的 IDisposable 在 Dispose 时，严格核对当前条目的引用同一性，只有匹配时才删除；已被新 register 覆盖的旧租约释放为安全 no-op。
    - 局部取消与防泄漏：beginConfirmation 返回的租约释放时仅从 ResizeArray 中移除自身 waiter，当数组清空时自动从字典清理 key；绝不误伤同一 key 上的其他并发 waiter。
    - 超时回退确定性：优先遵循调用方显式传入的 timeoutMs（大于 0 时生效）；未提供时安全回退至环境变量 WANXIANGSHU_ADMISSION_TIMEOUT_MS，解析失败稳定回退至 10000ms。
    - 迟到安全与重入防御：对不存在的 key 调用 accepted/cancel/rejected 为安全 no-op；回调中重入调用同一单例的成员时，因原始状态已原子排空，不会发生死锁或状态污染。

# SPEC (PromptPhysicalAcceptance)

9. [LEMMA 9] 单次回调通知、waiters 全量结算、ABA 覆盖后旧租约释放不删新监听、多等待者局部取消与防泄漏、超时与环境变量解析确定性、迟到到达安全忽略、回调重入安全。
    - 证明：`tests/005.test.mjs`。
