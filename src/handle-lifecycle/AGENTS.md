# handle-lifecycle

本模块帮助父工作收回一次委派的结果，并在重启后继续解释同一份完成记录。公开入口为 `wanxiangli/handle-lifecycle`；根 `AGENTS.md` 适用。

## 状态归属

- `HandleHistory` 拥有不可变的绑定、准入 work、旧记录隔离标记和创建次序；`HandleLifecycleLaw` 在同一工程内计算状态转移。调用方保存持久事实，重放得到新的 History，不另存一份可写状态。完成、发送失败、取消竞争同一格，后到者不覆盖已有终局。Join 消费可报告的完成或放弃一次，然后退休；Active 不提供可消费结果。
- `JoinAttemptRegistry` 拥有进程内会话租约和可见消息去重。一个目标只有一个活跃租约；无租约时收到的消息仅去重，不排队唤醒后继 Join。
- `PendingRunStore` 拥有进程内的运行登记和认领；精确 token 区分同一 agent 的不同运行，取消和完成不会拿走后继登记。
- `CompletionRecord` 无长期可变状态，负责完成记录的编码、历史分类、工作归属、默认值和 ref/digest 读取。它不持有 Journal，不决定何时消费 Join，不制造角色、时间或恢复动作。

## 完成材料的交入与取回

子工作交回完成或失败时，`encode` 生成 schemaVersion 4 的规范 JSON。完成的 `view` 必须是规范 ReturnedMaterial 字节。误传的 abandoned 继续编码为 failed/ABANDONED；调用方仍负责不把放弃写成持久完成记录。

父工作取回记录时，`decode` 保留原字段的字符串转换和错误顺序。历史 `status="aborted"` 优先分类为 legacy false abort，不变成可 Join 的完成。completed 按 childSessionId、authorityRoot 和非空 providerRun 判断归属；failed 只比较 childSessionId。

`materialize` 只补原有缺省值：空白 runId 变成 `run-<agentId>`，空白可选身份和目录变成 null；正文不 trim。`decodeForWork` 组合解码、归属和缺省值，保留原错误文字。没有 Work 的旧记录继续按原路径解释。

调用方只在 CompletedAwaitingJoin 时调用 `read`。ref/digest 都无时不读取；缺一项时报错；两项俱在则读取一次并先核对摘要，返回原正文、ref 和 digest。存储失败、摘要不符和 Promise 拒绝不重试、不补记录。取得正文后，调用方按自己的路径选择先分类或直接物化。

恢复仍区分持久放弃、持久完成、退休、未完成和未知。旧 AbortedObserved 不被当成真实宿主观察；错误补偿只能撤销 ref/digest 精确匹配的完成格。

## 依赖

CompletionRecord 通过 `wanxiangli/events` 的 CanonicalEventCodec 生成规范 JSON，通过 `wanxiangli/returned-material` 校验完成材料。两者是公开产物依赖，不编译其源码，不复制其规则。模块不导入宿主 SDK。

调用方提供读取和摘要函数、角色、名字、完成时间及生命周期选择。类型和返回形状以同目录 `index.d.ts` 为准。

## 本地子运行

`ChildRunSet` 拥有本进程的子运行与 PTY 登记、单次完成、取消标记和等待。它组合调用方提供的 mailbox；主体沿用 `wanxiangli/program` 的 `Wait.completionMailbox`，不复制队列，也不换成用途不同的 ResultMailbox。busy fork 只回应 Nudged，不再调用工作；已有运行结束后，同 id 可以开始下一次运行，旧等待仍指向旧完成。

超时不取消运行，逻辑取消不制造物理 abort 或持久完成。已开始的工作在取消后实际返回，仍按原规则保存结果；取消本身不填完成格。完成优先于取消的列表状态，Interrupted 与 abandoned 保留原原因。Close 只执行一次 cleanup，逐项失败不妨碍其余清理，PTY 所有权保留到注销。agent mailbox 仅传唤醒，持久交回仍读 HandleHistory/Journal。

调用方只提供时间、运行 id、超时竞速、实际工作和 mailbox 能力；库不持有宿主 SDK、事件订阅或物理子会话生命周期。公开数据是普通身份、角色标签与完成材料，F# typed 桥不再保存第二份运行集合。`child-run-set.test.mjs` 覆盖这次边界；运行结果由当次交付记录保存。

## 持久句柄与 Join

`DurableHandles` 组合 History 与 CompletionRecord。调用方提供当前历史、同步刷新、追加事实、正文读写、摘要和消费编号；这些操作保留原来的失败与 Promise 拒绝，不重试未知提交。核不认识日志文件位置、宿主 SDK 或固定角色。角色与名字是无解释的标签。

绑定重放必须保持同一 child、target、byname、role 和可见性。准入比较精确 child、owner、identity、root 与 logical run；同 work/run 重放保留终态，另一个活跃 work 阻止覆盖。旧未限定 work 的完成不会被升级成可执行 work。历史与查询返回独立数据，不把可写内部表交给调用方。

完成正文先写，再追加完成事实。消费先刷新，用当前完成格和新消费编号预检，追加后再刷新；只接受相同消费编号的回执。其他消费者先完成时报告 AlreadyRetired，未确认自己的回执不交回结果。无 work 的旧记录只允许消费明确 Voided 的放弃；审计与旧记录查询不获得新执行权。

Join 按创建次序、target 排序。接收谓词先检查有效摘要，再形成可交付 work；这保留组合层选择所属工作的行为。无效材料继续等待，false abort 仍走原来的撤销或拒绝路径。消费遇竞争会重新读取候选；已有成功项后的硬错误返回成功前缀，首项错误才返回错误。取消逐项进行，遇第一项失败停止，不回滚已经落地的放弃。

主体的固定 DevOps 空闲展示规则留在产品层。其类型适配器可以按需生成只读 F# 视图，但不得缓存第二份可写 Handles/Works 状态。`history.test.mjs`、`durable-handles.test.mjs` 及安装消费者覆盖本次公开边界；运行结果只在当次交付记录维护。
