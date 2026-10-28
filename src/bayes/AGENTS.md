# bayes

层：纯数值。Sphinx v2 有限离散假设集上精确贝叶斯后验的唯一 owner；不得 import 宿主 SDK，不调用模型、不读写存储、不把后验说成实际正确率。npm 入口 `wanxiangli/bayes`。

# AXIOM

1. [使用者] 只有合格因子进入后验；因子必须声明依赖组、覆盖全部假设、似然有限且在 [0,1]（sphinx-v2-009/025）。
2. [使用者] 同一观测 id 重复投递只算一次；同组不同 id 不得被静默吞掉，未声明联合因子时只保留首个并逐条记录被丢弃者（sphinx-v2-021）。
3. [使用者] 对数空间乘积与 log-sum-exp 归一，极小尺度不下溢，零先验保持为零；后验只在声明模型内成立（sphinx-v2-026）。

# LEMMA

1. [AXIOM 1] 假设少于 2、空键、重复键（报出真正重复的键）、非法先验、零先验质量、无合格因子、空依赖组、未知键、缺键、越界似然各有类型化故障。
2. [AXIOM 2] 同 id 重复不改变后验；同组不同 id 时 `dropped` 列出其余 id。
3. [AXIOM 3] 后验与闭式一致；似然 1e-300 量级仍归一；零先验后验为 0；全零似然报 NonPositivePartition。
4. [AXIOM 1] `priorOnly` 返回归一先验、`usedObservations` 为空，且与 `infer` 共用假设集契约。

# SPEC

1. [LEMMA 1–4] 证明：`tests/001.test.mjs`。
