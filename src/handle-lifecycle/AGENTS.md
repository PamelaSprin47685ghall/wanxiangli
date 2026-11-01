# handle-lifecycle

本模块帮助父工作收回一次委派的结果，并在重启后继续解释同一份完成记录。公开入口为 `wanxiangli/handle-lifecycle`；根 `AGENTS.md` 适用。

## 状态归属

- `HandleLifecycleLaw` 计算 handle 与已准入 work 的状态转移；调用方保存当前状态和持久事实。完成、发送失败、取消竞争同一格，后到者不覆盖已有终局。Join 消费可报告的完成或放弃一次，然后退休；Active 不提供可消费结果。
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
