# degeneration — 输出退化检测

层：内核。入口 `wanxiangli/degeneration`，导出工厂 `Degeneration(envelope)`。不依赖本仓其他模块，不分词、不读时间、不做 I/O。

承接主仓 `Execution/Session/LoopDetector` 的检测算法（CUT-30 裁决后的抽取子范围）。语料选择、包络派生与手动更新、`o200k_base` 分词留在主仓；中断当前 attempt、认领中止与续发属于宿主组合者 LoopSensor。

## AXIOM

1. [使用者] 模型陷入重复或乱码时，要尽早停下这一次尝试，而不是让它把预算烧完。
2. [开发者] 判定只看文本本身的统计，不看角色、语言或错误文本。

## LEMMA

1. [AXIOM 1, 2] 维护指数衰减加权相异计数 $D_t = \lambda D_{t-1} + r_t$：首次出现的 token $r_t=1$，再次出现 $r_t = 1-\lambda^{t-s}$（$s$ 为上次出现步数）。$D_0$ 为包络先验。
2. [AXIOM 1] $D_t$ 低于下界为 TooRepetitive，高于上界为 TooRandom；边界及区间内为 Normal。
3. [AXIOM 1] 每个 token O(1)；状态只存词表内已见 token 的最近步数，内存上限是词表大小，词表外 token 被拒绝。
4. [AXIOM 2] 包络是输入：从哪份语料、何时派生由组合者负责，本模块不内置数值。

## SPEC

1. [LEMMA 1, 2] 递推与分类与主仓原实现逐位一致。
    - 证明：`tests/001.test.mjs` 的手算用例；主仓 CUT-30 证据中的新旧双算。
2. [LEMMA 3] 整段先校验后提交；词表外、非整数 token 被拒绝且不改变统计；重复 token 不增长状态。
    - 证明：`tests/002.test.mjs`。
3. [LEMMA 4] 非法包络（λ 不在 (0,1)、上下界倒置、非有限数、accessor 字段）在建立时被拒绝；reset 回到先验；检测器互相隔离。
    - 证明：`tests/003.test.mjs`。

## ReliabilityDiagnosticsStore

承接宿主可靠性诊断观测计数（Wave-2 Package-20）。
- 自治管理 12 类不可逆观测计数（冲突、队列满、致命结算、6类恢复决议、钩子失败、回退推进、流中止）。
- 内部并发保护，提供单调递增 `Record(kind)`、不可变快照 `Snapshot()` 与归零 `Reset()`。
- 导出类 `ReliabilityDiagnosticsStore`、单例 `reliabilityDiagnosticsStore` 及工厂 `createReliabilityDiagnosticsStore()`（同时提供 `ReliabilityCounters` 别名）。
