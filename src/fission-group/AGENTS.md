# fission-group

层：内核。纯计算与状态门禁，不得 import 宿主 SDK 或其它 wanxiangli 模块；不比较 blob/session 值、不创建或中止 lane。npm 入口 `wanxiangli/fission-group`。

# AXIOM

1. [使用者] 一次 Fission 是同一位 participant 的 lane 集合：整组准入或整组拒绝，lane 次序与身份在准入时固定，之后不漂移。
    - 理由：INTRA-PARALLEL；部分 lane 接纳后隐藏失败，或替换 sibling 继承旧身份。
2. [使用者] 每个 lane 的工作、每个外部亲和绑定、接管与组终局各只有一个值：重放同值是幂等，不同值被拒，不覆盖。
    - 理由：按到达顺序拼历史、打断后重复执行。
3. [使用者] 组只能在每个 lane 都交出工作、每个 Fission 前的完成都送达每个 lane 后才收束；终局（收束或失败）只有一个，收束须由接管 lane 宣布。
    - 理由：某 lane 未结束却宣布整体完成。

4. [使用者] lane 请求、完成路由、环次序与终局 lane 是拓扑性质，不由回调到达次序决定；Fission 只消费已收束的 turn，不替 Turn 跑它自己的后继。
    - 理由：lane 次序漂移、按到达顺序拼历史、打断重复执行。

# LEMMA

1. [AXIOM 1] admitted：已有组同值 keep，异值 ConflictingGroup；laneCount < 2 或 session/prompt 数 ≠ laneCount → ConflictingGroup；owner 已有活跃组 → DuplicateOwnerActive；否则 set。
2. [AXIOM 2] 其余事件先 UnknownGroup，再 InvalidLane（laneIndex 越界），再 lane 身份（LaneSessionMismatch），再已有值 same → keep / different → 冲突，否则 set。completionCaptured 只收 Fission 前的完成；completionDelivered 只送已捕获的完成。
3. [AXIOM 3] convergenceReady：workedLanes 恰为 laneCount 个且都在界内，且每个 Fission 前完成的送达集合恰为 {0..laneCount-1}。takeover 与 converged 都要求 ready；converged：已收束同值 keep，已有终局 TerminalAlreadySet，接管 lane 不同 ConflictingTakeover；failed：已失败同因 keep，Open set，否则 TerminalAlreadySet。

4. [AXIOM 4] parsePrompts：少于 2 个 → TooFewLanes；第一个空白 lane → EmptyLanePrompt(index)；否则 lanes = n。routeCompletion：广播 → 0..n-1，lane 亲和 → 界内则 [lane] 否则 []。mergeOrder：n < 2 → []，否则 0..n-1；finalLane = n-1（n < 2 为 null）；successor：从 laneIndex 起顺环找第一个未关闭 lane（含自身最后一个），全关闭或非法为 null。
5. [AXIOM 4] settle：Ongoing/NeedsContinuation/ProviderFailed/DegenerationInterrupted → yield；ExternalAbort → fail；Completed → lane 为 materialize、takeover 为 complete。
# SPEC

1. [LEMMA 1–5] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `FissionProjection.fold` 逐项对照见 vibe-fs `evidence/CUT-28/`。

# FissionLaneRegistry

Fission 分道执行绑定注册表（单向映射 + 按 owner 线性扫描，不造假想结构）。
承担弥合宿主物理会话分配与全组原子落盘的时序承重职责。
公开接口：`bindLane`、`unbindLane`、`tryLane`、`tryOwner`、`logicalOwner`、`clearOwner`、`clearOwnerLanes`、`hydrateFromDurable`、`clearAll`。
单向维护 `lanes: Dictionary<laneSessionId, FissionLaneRecord>`，清空时对所有分道按 `OwnerSessionId` 线性扫描并返回移除结果。

# FissionRuntime

Fission 进程内运行时状态与单飞认领自治对象。
独占维护进程内跨调用状态：
- `silentInterrupts`: 静默中断标记集合（纯标记，tryConsume 不擅自删除，由 clearOwner 统一清空）；
- `groupResources`: 分组受控资源注册表（以安全捕获逐个 Dispose/dispose 释放，防范重入与异常中断）；
- `deliveryClaims`: 分组+完成+分道的三元组单飞交付认领栅栏（按代际维护，clearOwner 严禁提前清除，严格由交付任务的 finally 释放）；
- `takeoverClaims`: 分组收束接管单飞认领栅栏（受 clearOwner 统一清空）。
并组合 FissionLaneRegistry 协调原子清理（clearOwner 联动清空分道绑定、接管认领、分组资源与静默中断，保持交付认领自治）。
公开接口：`bindLane`、`unbindLane`、`tryLane`、`tryOwner`、`logicalOwner`、`installDurableLaneEvidence`、`markSilentInterrupt`、`clearSilentInterrupt`、`isSilentInterrupt`、`tryConsumeSilentInterrupt`、`trackGroupResource`、`disposeGroupResources`、`tryBeginDelivery`、`endDelivery`、`hasDeliveryClaim`、`tryBeginTakeover`、`endTakeover`、`hasTakeoverClaim`、`clearOwner`、`clearAll`。

# FissionAdmissionRegistry

Fission 进程内 single-flight owner 准入自治注册表。
独占维护进程内跨调用状态：
- `activeOwners: HashSet<string>`：当前处于活跃 Fission 准入中的 ownerSessionId 集合。
提供：
- `reserve(ownerSessionId: string): bool`：尝试独占预留准入。首次返回 true，重复返回 false；空白（null/undefined/whitespace）ownerSessionId 防御性拒绝返回 false。
- `isActive(ownerSessionId: string): bool`：检查是否活跃。空白返回 false。
- `release(ownerSessionId: string): unit`：释放指定 owner 的准入状态。空白静默无操作。
- `clear(): unit`：清空全部准入状态。
- `snapshot(): string array`：返回当前活跃 ownerSessionId 的已排序快照数组，防外部篡改。
导出单例 `fissionAdmissionRegistry`。
