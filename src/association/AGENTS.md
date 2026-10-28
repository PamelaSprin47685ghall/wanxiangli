# association

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不持有关联表、不写事实。npm 入口 `wanxiangli/association`。

# AXIOM

1. [使用者] 每个 Work 会话至多有一个同类卫星（Companion）；卫星只属于一个 Work 会话，自己不能再有卫星。
    - 理由：COMPANION-002；第二个 Companion 或递归 Companion 会让同一份上下文被并行改写。
2. [使用者] 关联先于卫星的首个 prompt 写下，且两侧作为同一事实一起写；重启恢复会重放同一关联。
    - 理由：HOST-008、managed-session-lifecycle；未关联先提示，下一次 transform 会给卫星再造一个卫星。

# LEMMA

1. [AXIOM 1] 判定次序固定：自链 → main 本身是卫星（递归）→ main 已有另一个同类卫星 → 卫星已属另一 Work → 卫星条目是 Work 或另一种卫星 → 接受。
2. [AXIOM 2] 同一对的重链幂等接受（恢复不变成启动失败）；接受时 main 的父取调用方提议值，否则沿用 main 已记录的父。
3. [AXIOM 1, 2] 键查找（两侧条目、main 已有的同类卫星）由调用方回答；本模块只裁决，不扫描、不改写。

# SPEC

1. [LEMMA 1, 2, 3] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `SessionAssociationProjection.linkSatellite` 逐项对照见 vibe-fs `evidence/CUT-12/`。

3. [使用者] TurnBindingStore 进程内自治管理逻辑会话的 userMessageBindings、activeBindings 与 continuationMessageIds 状态。
    - 理由：Package-14 (TurnBinding.Store 状态所有权抽取)；状态与合流规则迁入库，消除宿主可变字典。

# LEMMA

4. [AXIOM 3] TurnBindingStore 绑定与合流契约：
    - BindUserMessage 派生 root (PROMPT-002 promotion)，更新 physical 游标并保留已有 role。
    - BindContinuationUserMessage 累积 continuation 集合并更新 physical 游标。
    - BindPhysicalUserMaterial 仅更新 physical 游标，不造 root 也不造 continuation。
    - BindActiveRun 合并 continuation 集合。
    - activeRunBinding 合流时 durable authority 拥有 root，explicit 保留 physical/role/directory，continuationIds 取并集，Fission lane 继承 owner root。
    - tryPhysicalUserMessage 优先查 activeBindings，回退 userMessageBindings。
    - clearSession 彻底清空三字典并保持会话间状态隔离。

# SPEC

2. [LEMMA 4] 证明：`tests/002.test.mjs`（TurnBindingStore 7 大边界与反例规范）。
