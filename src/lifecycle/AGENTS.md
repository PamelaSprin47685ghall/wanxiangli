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
1. [AXIOM 1, 2] 工作开立与首任、接力退休与后任，各是一次原子领域转移；office 开立后不变。
   - 推理：对象不能暴露半个合法状态；持久组合也必须把整笔记录作为一个追加单位。
2. [AXIOM 1, 2] 里程碑是 Plan「事实与取舍 → 理解与路径 → 流程与伪代码 → 待执行」和 Manager「执行 → 收尾 → 已完成」。任期只有 Originator 与 Successor。空账询问，清空才接力；接任第一次空账晋级且不新建任期；收尾空账且无真实阻塞则结案。义务账写在评审事实里，不另存一份 findings。
   - 推理：抽取要承接实际调用语义，不是只搬类型名称。
3. [AXIOM 2] 命令绑定任期；请求身份、输入摘要与结果一一对应。重放旧命令只返回原结果，不操作下一任。
   - 推理：只有幂等键而不比较载荷，会把不同动作误认为同一动作。
4. [AXIOM 3, 4] Work 记录稳定 DeliveryRequested；Applied 只说明本对象已应用，不表示落盘或许可外部执行。真实执行前的持久保证由 DurableWork 的组合协议承担。重放、恢复与未知执行观察都不产生新的请求。
   - 推理：Work 不认识存储，也不能声称自己已持久化；它提供自身领域事实，不编排 Journal 的调用脚本。
5. [AXIOM 4; 根 LEMMA 3] 私有状态跨调用保留；输入、输出和历史无可变别名。每次变化在私有候选上完成验证后替换，非法消息不留下半次变化。
   - 推理：字段归本对象修改；外部不需要记住 rollback/accept 等步骤来维护内部不变量。

## SPEC
1. [LEMMA 1] 第一次 review 写入 WorkOpened 与 IncumbencyOpened。接力在同一笔写入 IncumbencyRetired、ContextBarrier、后任 IncumbencyOpened 与 PromptObliged。中断不能暴露半对。
   - 证明：`tests/001.test.mjs` 核对原子事件、屏障与恢复后的同一快照。
2. [LEMMA 2] 空账询问，清空才接力；接任第一次空账只推进里程碑；待执行可多次启动 Manager；收尾空账结案。已完成可由真实操作员消息重开；外层组合者因未完成的工作需要继续时，也可用独立的系统续办请求重开，不能冒充操作员。续办身份重放不得产生第二个任期，外层负责判断续办原因及发送结果。系统续办程序待改。没有资格锁定，也没有独立的生命周期 deliver。
   - 证明：`tests/002.test.mjs`、`tests/006.test.mjs` 与 `tests/007.test.mjs` 覆盖询问、接力、晋级、启动、结案与重开。
3. [LEMMA 2, 3] 同一请求同一载荷重放原结果，异载荷拒绝。同一 toolCallId 的另一请求返回原结果。未知字段、空 key、写死之后的另一 office 与待执行上的非空账均零追加。
   - 证明：`tests/003.test.mjs`。
4. [LEMMA 3, 5] 不接收服务；旧开立记录拒绝且不翻译；损坏历史整份拒绝，不修复、不跳过；输入、输出、恢复视图与构造历史都不泄漏别名。同步重入拒绝。
   - 证明：`tests/004.test.mjs`。存储竞争和未知提交由 assembly 证明。
5. [LEMMA 4] 同一 `review([])` 重放只启动一个 Manager；三次不同的有效调用启动三个。DeliverySessionBound 与 DeliveryAdmitted 不退休待执行。未知创建不发送底稿。晚到确认不写第二次。
   - 证明：`tests/005.test.mjs`。持久许可另见 assembly。
6. [LEMMA 2, 3] DevOps 绑定跨接力保留；改绑冲突。收尾有真实资源阻塞时不结案，阻塞解除后的空账才结案。隔离目录可以休克删除；活的 `.Herdchestra` 拒绝删除。重开见 SPEC 2。
   - 证明：`tests/006.test.mjs`。操作员重开与代理零重开见 `tests/007.test.mjs`。

## 边界

- 旧仓只读取材：`requirements/work/WHAT.md`、`Mission/Lifecycle/{Facts,Kernel}.fs`。新库不读取或翻译旧日志；新工作采用新身份与存储格式。
- Work 只产生交付操作、外部 session 绑定事实与接力结果，不启动 provider、子会话、命令或修改 Git。DeliverySessionBound 只是调用方已观察到的容器身份，不证明首 prompt 被接受；真正 acceptance 与 terminal 事实仍由调用者观测。
- 物理执行已经停止，必须由调用方如实提供 blocker 观察；本包的单任唯一性不冒充跨进程的物理执行锁。
- Reopen 与持久交付预留是明确的新规则；不是旧字段的伪兼容。
- 构造 `Work(workId, records?)` 只接收事实数据；`execute` 返回 Applied/Replayed/Observed 与新记录或 null。它不承诺跨进程锁或数据持久，不能直接把 Applied 当真实外部效果许可。
- trace、provider 投影、原文保存、LWR 取材、宿主 canary 与旧仓切换仍未实现，不计入本刀完成范围。

## PlanAskGate — 进程内单飞询问门禁

对象 `PlanAskGate`（与全局单例 `planAskGate`）是 work-028 / work-035 规定的进程内单飞询问互斥门闩。

- `tryBegin(workId)`：非空白且未处于 pending 时记录并授予进入，已被占用或非法输入拒绝。
- `clear(workId)`：幂等解除占用。
- `isPending(workId)`：检查指定 workId 是否处于 pending 状态。
- `clearAll()`：清空当前实例全部占用记录。
- `snapshot()`：返回排序的原生快照数组，隔离内部集合。
- 崩溃恢复无需悬挂询问状态，因此为纯进程内存状态，不落盘。
