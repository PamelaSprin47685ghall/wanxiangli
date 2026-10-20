# failure

层：内核。不得 import 任何宿主 SDK。一次精确执行失败的唯一决议 owner（vibe-fs CUT-14 ①）；纯计算，不执行重试、清理或退出，不持有预算或 breaker 状态。npm 入口 `wanxiangli/failure`（`ExecutionFailurePolicy.decide`）。

# AXIOM

1. [使用者] 有些失败该重试，有些不该；而重试会真的再发一次请求，可能真的花第二份钱。
    - 理由：真实外部效果不可逆（总规则 LEMMA 1）。

# LEMMA

1. [本模块 AXIOM 1; 总规则 LEMMA 1] 决议按"我接下来要做什么"分类，不按"我遇到了什么"分类：继续、等、重试、终结（还没起 provider）、终结（已起 provider）。
    - 推理：分类只在产生不同动作时才有意义（总规则 LEMMA 1 只允许为不可逆处付代价）。按病因分类，会得到一堆永远映射到同一动作的别名。
    - 实现：`resolution` 只有 PreserveCurrentFact / AwaitAcceptanceReconciliation / RetryFreshAttempt / TerminalizeAcceptedPreProvider / TerminalizeProviderStarted 五路；breaker 迁移、fence 结算与是否致命随同一次决议给出。

2. [本模块 AXIOM 1] 未知结果保持未知；不知道就不重发，也不当成没发生。
    - 推理：重发可能做第二遍；当成没发生会让记录漏掉真实效果。
    - 实现：AcceptanceUnknown 与 PersistenceFailure(Unknown) 只得 AwaitAcceptanceReconciliation，并保留精确 fence。

3. [本模块 AXIOM 1] 容量的释放必须认这一次的许可，不能按计数减一。
    - 推理：按计数减一会释放到别人的许可上，并发上限名存实亡。
    - 实现：本模块只把调用方给的精确 fence 按引用交回（保留或释放），从不计数；无已接受事实时不释放。

4. [本模块 AXIOM 1; 总规则 LEMMA 1] 时间、错误文本、轮询次数不授权任何处置。
    - 推理：它们不是关于世界的证据。用它们决定重试，等于把等待时长当成因果。
    - 实现：输入里没有时间与错误文本；RetryFreshAttempt 只在 provider 已开始 ∧ breaker 关闭 ∧ 预算可用时给出，授权绑定（logical run, provider run, request kind），decisionId 长度前缀拼接，互异三元组不撞。

# SPEC

1. [本模块 LEMMA 1] 单一纯函数一次给出互斥决议；重试与终态不并存。
    - 证明：`tests/001.test.mjs` SPEC[failure-1]、SPEC[failure-3]、SPEC[failure-4]。

2. [本模块 LEMMA 2] 未知结果有独立的状态表示，不复用"失败"或"成功"。
    - 证明：`tests/001.test.mjs` SPEC[failure-2]。

3. [本模块 LEMMA 3] 容量许可是不可伪造的一次性值；释放携带它，重复释放幂等拒绝。
    - 证明：本模块部分 —— 精确 fence 按引用交回、无事实不释放：`tests/001.test.mjs` SPEC[failure-1]、SPEC[failure-4]。一次性与重复释放拒绝由 `wanxiangli/permit`、`wanxiangli/borrowing` 证明，不在本模块重复。

# TODO

- 连续失败上限的数值：预算（Available/Exhausted）与 breaker（Closed/Open）作为输入事实给出，由调用方 owner 维护；本包不计数。
- 与 delegation、process 的边界：本包只说"这个失败导致什么动作"，实际发送与执行在各自 owner。
- 旧系统的十一类失败照旧作为输入分类保留（vibe-fs execution-failure-policy 现行契约），但只映射到上面五路决议；fatal 只有 FatalAfterSettlement 一种，不另设登记表。
