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
