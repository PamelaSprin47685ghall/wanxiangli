# permit — 精确执行容量许可

层：内核进程内状态。独立 npm 入口 `wanxiangli/permit`。在总流程中，本模块作为物理执行容量许可的唯一签发与状态流转所有者，确保每一次物理执行所占用的容量在结束时且仅在结束时精准归还。

## 状态所有权
- 本模块独占持有各会话当前执行许可（Permit）、单调递增的租约 fence 序号以及状态转换规则。
- **CapacityTransitionCounters** 自治维护 duplicate、stale、conflict 统计计数。
- **SessionLeaseHandles** 自治管理会话句柄映射与序号。
- 不直接持有底层并发令牌池，不直接调用模型服务。

## AXIOM
1. [使用者] 一次物理执行占用的容量必须在这次执行结束时、且只在这次执行结束时归还；别人的结束、迟到的回执或身份对不上的许可都不能归还它。
    - 理由：提前归还会突破并发限制；永不归还会导致后续执行饥饿。

## LEMMA
1. [AXIOM 1] 许可绑定精确身份（会话、物理用户消息、角色、参与者、target）与信用值（credit）。新签发自动使该会话的旧许可过期。
2. [AXIOM 1] 状态机：Pending → Committed → Released(PhysicalCompletion)，或 Pending → Released(BeforeProvider)。已提交许可严禁走“提供方前释放”。
3. [AXIOM 1] 释放许可时必须严格核对许可对象与身份；任何参数不符或过期许可拒绝释放，状态保持不变。

## SPEC（调用方流程）

1. **许可签发**：
   - 物理执行就绪前申请许可。系统核对身份后签发新 Permit；同一会话此前的旧许可标记过期。
2. **许可提交与释放**：
   - 调用方在真正发起模型交互时将许可置为 Committed；执行完毕后，根据这次执行真实完成这件事将其状态流转为 Released 并归还容量。
   - 若执行前取消，在 Committed 之前通过 `BeforeProvider` 释放。
3. **句柄管理与计数**：
   - 调用方通过 SessionLeaseHandles 维护会话租约；发生分歧或过期时分类记录至 CapacityTransitionCounters。
