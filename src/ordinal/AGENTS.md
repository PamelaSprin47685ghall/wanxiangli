# ordinal

层：纯数值。Sphinx v2 序数观测的似然原语唯一 owner；不得 import 宿主 SDK，不拟合、不声明收敛、不做设计判定。npm 入口 `wanxiangli/ordinal`。

# AXIOM

1. [使用者] 似然在对数空间稳定求值；±1000 的线性预测子不得产生 log(0) 或 NaN（sphinx-v2-025）。
2. [使用者] 平局有自己的机制（kappa），不是半个胜场；kappa → -∞ 时严格退化为二项 logistic（sphinx-v2-025）。
3. [使用者] 排名不是一袋独立对：Plackett–Luce 只接受完整严格序，复合对只作复合似然（sphinx-v2-014）；Borda 只是描述基线。

# LEMMA

1. [AXIOM 1] `logSigmoid`、`logSumExp` 与闭式一致且对大 |x| 有限。
2. [AXIOM 1] `directionalLogLikelihood` = logSigmoid(η)，`directionalGradient` 与数值导数一致。
3. [AXIOM 2] 三路概率和为 1；kappa = -1000 时胜率等于 logSigmoid(η)。
4. [AXIOM 3] 不完整 theta 或部分序返回 null；MaxDiff 按全部有序对归一。
5. [AXIOM 3] `compositePairs` 按名次给出 (前, 后)；`bordaCounts` 为每次出现的平均分。

# SPEC

1. [LEMMA 1–5] 证明：`tests/001.test.mjs`。
