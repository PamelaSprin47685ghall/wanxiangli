# delegate-batch — 专属委派批次与暂存状态

层：内核纯计算与进程内状态自治。独立 npm 入口 `wanxiangli/delegate-batch`。在总流程中，本模块管理专属委派代理（owner scope * role）的单飞互斥批次、工具调用次序校验、JoinGuard 单飞防重以及延迟检查队列。

## 状态所有权
- **SyncDelegateBatchStore** 拥有纯数据键（ownerScope, role, delegateSession, callId）的双向索引与批次状态机（Pending → Ready → Active → Closed）。
- **RetiredDelegateRegistry** 拥有各作用域下已退役代理会话的单项暂存状态。
- **JoinGuardReservationStore** 拥有进程内 JoinGuard 单飞提醒的去重预留状态。
- **DeferredInspectionStore** 拥有会话级延迟检查调用队列与替换结果缓存。

## AXIOM
1. [使用者] 一个专属 delegate 同时至多一个已准入批次；新调用在已有批次时被拒，不排队、不另建重复工作。
2. [使用者] 语义批次只由 ProviderRun 与 provider 的工具调用次序定义，不由调度时序定义；批次齐了才整批准入。
3. [使用者] 专属 delegate 呼叫与退役严格具备单飞互斥；已退役子代理在父作用域下至多暂存一项，后续退役显式替换并促成旧草稿清理。

## LEMMA
1. [AXIOM 1] 已有活跃批次时拒绝新批次入队；无批次身份但有未决调用时保持 Pending。
2. [AXIOM 2] 批次调用列表为空、有重复项或顺序错乱时明确报错；全部工具调用收齐后批次转为 Ready。
3. [AXIOM 3] 暂存代理退役时支持原子提取旧代理用于草稿清理。
4. [AXIOM 1, 2] 状态清理返回结构化纯键结算清单，由宿主在外层解耦释放外部句柄。

## SPEC（调用方流程）

1. **批次准入与状态推进**：
   - 宿主观察到工具调用时调用 `admit`。工具按顺序登记，当达到声明数量时整批准入执行；未收齐时挂起等待。
2. **退役代理暂存与草稿回收**：
   - 代理退役时调用 `stage` 登记；若已有旧暂存代理，安全替换并返回旧实例供调用方执行草稿清理。
3. **JoinGuard 单飞预留与延迟检查**：
   - 通过 `JoinGuardReservationStore.tryReserve` 竞争独占提醒权，防范重复提醒；
   - 通过 `DeferredInspectionStore` 入队检查请求并提取替换结果，确保跨轮次检查不丢失。
