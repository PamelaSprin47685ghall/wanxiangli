# lifecycle — 工作生命周期

层：内核。npm 入口 `wanxiangli/work`。对象 `Work` 是一条工作的唯一规则 owner。

## AXIOM
1. [使用者] 开工、评审、接力、交付和恢复必须是一条能持续推进的真实工作，不是散落的工具约定。
   - 理由：这是旧系统 Plan、Manager、Relay 维护负担集中的职责。
2. [使用者] 同一工作至多一任活跃负责人，已退休的一任不能因重放再次动手。
   - 理由：重复执行会真的修改用户成果。
3. [使用者] 持权交付启动执行者是外部效果；不知道启动结果时不能再启动一个。
   - 理由：传输丢回执不等于没有发生。
4. [开发者] Work 是能单独运行的内存对象，不接受存储、宿主或组合者的服务。它持有私有状态，以命令和数据记录交流。
   - 理由：调用者先选合作方式，不该为了运行领域行为就制造一个 Journal 替身。

## LEMMA
1. [AXIOM 1, 2] 工作开立与首任、接力退休与后任，各是一次原子领域转移；序列开立后不变。
   - 推理：对象不能暴露半个合法状态；持久组合也必须把整笔记录作为一个追加单位。
2. [AXIOM 1, 2] 承接旧仓当前 work 合同的两种序列：S1→S2→S3 与 S4。每任只有一次评审；空 findings 晋级，否则留级；不保存 findings 为第二份事实。
   - 推理：抽取要承接实际调用语义，不是只搬类型名称。
3. [AXIOM 2] 命令绑定任期；请求身份、输入摘要与结果一一对应。重放旧命令只返回原结果，不操作下一任。
   - 推理：只有幂等键而不比较载荷，会把不同动作误认为同一动作。
4. [AXIOM 3, 4] Work 记录稳定 DeliveryRequested；Applied 只说明本对象已应用，不表示落盘或许可外部执行。真实执行前的持久保证由 DurableWork 的组合协议承担。重放、恢复与未知执行观察都不产生新的请求。
   - 推理：Work 不认识存储，也不能声称自己已持久化；它提供自身领域事实，不编排 Journal 的调用脚本。
5. [AXIOM 4; 根 LEMMA 3] 私有状态跨调用保留；输入、输出和历史无可变别名。每次变化在私有候选上完成验证后替换，非法消息不留下半次变化。
   - 推理：字段归本对象修改；外部不需要记住 rollback/accept 等步骤来维护内部不变量。

## SPEC
1. [LEMMA 1] Open 一笔写入 WorkOpened 与 IncumbencyOpened；Relayed 一笔写入 IncumbencyRetired 与 IncumbencyOpened；中断不能暴露半对。
   - 证明：`tests/001.test.mjs` 核对原子事件对、游标与恢复无写入；eventstore 的强杀测试验证物理事务边界。
2. [LEMMA 2] Plan 一次 deliver 接力；S4 必须先评审、第一次只确认、另一个 toolCallId 才退休。S4 Promoted 交付、Stayed 接力；Plan 在末阶段晋级才允许执行交付。
   - 证明：`tests/002.test.mjs` 完整推进两种序列、留级分支、未评审门禁与同一次确认重放。
3. [LEMMA 2, 3] 自评、第二次异请求评审、错误任期、未知字段/词表、非法游标与非法后继均零追加。相同请求相同输入返回原结果，异输入拒绝。
   - 证明：`tests/003.test.mjs` 的自评、第二评、异请求、非法游标、未知字段、身份编码与旧回执反例。
4. [LEMMA 3, 5] 不接收服务；非法消息与损坏历史整份拒绝，不修复、不跳过；输入、输出、恢复视图与构造历史都不泄漏别名。同步重入拒绝。
   - 证明：重写后的 `tests/004.test.mjs` 已通过，实际产物无内部字段和辅助方法；存储竞争和未知提交不再冒充 Work 的职责，转由 assembly 证明。
5. [LEMMA 4] DeliveryRequested 保留稳定 operationId、草案摘要与路径；Accepted 观察绑定同一操作才退休。恢复与重放只返回已有操作，不建立第二个请求。
   - 证明：`tests/005.test.mjs` 的领域记录、接受/拒绝/未知、pending blocker 和晚到回执均通过；持久许可另见 assembly。
6. [LEMMA 2, 3] DevOps 绑定跨任期保留；Advance 比较旧权威值且新值不能复用；Reopen 创建新任，不复活退休对象。阻塞记录是观察，不把脏工作区或评审 findings 当 blocker。
   - 证明：`tests/006.test.mjs` 的跨任期绑定、权威比较、重开新身份、物理 blocker 与 pending 互斥。

## 边界

- 旧仓只读取材：`requirements/work/WHAT.md`、`Mission/Lifecycle/{Facts,Kernel}.fs`。新库不读取或翻译旧日志；新工作采用新身份与存储格式。
- Work 只产生交付操作与接力结果，不启动 provider、子会话、命令或修改 Git。外部执行者的身份与 terminal 事实由调用者观测。
- 物理执行已经停止，必须由调用方如实提供 blocker 观察；本包的单任唯一性不冒充跨进程的物理执行锁。
- Reopen 与持久交付预留是明确的新规则；不是旧字段的伪兼容。
- 构造 `Work(workId, records?)` 只接收事实数据；`execute` 返回 Applied/Replayed/Observed 与新记录或 null。它不承诺跨进程锁或数据持久，不能直接把 Applied 当真实外部效果许可。
- trace、provider 投影、原文保存、LWR 取材、宿主 canary 与旧仓切换仍未实现，不计入本刀完成范围。
