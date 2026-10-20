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
