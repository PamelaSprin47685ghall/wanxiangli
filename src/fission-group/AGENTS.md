# fission-group

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不持有组表、不比较 blob/session 值、不创建或中止 lane。npm 入口 `wanxiangli/fission-group`。

# AXIOM

1. [使用者] 一次 Fission 是同一位 participant 的 lane 集合：整组准入或整组拒绝，lane 次序与身份在准入时固定，之后不漂移。
    - 理由：INTRA-PARALLEL；部分 lane 接纳后隐藏失败，或替换 sibling 继承旧身份。
2. [使用者] 每个 lane 的工作、每个外部亲和绑定、接管与组终局各只有一个值：重放同值是幂等，不同值被拒，不覆盖。
    - 理由：按到达顺序拼历史、打断后重复执行。
3. [使用者] 组只能在每个 lane 都交出工作、每个 Fission 前的完成都送达每个 lane 后才收束；终局（收束或失败）只有一个，收束须由接管 lane 宣布。
    - 理由：某 lane 未结束却宣布整体完成。

# LEMMA

1. [AXIOM 1] admitted：已有组同值 keep，异值 ConflictingGroup；laneCount < 2 或 session/prompt 数 ≠ laneCount → ConflictingGroup；owner 已有活跃组 → DuplicateOwnerActive；否则 set。
2. [AXIOM 2] 其余事件先 UnknownGroup，再 InvalidLane（laneIndex 越界），再 lane 身份（LaneSessionMismatch），再已有值 same → keep / different → 冲突，否则 set。completionCaptured 只收 Fission 前的完成；completionDelivered 只送已捕获的完成。
3. [AXIOM 3] convergenceReady：workedLanes 恰为 laneCount 个且都在界内，且每个 Fission 前完成的送达集合恰为 {0..laneCount-1}。takeover 与 converged 都要求 ready；converged：已收束同值 keep，已有终局 TerminalAlreadySet，接管 lane 不同 ConflictingTakeover；failed：已失败同因 keep，Open set，否则 TerminalAlreadySet。

# SPEC

1. [LEMMA 1, 2, 3] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `FissionProjection.fold` 逐项对照见 vibe-fs `evidence/CUT-28/`。
