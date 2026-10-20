# handle-lifecycle

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不持有 handle/work 表、不写事实、不比较 blob 值。npm 入口 `wanxiangli/handle-lifecycle`。

# AXIOM

1. [使用者] 一个委派 handle（及其下每个已准入 work）的终局只有一个赢家：terminal、send-failure、cancel 竞争同一格，先到者胜，后到者被拒，不覆盖。
    - 理由：EXEC-004；覆盖会让 join 报告与子会话真实结局不一致。
2. [使用者] 放弃是持久的；join 只消费可报告的终局（完成或放弃）一次并写墓碑，Active 没有可消费的载荷。
    - 理由：EXEC-009；同一结果被报告两次或旧 handle 结算新任务。
3. [使用者] 错误的完成补偿只能撤销与其 ref/digest 精确相同的完成格；真完成不能被坏补偿撤销。
    - 理由：clean-break 迁移；坏补偿撤销真终局会让工作重跑。

# LEMMA

1. [AXIOM 1, 2] handle：complete 只从 Active 到 CompletedAwaitingJoin；abandon 从 Active/CompletedAwaitingJoin 到 Abandoned；retire 从 CompletedAwaitingJoin/Abandoned 到 Retired（Active 拒 NotCompleted）。拒绝次序：无格 UnknownHandle → Retired HandleIsRetired → Abandoned AlreadyAbandoned → 已完成 AlreadyCompleted。
2. [AXIOM 3] rejectFalseCompletion：Active 幂等 keep；CompletedAwaitingJoin 且格匹配 → Active，否则 AlreadyCompleted。
3. [AXIOM 1, 2] work：先无格 WorkNotAdmitted，再遗留 LegacyWorkAmbiguous；complete 需 Active 且 kind≠Cancelled、ref 与 digest 俱在；abandon/void 只从 Active（到 Abandoned/Retired）；consume 先拒空白 consumptionId，完成格等于期望或放弃格配空 Cancelled 期望 → Retired。

# SPEC

1. [LEMMA 1, 2, 3] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `HandleProjection` 逐项对照见 vibe-fs `evidence/CUT-13/`。
