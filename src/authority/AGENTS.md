# authority

层：内核。不得 import 任何宿主 SDK。

# AXIOM

1. [使用者] 用户写下的原文不能丢，也不能被机器文本冒充。因此系统必须分得清当下这句话是谁说的，以及它延续的是哪一次委托。
    - 理由：把插件或旧运行的话当成用户的新委托，会凭空开一条新的逻辑运行、重置失败预算、扩大权威；这些后果不可撤回。

# LEMMA

1. [本模块 AXIOM 1] 来源是闭集合：AuthorityRoot（HumanRoot、AgentOwnerRoot）、Continuation、HostInternal、UnknownOrigin。无法证明的来源是 UnknownOrigin，失败关闭。
    - 推理：D-01 裁定（CUT-09，2026-10-21）。早期草稿"缺标记回退 human、只记诊断"与现行 interaction-authority [005][007][009] 冲突：回退 human 正是让未证明的消息获得根独占权。现行要求优先。

2. [本模块 AXIOM 1] 纯计算从不推断新的 HumanRoot。HumanRoot 只由入口边界凭显式 participant 授予。
    - 推理：本模块看不到外部接受证据；能返回 HumanRoot 的纯函数等于替入口签发权威。

3. [本模块 AXIOM 1] 一个会话同时只有一个活跃逻辑根。精确同一根的重放沿用它；任何别的根都要等它精确关闭。
    - 推理：两个同时活跃的根会让 continuation 不知道挂靠谁，旧根的回执可能结算新根。

4. [本模块 AXIOM 1] 关闭只命中精确命名的运行。旧运行的关闭不能关掉新运行；重复关闭幂等。
    - 推理：按"当前有人在跑"去关，会让迟到的旧证据结束一个无关的新委托。

5. [本模块 AXIOM 1] 入口准入只按已观察到的事实裁决，次序固定：畸形身份载体 → 已接受 HumanRoot 物理消息的重放 → 会话、durable 快照、物理 id 的缺失 → 已接受或已落地的物理消息 → 精确 pending claim → Host 内部 → 未接受消息。新的 HumanRoot 只在宿主给出根上解析成功的显式 participant、且没有活跃运行时授予；claim 自带的 HumanRoot 来源永远不可准入。
    - 推理：这是 LEMMA 2 所说的"入口边界"本身的规则。participant 解析与身份种子仍由宿主做，本模块只看"解析成功的规范名"这一事实，不自己推断谁是用户；没有这份显式证据的消息在活跃运行下一律 UnknownOriginWhileActive 或按活跃档案续接，不会升格为根（CUT-09-a）。

6. [本模块 AXIOM 1, LEMMA 4] 每个被接受的根唯一归入五类预期关闭之一：HumanRoot × Manager → HumanRootManagerLife，其余 HumanRoot → HumanRootManagedRun；AgentOwnerRoot 按宿主给出的生命周期归属（child / attached / internal-leaf）归入后三类，InternalLeaf 不论物理 Ownership。无法唯一归类的根（AgentOwnerRoot 缺归属、HumanRoot 带归属）没有类别，不得被接受。关闭只凭本类唯一合法的 source witness，且其 owner、运行、life 与被关闭的根逐字相同；生命周期 terminal 本身、请求、信号、观察都不是 witness（interaction-authority-018，CUT-09-b）。
    - 推理：按"有人结束了"去关，会让别类或别的运行的结束释放这个根的身份；witness 必须指名它关闭的正是哪一次。CUT-09-b 之前唯一的 writer 只为 HumanRoot × Manager life 写入裸 retirement id，durable 历史里存在这种记录，所以裸 id 只在该类下读作 LifeCompleted(life, id)，别类一律拒绝。

# SPEC

1. [本模块 LEMMA 1, 2] `resolveOrigin` 按固定优先级：已接受的 continuation 物理消息 → 已 claim 的 PromptKey 自身来源 → Host 内部压缩/合成 → 带 PromptKey 且活跃根为 AgentOwnerRoot → UnknownOrigin。没有任何输入组合会得到未经 claim 的 HumanRoot。
    - 证明：`tests/001.test.mjs` SPEC[authority-001] 穷举 2×(5)×2×2×3 组输入。

2. [本模块 LEMMA 3] `register`：没有活跃根 → admit；与活跃根精确相同，或会话、根消息、根种类、身份种子相同（持久重放）→ replay；其余 → conflict。
    - 证明：`tests/001.test.mjs` SPEC[authority-002]，逐字段改动各给一个 conflict 反例。

3. [本模块 LEMMA 4] `close`：活跃运行正是 (LogicalRunId, RootId) → close；活跃运行是别的 → mismatch；无活跃运行而最后一个根正是它 → already-closed；否则 no-authority。`closeChildWork` 另要求活跃根为非 Manager 的 AgentOwnerRoot，否则 not-child-work。
    - 证明：`tests/001.test.mjs` SPEC[authority-003]。

4. 畸形输入（缺字段、非字符串标识、未知种类、非布尔标志）抛 ArgumentException，不猜测。标识只做逐字比较，空串也是一个合法的（不同的）值，不在本模块里另行解释。
    - 证明：`tests/001.test.mjs` SPEC[authority-004]。

5. [本模块 LEMMA 5] `admit` 对 57,344 组输入与按 interaction-authority [005][007][009]、dispatch-protocol-006 独立写成的 oracle 逐一相同，18 种结论都出现；`external-root` 只在显式 participant 根上解析成功且无活跃运行时出现；畸形输入抛错。
    - 证明：`tests/002.test.mjs` SPEC[authority-005]。

6. [本模块 LEMMA 6] `expectedClosureKind` 把根映射到五类之一或 null。
    - 证明：`tests/003.test.mjs` SPEC[authority-6]。

7. [本模块 LEMMA 6] `encodeClosureWitness` 是 ClosureWitness 的唯一拼法（JSON 字符串数组，标签在前，按类定长）；`decodeClosureWitness` 与之互逆，别的文本一律 null。
    - 证明：`tests/003.test.mjs` SPEC[authority-7]。

8. [本模块 LEMMA 6] `admitClosure`：记录的 RootKind 与类别不一致 → root-kind-mismatch；别类 witness → witness-kind-mismatch；owner/运行/life 不同或任一字段为空 → witness-identity-mismatch；根缺 owner 运行或 life → closing-identity-missing；裸 id 只在 HumanRootManagerLife 下为 legacy，否则 malformed-witness。
    - 证明：`tests/003.test.mjs` SPEC[authority-8]，五类 × 别类、每个身份字段改值或置空各给反例；去掉 owner 比较的变异会使其变红。

# TODO

- 宿主目前只对 HumanRootManagerLife 有 source witness（Manager 交付退役）；其余四类的 durable terminal 与 AgentOwnerRoot 的生命周期归属宿主尚未记录，届时直接用本模块的 expectedClosureKind / admitClosure。
- 投影重置（清空 run-scoped claims、continuation 映射、序列号、提问）与 durable fold 仍归宿主；是否迁入取决于 CUT-11 对 claim 账的处置。
