# degeneration — 请求耗时检测与可靠性计数

层：内核。入口 `wanxiangli/degeneration`，导出类 `RequestLatencyDetector`、工厂 `createRequestLatencyDetector()`、单例 `requestLatencyDetector`，以及 ReliabilityCounters 全部既有导出。不依赖本仓其他模块，不读时钟、不做 I/O。

## RequestLatencyDetector

同一 session 的 provider 请求耗时 T 服从指数分布 Exp(λ)。**无先验**：λ 只由本 session 自己的观测估计（含右删失的最大似然）。每个 session 只存充分统计量，不保存任何原始样本：k（衰减完整样本数）、m（衰减删失样本数）、S（衰减总时长，完整样本的 t 与删失样本的 c 都计入），外加未衰减的原始观测条数 n（只用于新手保护期）。每次观测先把 k/m/S 整体乘遗忘因子 γ = 1 − 1/EffectiveWindow 再累加新观测，n 加 1。

常量（写死，不开放配置，减少接口面）：

- Percentile = 0.99
- ProtectionObservations = 100（新手保护期：p99 至少要见过 100 条观测才有意义）
- EffectiveWindow = 50（γ = 0.98）

公式：

- 完整样本：k ← γk + 1，S ← γS + t，n ← n + 1。
- 右删失样本：m ← γm + 1，S ← γS + c，n ← n + 1（k 不因删失增加，等价似然 exp(−λc)）。
- λ̂ = k/S；Cdf(t) = 1 − exp(−λ̂·t)。
- 阈值：n ≥ 100 且 k > 0 时 ThresholdMs = (S/k)·ln(1/(1−Percentile))；否则 +∞（保护期内不打断）。无地板，不存在第二套数字。
- 快照的 Alpha/Beta 字段就是 k/S（不再含先验），MeanMs = S/k（无估计时 +∞），Seen = n。

## AXIOM

1. [使用者] 一个 session 的请求耗时显著超出其自身历史分布时，调用方需要一条随该 session 自适应的明确阈值，而不是全局固定值；样本不足以支撑 p99 时宁可不判。
2. [开发者] 判定只消费调用方传入的耗时观测；库内不读时钟、不做 I/O。

## LEMMA

1. [AXIOM 1] 同一 session 的耗时 T ~ Exp(λ)，无先验。只存 (k, m, S) 与原始条数 n，k/m/S 每次整体乘 γ = 0.98 再累加。
2. [AXIOM 1] 右删失样本只贡献 S（等价似然 exp(−λc)），不增加 k。
3. [AXIOM 1] λ̂ = k/S；Cdf(t) = 1 − exp(−λ̂·t)；阈值 = (S/k)·ln(1/(1−Percentile))，无地板；n < 100 或 k = 0 时阈值 +∞、Cdf 恒 0。
4. [AXIOM 1, 2] 每个 session 内存 O(1)、与观测条数无关；有效样本数上限 1/(1−γ) = 50。Forget/Clear 只释放字典项。
5. [AXIOM 2] 快照是新对象，外部修改不回流；Snapshot/ThresholdMs/Cdf 不改统计状态；非法输入（空白 sessionId、非正时长、负 elapsedMs）被拒绝且不污染状态。

## SPEC

1. [LEMMA 1, 3] 冷启动阈值 +∞、零样本快照无先验数字；前 99 条观测阈值恒 +∞，第 100 条起严格符合公式；删失也计入保护期条数但不给速率。
    - 证明：`tests/004.test.mjs`。
2. [LEMMA 2, 3, 4] 删失只增 S；Cdf 与阈值自洽（阈值处精确 0.99）且单调递增；极快 session 阈值随观测收紧；充分统计量与逐条 γ^年龄 加权参考折叠一致；长序列后有效样本数不超过 50，删失权重衰减。
    - 证明：`tests/005.test.mjs`、`tests/006.test.mjs`。
3. [LEMMA 5] session 隔离、Forget、Clear、单例与工厂实例互不影响；非法输入抛错；快照外部修改不回流；只读调用不改状态。
    - 证明：`tests/007.test.mjs`。
4. [AXIOM 2] 产物不 import 兄弟模块或 node 内建，不触碰定时器与文件系统。
    - 证明：`tests/004.test.mjs` 的产物扫描。
5. ReliabilityCounters 全部既有导出保持可用。
    - 证明：`tests/008.test.mjs`。

## ReliabilityDiagnosticsStore

承接宿主可靠性诊断观测计数（Wave-2 Package-20）。
- 自治管理 12 类不可逆观测计数（冲突、队列满、致命结算、6类恢复决议、钩子失败、回退推进、流中止）。
- 内部并发保护，提供单调递增 `Record(kind)`、不可变快照 `Snapshot()` 与归零 `Reset()`。
- 导出类 `ReliabilityDiagnosticsStore`、单例 `reliabilityDiagnosticsStore` 及工厂 `createReliabilityDiagnosticsStore()`（同时提供 `ReliabilityCounters` 别名）。
