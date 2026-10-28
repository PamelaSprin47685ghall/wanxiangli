# run-witness — Provider 运行观察暂留

层：内核进程内状态。独立 npm 入口 `wanxiangli/run-witness`。在总流程中，本模块只回答两个问题：这一次模型请求（Provider Run）当时用的是哪个 target、它对应哪条物理用户消息；以及下一次准入要不要原样重试某个 target。两者都是进程内瞬态，重启即无。

[程序待改] 包名与类型名带 witness，接口还把同一份观察拆成 run→target 与会话→重试目标两张表；真实需要上面那两句话就能说完。收拢或改名登记在根《例外清单》，本文不再申说。

## 状态所有权
- 独占持有进程内四张表：run → `(session, target)`、session → 当前最新 run、session → 待原样重试的 target、run → `(session, physicalUserMessageId)`。
- 模块不直接调用宿主 SDK，不选择模型，不判定业务完成，不读写持久存储。

## AXIOM
1. [使用者] 一次确认的 provider 失败只能作用于产生它的那一次 run 所用的 target，且只作用一次；迟到、重复或别的会话的回调不能借它再换 target 或再重试。
2. [使用者] 工具边界只能按宿主自己观察到的 run id 找到精确的物理消息，不能用会话当前执行代替。

## LEMMA
1. [AXIOM 1] 每个会话至多一条活记录（最新 run）；记录新 run 即退休旧记录。
2. [AXIOM 1] 重试目标只在记录确实属于该会话时才绑定，取走即失效。
3. [AXIOM 2] run 与物理执行的映射由显式记录维护，查询未知 run 返回 null。
4. [AXIOM 1, 2] 会话退出时清空其运行记录、重试绑定与关联映射。

## SPEC（调用方流程）

1. **运行观察记录**：
   - 发起请求前调用 `remember(sessionId, providerRun, target)` 记下这次 run 用的 target，调用 `rememberStep` 记下它对应的物理用户消息。`take(providerRun)` 一次性取回 `{ sessionId, target }`，取过再取返回 null；`stepOf(providerRun)` 查物理消息身份，未知 run 返回 null。
2. **重试目标绑定与取用**：
   - 确认某次失败值得重试时调用 `retainForRetry(sessionId, providerRun)`，把该 run 的 target 记为该会话下一次准入要原样使用的目标；调度器在真正重发前调用 `takeRetry(sessionId)` 取走，取过即空，旧失败因此不能重复触发重试。
3. **生命周期回收**：
   - 会话结束调用 `forgetSession`：丢掉该会话的最新记录、待重试目标与它的全部 run→物理消息关系。单条物理消息终结时调用 `forgetPhysical`，只清与该 `(会话, 物理消息)` 相关的关系，别的会话照旧。`snapshot()` 只返回四张表的条数，供测试与外层观察，不参与任何决定。
