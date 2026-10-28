# failure-budget — Provider 失败预算管理

层：内核纯计算。独立 npm 入口 `wanxiangli/failure-budget`。在总流程中，本模块为逻辑运行中的模型服务（Provider）调用维护连续失败预算、精确 attempt 去重以及重试授权判定，防止模型连续出错引发无限重复调用与资金失控。

## 状态所有权
- `ProviderFailureBudget` 纯数据计算，独占拥有失败 attempt 窗口（默认容量 32）、连续失败计数与终态判定逻辑。
- 不直接发起重试，不写入持久存储。

## AXIOM
1. [使用者] 每一次自动重试都是一次真实请求，可能真的再花一份钱；自动重试必须有上限。
    - 理由：外部效果不可逆，重试失控会导致严重损失。
2. [使用者] 同一次失败可能被观察到多次（重放、恢复、并发回调），不能重复计入。

## LEMMA
1. [AXIOM 1, 2] 计数仅针对“新的精确 attempt”：键由 `(session, logical run, authority root, provider run)` 构成，同一键仅计入一次。
2. [AXIOM 1] 计数必须单步递增；达到上限时状态转为 `AlreadyExhausted` 并成为终态。
3. [AXIOM 1, 2] 发生重放查询时，只有最新一次失败的 attempt 且预算未超限才授予重试许可（`RetryAuthorized`）。

## SPEC（调用方流程）

1. **失败记录与状态推进**：
   - 观测到 Provider 报错时，调用 `applyFailure`。若属于重复回调则幂等返回；若为新失败且符合单步递增，推进计数。
   - 若失败计数超出设定的上限（默认 10 次），返回耗尽终态，阻断后续重试。
2. **重试授权查询**：
   - 调度器在准备重试前调用 `replay`。若当前 attempt 为最新且预算充足，返回 `RetryAuthorized`；否则拒绝重试。
