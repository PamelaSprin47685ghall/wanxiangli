# failure — 执行失败决定与恢复尝试管理

层：内核纯计算与进程内状态。独立 npm 入口 `wanxiangli/failure`。在总流程中，本模块把执行过程中的异常观测换算成确切的下一步动作（重试、等待、终结），并由 ProviderAttemptStopFence 记录哪些 attempt 已停止自动重试、RecoveryAttemptPlanStore 保存恢复计划。

## 状态所有权
- **ExecutionFailurePolicy** 独占拥有五路失败后续动作的计算逻辑。
- **ProviderAttemptStopFence** 拥有进程内已停止自动重试的 attempt 集合及其等待者。
- **RecoveryAttemptPlanStore** 拥有推理前 attempt 计划、运行绑定与恢复干预存储。

## AXIOM
1. [使用者] 有些失败该重试，有些不该；重试会真正发起外部调用，必须有严格上限与明确授权。
2. [使用者] 未知结果必须保持未知，既不能盲目重发，也不能当成未发生。
3. [使用者] 释放容量许可必须指明是哪一次执行的许可，不能按计数随意减少。

## LEMMA
1. [AXIOM 1] 失败后的下一步动作分为五路：PreserveCurrentFact、AwaitAcceptanceReconciliation、RetryFreshAttempt、TerminalizeAcceptedPreProvider、TerminalizeProviderStarted。
2. [AXIOM 2] 结果未知时仅返回 `AwaitAcceptanceReconciliation`，并保留这次执行占用的容量许可，不盲目重发。
3. [AXIOM 1] `ProviderAttemptStopFence` 按（会话, providerRun）精确记录已停止的 attempt；停止后再注册同一 attempt 返回 `AlreadyStopped`，等待者被唤醒。
4. [AXIOM 1] `RecoveryAttemptPlanStore` 维护 attempt 计划的绑定与消费，支持人工恢复干预。

## SPEC（调用方流程）

1. **失败后续动作计算**：
   - 观测到执行故障时，调用 `decide` 传入上下文与故障事实。系统计算并返回明确的下一步动作（继续重试或终结处理），附带容量释放指示。
2. **重试停止记录**：
   - 决定停止自动重试时，调用 `SignalStop` 记下该次 attempt 已停止并唤醒等待者；此后同一 attempt 再来注册返回 `AlreadyStopped`，不再登记。
3. **恢复计划绑定与消费**：
   - 启动推理前冻结 AttemptPlan；绑定到具体运行后执行；终态达成后通过 `ConsumeAttemptPlan` 一次性消费清理。
