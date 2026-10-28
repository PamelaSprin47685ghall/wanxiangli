# dispatch — 派发认领与交付围栏

层：内核进程内状态自治。独立 npm 入口 `wanxiangli/dispatch`。在总流程中，本模块确保系统发出的每一条消息至多产生一次逻辑效果；持有派发认领记录（PromptKey 结算）、交付 Attempt 状态围栏以及物理送达确认回调。

## 状态所有权
- **DispatchClaimLedger** 独占持有 `PromptKey` 派发认领、序号单调递增及结算状态转换规则。
- **DeliveryAttemptLedger** 独占持有会话与运行维度的已确立、已呈现与中断任务状态。
- **PromptPhysicalAcceptance** 独占持有每个 `PromptKey` 的单次物理确认等待者与回调注册表。

## AXIOM
1. [使用者] 插件发出的每一条 user-shaped 消息至多产生一次逻辑效果；结局未知时宁可保留待决也不重发，也不伪称成功。
    - 理由：重复派发会让模型收到两遍同一指令、重复消耗预算；伪造的落地会让后续阶段在不存在的消息上推进。

## LEMMA
1. [AXIOM 1] PromptKey 由 `(会话, 逻辑运行, 根, 来源, 载荷摘要, 序号)` 确定性导出。序号在作用域内单调递增，放弃后再发分配新序号。
2. [AXIOM 1] 待决认领状态流转：Submit 记回执仍待决；Accept 移出待决并记下那条物理消息 id；Abandon 显式放弃；不在待决集合的 key 严禁修改投影。
3. [AXIOM 1] 宿主发送结果映射：回执 → Submitted；真实物理 id → PhysicalAccepted；发送前明确拒绝 → Abandon；未知结果 → 保持待决不重发。
4. [AXIOM 1] DeliveryAttemptLedger 维护精确围栏（session * providerRun * callId），区隔已成立、已呈现与中断事实；形状不合法的输入一律拒绝记录（返回 false / 空事实），不猜测。
5. [AXIOM 1] PromptPhysicalAcceptance 提供单次确认排空机制与 ABA 覆盖保护，防止旧租约误删新监听。

## SPEC（调用方流程）

1. **认领创建与提交**：
   - 发送前依据上下文生成 PromptKey 并登记待决认领；发送后依据回执状态流转为 Submitted 或已确认。
2. **物理确认与等待**：
   - 调用方通过 `PromptPhysicalAcceptance` 挂起等待物理确认回调；物理到达时原子排空等待者并完成通知，超时或取消安全清理。
3. **交付 Attempt 围栏与中断**：
   - 在执行过程中登记物理围栏；触发中断时调度中断任务并在完成时更新状态，消除并发查询歧义。
