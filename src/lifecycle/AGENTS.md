# lifecycle — 工作生命周期

层：内核。npm 入口 `wanxiangli/work`。对象 `Work` 是一条工作的唯一规则 owner。

## AXIOM
1. [使用者] 开工、评审、接力、交付和恢复必须是一条能持续推进的真实工作，不是散落的工具约定。
   - 理由：这是旧系统 Plan、Manager、Relay 维护负担集中的职责。
2. [使用者] 同一工作至多一任活跃负责人，已退休的一任不能因重放再次动手。
   - 理由：重复执行会真的修改用户成果。
3. [使用者] 持权交付启动执行者是外部效果；不知道启动结果时不能再启动一个。
   - 理由：传输丢回执不等于没有发生。
4. [开发者] 内核不依赖旧系统、SQLite 或任何宿主 SDK，内部状态用对象封装。
   - 理由：使用方替换存储或宿主时，不应重写生命周期。

## LEMMA
1. [AXIOM 1, 2] 工作开立与首任、接力退休与后任，各是一笔原子追加；序列开立后不变。
   - 推理：分开提交会留下半个合法状态；恢复不应该猜另一半。
2. [AXIOM 1, 2] 承接旧仓当前 work 合同的两种序列：S1→S2→S3 与 S4。每任只有一次评审；空 findings 晋级，否则留级；不保存 findings 为第二份事实。
   - 推理：抽取要承接实际调用语义，不是只搬类型名称。
3. [AXIOM 2] 命令绑定任期；请求身份、输入摘要与结果一一对应。重放旧命令只返回原结果，不操作下一任。
   - 推理：只有幂等键而不比较载荷，会把不同动作误认为同一动作。
4. [AXIOM 3] 先持久预留交付操作，再由外侧执行。只有首次确认提交的返回允许启动；重放与恢复只要求观测原操作。
   - 推理：先启动后落盘，崩在中间就没有可查询的操作身份。增加 DeliveryRequested 与 DeliveryRejected 是为关闭这个真实窗口，不建立通用工作流框架。
5. [AXIOM 4] 只需要 `read(stream)` 与原子 `append(stream, expectedRevision, requestId, body)` 的结构契约。每次从持久事实重建局部对象；对象不成为第二权威。
   - 推理：存储比较修订号负责并发，Work 负责规则；两者无需互相编译。

## SPEC
1. [LEMMA 1] Open 一笔写入 WorkOpened 与 IncumbencyOpened；Relayed 一笔写入 IncumbencyRetired 与 IncumbencyOpened；中断不能暴露半对。
   - 证明：`tests/001.test.mjs` 核对原子事件对、游标与恢复无写入；eventstore 的强杀测试验证物理事务边界。
2. [LEMMA 2] Plan 一次 deliver 接力；S4 必须先评审、第一次只确认、另一个 toolCallId 才退休。S4 Promoted 交付、Stayed 接力；Plan 在末阶段晋级才允许执行交付。
   - 证明：`tests/002.test.mjs` 完整推进两种序列、留级分支、未评审门禁与同一次确认重放。
3. [LEMMA 2, 3] 自评、第二次异请求评审、错误任期、未知字段/词表、非法游标与非法后继均零追加。相同请求相同输入返回原结果，异输入拒绝。
   - 证明：`tests/003.test.mjs` 的自评、第二评、异请求、非法游标、未知字段、身份编码与旧回执反例。
4. [LEMMA 3, 5] 竞争提交最多一个成功，不自动重试；CommitUnknown 不报告成功，也不推进本地状态。损坏历史整份拒绝，不修复、不跳过。
   - 证明：`tests/004.test.mjs` 的确定性交错提交、写前/写后丢回执、畸形确认、整份历史拒绝与提交前后同一验证器。
5. [LEMMA 4] DeliveryRequested 保留稳定 operationId、草案摘要与路径；Accepted 观察绑定同一操作才退休。恢复、重放与未知提交都不能再次返回启动许可。
   - 证明：`tests/005.test.mjs` 的首次许可、恢复只观测、接受/拒绝/未知、pending blocker 和晚到回执；`scripts/tests/package.test.mjs` 验证真实外部效果后强杀的安装包场景。
6. [LEMMA 2, 3] DevOps 绑定跨任期保留；Advance 比较旧权威值且新值不能复用；Reopen 创建新任，不复活退休对象。阻塞记录是观察，不把脏工作区或评审 findings 当 blocker。
   - 证明：`tests/006.test.mjs` 的跨任期绑定、权威比较、重开新身份、物理 blocker 与 pending 互斥。

## 边界

- 旧仓只读取材：`requirements/work/WHAT.md`、`Mission/Lifecycle/{Facts,Kernel}.fs`。新库不读取或翻译旧日志；新工作采用新身份与存储格式。
- Work 只产生交付操作与接力结果，不启动 provider、子会话、命令或修改 Git。外部执行者的身份与 terminal 事实由调用者观测。
- 物理执行已经停止，必须由调用方如实提供 blocker 观察；本包的单任唯一性不冒充跨进程的物理执行锁。
- Reopen 与持久交付预留是明确的新规则；不是旧字段的伪兼容。
- trace、provider 投影、原文保存、LWR 取材、宿主 canary 与旧仓切换仍未实现，不计入本刀完成范围。
