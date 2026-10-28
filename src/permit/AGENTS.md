# permit

层：账本。精确执行容量许可的唯一 owner；不得 import 宿主 SDK，不选模型、不持有容量账本、不排队、不计数。npm 入口 `wanxiangli/permit`。

# AXIOM

1. [使用者] 一次物理执行占用的容量必须在这次执行结束时、且只在这次执行结束时归还；别人的结束、迟到的回执或伪造的凭据都不能归还它。
    - 理由：提前归还会让并发超出用户在 `wanxiangshu.mjs` 设下的上限；永不归还会卡死后续执行。

# LEMMA

1. [本模块 AXIOM 1] 许可绑定精确身份（会话、物理用户消息、角色、参与者、target）与一个 credit；每个会话只有一张当前许可，新签发替代旧许可，旧许可此后一律过期。
    - 推理：按 live session 计数或“计数减一”无法区分是谁的结束（execution-model-routing [003][012]）。
2. [本模块 AXIOM 1] 只有本实例签发、仍为当前、fence 一致的许可被认得；其余按未知/错 fence/过期拒绝，不改变任何状态。
    - 推理：同形对象或旧回执不能冒充当前执行。
3. [本模块 AXIOM 1] 生命周期 Pending → Committed → Released(PhysicalCompletion)，或 Pending → Released(BeforeProvider)；两种释放互斥，同种重复幂等，已提交不能再“提供方前释放”。
    - 推理：提供方已开始的执行只能随物理完成释放，否则同一请求可被释放两次。
4. [本模块 AXIOM 1] 提交与提供方前释放要求观察到的身份与许可逐字段一致。
    - 推理：运行中追加材料或换 target 不能偷换已准入的身份。

# SPEC

1. [LEMMA 1] 重复签发同身份同 credit 交还原许可；身份或 credit 变化签发新许可，旧许可 StaleFence。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2] null、伪造、他实例签发、过期、fence 不符的许可被拒绝且不改状态。
    - 证明：`tests/001.test.mjs`。
3. [LEMMA 3] 全部状态 × 证据的迁移表；物理释放只认当前许可的物理消息。
    - 证明：`tests/001.test.mjs`。
4. [LEMMA 4] 会话、物理消息、角色、参与者、target 不符依次给出拒绝。
    - 证明：`tests/001.test.mjs`。
5. [本模块 AXIOM 1] 迁移计数器（CapacityTransitionCounters）以自治对象维护 duplicate、stale、conflict 计数，接收 outcome 字符串分类记录或直接记录，提供快照与重置。
    - 推理：调用方根据底层许可迁移结果分类维护状态统计，无需宿主维护可变变量。
6. [本模块 AXIOM 1] 会话租约句柄缓存（SessionLeaseHandles）自治管理各会话句柄映射与单调递增序号（nextLeaseId / nextFence），并在栅栏分歧时坚决抛出异常。
    - 推理：宿主句柄的身份与单调性由库自治闭环维护，避免宿主端序号与库端许可序号脱节。

# SPEC

5. [LEMMA 5] CapacityTransitionCounters 正确按分类递增 duplicate、stale、conflict 并提供快照与重置。
    - 证明：`tests/002.test.mjs`。
6. [LEMMA 6] SessionLeaseHandles 对同会话同许可复用句柄，新许可单调递增 leaseId 与 fence，fence 分歧报错，提供 tryGetMatching 与独立实例隔离。
    - 证明：`tests/002.test.mjs`。
