# handle-lifecycle — 委派 Handle 状态与 Join 租约

层：内核纯计算与进程内状态自治。独立 npm 入口 `wanxiangli/handle-lifecycle`。在总流程中，本模块管理委派任务 handle（及子任务）的终态竞争判定、墓碑写入，并通过 JoinAttemptRegistry 确保目标会话的 Join 尝试独占互斥。

## 状态所有权
- 纯计算状态机独占拥有 Handle 与 Work 的状态转移规则。
- **JoinAttemptRegistry** 独占持有目标会话活跃 Join 租约与消息去重集合。

## AXIOM
1. [使用者] 一个委派 handle 的终局只有一个赢家：terminal、send-failure、cancel 竞争同一格，先到者胜，后到者被拒，不覆盖。
2. [使用者] 放弃是持久的；join 只消费可报告的终局（完成或放弃）一次并写墓碑，Active 没有可消费的载荷。
3. [使用者] 进程内 Join 尝试租约对同一目标会话严格独占；重复用户消息仅去重防重放，不重复唤醒。

## LEMMA
1. [AXIOM 1, 2] handle 状态机：Active → CompletedAwaitingJoin → Retired / Abandoned；竞争时首个终态胜出，后到者报错。
2. [AXIOM 3] `JoinAttemptRegistry`：同一 target 仅授予一个活跃租约，并发尝试报冲突；新消息到达且有租约时触发唤醒，无租约时仅作去重。

## SPEC（调用方流程）

1. **Handle 状态推进与竞争判定**：
   - 任务完成时调用 `complete`，任务取消时调用 `abandon`。并发竞争时先到者写入状态，后到者返回已完成/已放弃错误。
2. **结果消费与墓碑清理**：
   - Join 操作认领已完成 handle 时一次性提取结果并置为 Retired 墓碑，杜绝同一结果被二次消费。
3. **Join 尝试独占与消息唤醒**：
   - 调用方通过 `acquire` 竞争目标会话 Join 租约；收到消息时调用 `signalVisibleUserMessage` 唤醒等待者；完成后释放租约。
