# authority — 消息来源权威与逻辑根管理

层：内核纯计算。独立 npm 入口 `wanxiangli/authority`。在总流程中，本模块确保用户写下的原文不被篡改或冒充，维护会话内唯一活跃逻辑根（Logical Run），并规定一次委托只能由哪条事实收尾。

## 状态所有权
- 纯计算，无进程内可变状态：独占拥有来源优先级、逻辑根冲突判定，以及「某一类根只允许哪一种收尾」的规则与 `ClosureWitness` 的规范编解码。
- [程序待改] `ClosureWitness` 这个名字与 `expectedClosureKind` / `admitClosure` 的分离形态是旧证明腔留下的包装：真实需要只有一条——关闭必须指名那条已经落盘的事实。名字与接口的收拢登记在根《例外清单》，本文不重复申说。

## AXIOM
1. [使用者] 用户写下的原文不能丢，也不能被机器文本冒充。因此系统必须分得清当下这句话是谁说的，以及它延续的是哪一次委托。
    - 理由：把插件或旧运行的话当成用户的新委托，会引发错误分支与权限放大。

## LEMMA
1. [AXIOM 1] 来源为闭集合：HumanRoot、AgentOwnerRoot、Continuation、HostInternal、UnknownOrigin；纯计算绝不推断新 HumanRoot。
2. [AXIOM 1] 一个会话同时只有一个活跃逻辑根；相同根的重放沿用既有实例，不同根必须等待当前根精确关闭。
3. [AXIOM 1] 关闭仅针对精确命名的运行，且必须说明是哪条事实使它结束；旧运行的关闭指令不能影响新运行。

## SPEC（调用方流程）

1. **来源解析与准入**：
   - 调用方传入消息与上下文调用 `resolveOrigin`。系统按固定优先级（Continuation → PromptKey 来源 → 内部合成 → AgentOwnerRoot → UnknownOrigin）解析来源，未授权输入判定为未知。
2. **活跃逻辑根登记**：
   - 发起新运行时调用 `register`。无活跃根时准入，相同根重放，不同根拒绝准入，消除多根并发冲突。
3. **逻辑根关闭**：
   - 运行完成时调用 `close`，传入要关闭的 `logicalRunId` 与 `rootId`，以及当前活跃根与上一条根。指名的正是活跃根返回 `close`；活跃根是别的运行返回 `mismatch`；已无活跃根而上一条正是它返回 `already-closed`（重放安全）；两者都对不上返回 `no-authority`。旧运行的关闭指令因此动不了新运行。
4. **收尾方式的查询与规范文本**：
   - 外层需要知道某类根合法收尾方式时调用 `expectedClosureKind`；需要把收尾写成持久字段时调用 `encodeClosureWitness` / `decodeClosureWitness`；重放恢复时用 `admitClosure` 判断这条收尾文本能否对上当前记录的根类型，对不上返回明确拒绝原因，不猜测。
