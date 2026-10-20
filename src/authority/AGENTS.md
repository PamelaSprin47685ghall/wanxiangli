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

# SPEC

1. [本模块 LEMMA 1, 2] `resolveOrigin` 按固定优先级：已接受的 continuation 物理消息 → 已 claim 的 PromptKey 自身来源 → Host 内部压缩/合成 → 带 PromptKey 且活跃根为 AgentOwnerRoot → UnknownOrigin。没有任何输入组合会得到未经 claim 的 HumanRoot。
    - 证明：`tests/001.test.mjs` SPEC[authority-001] 穷举 2×(5)×2×2×3 组输入。

2. [本模块 LEMMA 3] `register`：没有活跃根 → admit；与活跃根精确相同，或会话、根消息、根种类、身份种子相同（持久重放）→ replay；其余 → conflict。
    - 证明：`tests/001.test.mjs` SPEC[authority-002]，逐字段改动各给一个 conflict 反例。

3. [本模块 LEMMA 4] `close`：活跃运行正是 (LogicalRunId, RootId) → close；活跃运行是别的 → mismatch；无活跃运行而最后一个根正是它 → already-closed；否则 no-authority。`closeChildWork` 另要求活跃根为非 Manager 的 AgentOwnerRoot，否则 not-child-work。
    - 证明：`tests/001.test.mjs` SPEC[authority-003]。

4. 畸形输入（缺字段、非字符串标识、未知种类、非布尔标志）抛 ArgumentException，不猜测。标识只做逐字比较，空串也是一个合法的（不同的）值，不在本模块里另行解释。
    - 证明：`tests/001.test.mjs` SPEC[authority-004]。

# TODO

- 五类 ExpectedClosureKind 与 source witness 的精确匹配（interaction-authority-018）在宿主尚未实现（宿主当前只有 retirement witness 字符串）；先在宿主补齐事实，再迁入本模块。
- 投影重置（清空 run-scoped claims、continuation 映射、序列号、提问）与 durable fold 仍归宿主；是否迁入取决于 CUT-11 对 claim 账的处置。
