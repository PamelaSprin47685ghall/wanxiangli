# degeneration — 请求耗时检测与可靠性计数

层：内核。入口 `wanxiangli/degeneration`，导出类 `RequestLatencyDetector`、工厂 `createRequestLatencyDetector()`、单例 `requestLatencyDetector`，以及 ReliabilityCounters 全部既有导出。不依赖本仓其他模块，不读时钟、不做 I/O。

## RequestLatencyDetector

同一 session 的 provider 请求耗时 T 服从指数分布 Exp(λ)；λ 取 Gamma(α, β) 先验（β 是 rate 参数）。每个 session 只存三个充分统计量，不保存任何原始样本：k（衰减完整样本数）、m（衰减删失样本数）、S（衰减总时长，完整样本的 t 与删失样本的 c 都计入）。每次观测先把三者整体乘遗忘因子 γ = 1 − 1/EffectiveWindow，再累加新观测。α = PriorAlpha + k，β = PriorBeta + S。删失与完整样本共用同一遗忘因子；有效样本数 k + m 上限为 EffectiveWindow。

常量（写死，不开放配置，减少接口面）：

- PriorAlpha = 5.0
- PriorBeta = 25000.0（毫秒；先验均值 β/α = 5s）
- Percentile = 0.99
- EffectiveWindow = 50（γ = 0.98）

公式：

- 完整样本：k ← γk + 1，S ← γS + t。
- 右删失样本：m ← γm + 1，S ← γS + c（α 不因删失增加，等价似然 exp(−λc)）。
- λ̂ = α/β（Gamma 后验均值速率）；Cdf(t) = 1 − exp(−λ̂·t)。
- 阈值：ThresholdMs = (β/α)·ln(1/(1−Percentile))。无地板，不做兜底，不存在第二套数字。

库内绝不读时钟：所有耗时由调用方传入。充分统计量使每个 session 内存 O(1)；指数遗忘让一次误判的删失观测按 γ^n 减弱；先验等于「见过 5 次、每次 5 秒」，使冷启动阈值落在真实回合节奏的量级上。

## AXIOM

1. [使用者] 一个 session 的请求耗时显著超出其自身历史分布时，调用方需要一条随该 session 自适应的明确阈值，而不是全局固定值。
2. [开发者] 判定只消费调用方传入的耗时观测；库内不读时钟、不做 I/O。

## LEMMA

1. [AXIOM 1] 同一 session 的耗时 T ~ Exp(λ)，λ ~ Gamma(α, β)。只存充分统计量 (k, m, S)，每次观测整体乘 γ = 0.98 再累加：α = 5 + k，β = 25000 + S。
2. [AXIOM 1] 右删失样本只贡献 β（等价似然 exp(−λc)），不增加 α。
3. [AXIOM 1] λ̂ = α/β；Cdf(t) = 1 − exp(−λ̂·t)；阈值 = (β/α)·ln(1/(1−Percentile))，无地板。
4. [AXIOM 1, 2] 每个 session 只存三个数，内存 O(1)、与观测条数无关；有效样本数上限 1/(1−γ) = 50。指数遗忘让一次误判的删失观测按 γ^n 减弱；先验等于「见过 5 次、每次 5 秒」。Forget/Clear 只释放这三个数的字典项。
5. [AXIOM 2] 快照是新对象（MeanMs = β/α），外部修改不回流；Snapshot/ThresholdMs/Cdf 不改统计状态；非法输入（空白 sessionId、非正时长、负 elapsedMs）被拒绝且不污染状态。

## SPEC

1. [LEMMA 1, 2] 冷启动阈值、完整样本与删失样本的后验参数及阈值严格符合公式；50 条 5000ms 样本让阈值回到冷启动同值。
    - 证明：`tests/004.test.mjs`、`tests/005.test.mjs`。
2. [LEMMA 3, 4] Cdf 与阈值自洽（阈值处精确 0.99）且单调递增；极快 session 阈值随观测收紧；充分统计量与逐条 γ^年龄 加权参考折叠一致；长序列后有效样本数不超过 50，删失权重衰减。
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
