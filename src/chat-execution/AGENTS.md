# chat-execution — 受管对话执行生命周期

层：内核纯计算与进程内在途管理。独立 npm 入口 `wanxiangli/chat-execution`。在总流程中，本模块管理受管对话执行从接受、启动到终态的不可逆状态机，并独占维护内存中在途执行任务，防止相同执行并发重入或结果丢失。

## 状态所有权
- 纯计算逻辑独占拥有 `(session, physical user message)` 执行状态机。
- **ManagedChatExecutionFlight** 独占持有内存中的在途执行映射。
- 不持久化日志，不直接发起网络请求。

## AXIOM
1. [使用者] 一次受管 chat 执行由精确键（session, physical user message）唯一标识，依次经过 Accepted → ProviderStarted → Terminal；Terminal 终态只赋值一次。
2. [使用者] 从未到达 provider 的执行不可能 Completed；完成需要真实物理执行发生。
3. [使用者] 受管执行在途状态由进程内精确复合键（runtimeId, sessionId, physicalUserMessageId）唯一持有。

## LEMMA
1. [AXIOM 1] 状态折叠严格比对已记录的事实，相同事实幂等重放，冲突或越级状态明确拒绝。
2. [AXIOM 1, 2] 终态只允许一次赋值；未启动不得走 after-provider 终态，已启动不得走 pre-provider 结算。
3. [AXIOM 3] `ManagedChatExecutionFlight` 独占管理在途执行字典，支持 `beginFlight`、`finish` 与清理。

## SPEC（调用方流程）

1. **执行准入与启动**：
   - 用户消息到达时建立执行键并记录 Accepted；Provider 真正启动时推进至 ProviderStarted；并发重复请求通过在途管理器拦截。
2. **终态赋值与结算**：
   - 执行结束时传入物理结果（成功、失败、取消）。系统原子更新为对应终态，后续重复结果被幂等忽略，歧义结果报错拒绝。
3. **故障恢复**：
   - 恢复流程只认属于该执行的那条事实（键、provider run、身份种子都精确对上）；对于未知或歧义的外部状态，绝不盲目猜测完成，如实保持未决。
