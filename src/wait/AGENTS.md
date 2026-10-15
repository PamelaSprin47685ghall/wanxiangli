# wait — 显式时间与因果等待（等待部分）

层：内核。入口 `wanxiangli/wait`，导出对象 `Wait`。承接主仓 `Execution/Session/Wait/{CausalWait,Registry,Await,CompletionMailbox}` 与 `Wait/Surface` 的泛化子集（CUT-21）。零兄弟依赖：`IDeadlineHandle` 在本模块本地声明（与 time 模块结构同构，运行时由组合者注入实例）。

## AXIOM

1. [使用者] 等待观测只解释当前等待，绝不决定业务分支、铸造许可、参与恢复或影响提示构建。
    - 理由：若程序依据诊断快照作决定，观察的时机和故障便会改变业务；观察者不能成为第二份权威。
2. [使用者] 等待由真实事件唤醒，不以盲目轮询或墙钟判断循环推进。
    - 理由：轮询只能反复猜测，还会制造无关活动；竞争等待对外呈现为一个复合观测。

## LEMMA

1. [本模块 AXIOM 1] 业务只取得登记等待并返回租约的写能力（`IWaitObserver`）；快照读能力（`IWaitSnapshotReader`）只交外部诊断。诊断 sink 首绑唯一，后续插件实例不能重定向。
    - 推理：读写同权会让业务路径顺手消费观测，权威随之漂移。
2. [本模块 AXIOM 1] 诊断快照、转移历史与诊断 sink 均不进入持久化介质；注册表是进程内对象，重启后旧观测安全消失。
    - 推理：恢复若依赖观测，就多了一份不可靠依据。
3. [本模块 AXIOM 2] 等待完成、失败、到期或取消时立即移出活跃集合并记录退出状态；租约释放幂等；旧观测终止后不复活。
    - 推理：租约结束后仍留在活跃集合，会让已完成的任务看起来仍在阻塞。
4. [本模块 AXIOM 2] `untilSignalOrDeadline` 先 tryRead，再让一个真实信号对抗一个截止句柄；信号胜出即取消截止句柄并重读；到期返回 `WaitTimedOut`，不制造被等待的业务事实。
    - 推理：到期只是"我愿意等多久"的边界，不是关于世界发生了什么。
5. [本模块 AXIOM 2] 因果前沿是纯算法：从活跃根沿等待链找出最小未满足前沿（外部生产者、断裂边、循环、空）；它只作解释，不反向驱动业务。
    - 推理：让解释工具取得控制权，排障行为就会改变被解释的系统。
6. [本模块 AXIOM 2] 完成邮箱独立拥有物理唤醒资源：agent 通道只携带唤醒，pty 通道是物理完成队列；取消唤醒全部等待者且幂等。库侧泛型化 `'agent` / `'pty`，不绑定业务标识类型。
    - 推理：主仓 `AgentHandleId` / `PtyJoinItem` 是业务词汇，留在主仓组合层特化。

## SPEC

1. [本模块 LEMMA 3, 4] 到期返回 `WaitTimedOut` 且活跃集清空、历史记录退出；信号或即时读取胜出即取消截止句柄（`cancelCount` 可观测），推进虚拟时钟越过截止点不再触发过期回调；租约释放与 `MarkExit` 幂等；处置一个租约不影响其他活跃等待。
    - 证明：`tests/006.test.mjs`（卡内红反例 3）。[TODO] 运行验证由 DevOps 执行。
2. [本模块 LEMMA 5] 环、断边、外部前沿、链尾前沿与空快照分别得到 `CausalWaitCycle` / `BrokenCausalEdge` / `ExternalProducerFrontier` / `Empty`；同一算法在数组与快照对象上结果一致。
    - 证明：`tests/007.test.mjs`（卡内红反例 4）。[TODO] 运行验证由 DevOps 执行。
3. [本模块 LEMMA 1] observer 句柄只有 `Enter`，reader 句柄只有 `Snapshot`；错误形状被拒绝而非强转；诊断 sink 抛错不影响等待生命周期；目标首绑唯一。
    - 证明：`tests/003.test.mjs`、`tests/004.test.mjs`。[TODO] 运行验证由 DevOps 执行。
4. [本模块 LEMMA 2] 产物零文件、零存储写入；注册表进程内互相不可见；新实例从空开始；历史有界。
    - 证明：`tests/003.test.mjs`（产物文本检查）、`tests/008.test.mjs`。[TODO] 运行验证由 DevOps 执行。
5. [本模块 LEMMA 6] 邮箱无注册表独立可用；等待者挂起至真实事件；两通道载荷可排空且排空有界；取消唤醒每个等待者恰一次；本地中断与唤醒竞争；取消不吞其他等待者的唤醒。
    - 证明：`tests/005.test.mjs`、`tests/009.test.mjs`。[TODO] 运行验证由 DevOps 执行。
6. [本模块 LEMMA 1] 五要素（Owner / Wait / Producer / Escapes / Source）经快照往返无损；owner 键与字段序无关。
    - 证明：`tests/002.test.mjs`。[TODO] 运行验证由 DevOps 执行。

## 边界

- 主仓 `Wait/Bridge.fs`（`.wanxiangshu/diagnostics` 文件桥与 git exclude）与 `Wait/Surface.fs` 的主仓专用部分（PtyJoinItem 视图、`bindDiagnosticWorkspace`）留主仓：绑定主仓目录约定与 PTY 词汇，不属可移植职责。库侧诊断 sink 以 `bindDiagnosticTarget(registry, { Publish })` 提供接线点。
- `CausalWaitProcess.local()`（进程级单例）不进库：进程内唯一实例的绑定归组合层。
- `JoinBatch` / `JoinInterruptReason` / `MailboxWakeReason` 词汇随契约进库（causal-wait-009 的 join 中断/批次词汇属纯契约）；主仓 `AgentHandleId` / `PtyJoinItem` 类型本体留主仓。
- 等待超时的业务后果（中断、继续、呈现）由消费方规则决定；`WaitTimedOut` 不是业务终态。
