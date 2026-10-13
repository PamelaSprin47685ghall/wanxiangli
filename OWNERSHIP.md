# 第四刀：资源归属与收尾

`wanxiangli/ownership` 的 `Ownership` 管一份资源归属登记：谁负责收尾、哪些资源仍未终结、哪个范围已经停止接纳新工作。它不持有进程、数据库、Work 或 Trace，也不通过回调调用这些参与者。

这是独立的内存能力，不是宿主资源发现器，也不是另一个业务生命周期。逻辑归属、物理终态与业务退休分别由不同对象回答；外侧 C 把这些事实组合起来。

## 基本用法

```js
import { Ownership } from 'wanxiangli/ownership'

const owner = new Ownership('workspace-ownership')
owner.execute('open-work', {
  type: 'OpenScope', scopeId: 'work', parentId: null,
})
owner.execute('open-tenure', {
  type: 'OpenScope', scopeId: 'tenure-1', parentId: 'work',
})
const reservation = owner.execute('reserve-child', {
  type: 'Reserve', resourceId: 'child-1', scopeId: 'tenure-1', kind: 'process',
})
const lease = reservation.result.lease

owner.execute('drain-tenure', { type: 'Drain', scopeId: 'tenure-1' })
owner.blockers('tenure-1') // 仍有 Reserved，不因为还没有启动回执就释放

owner.execute('not-started', {
  type: 'NotStarted', lease, reason: '已确认未曾启动，且原启动请求不会再执行。',
})
owner.execute('close-tenure', { type: 'Close', scopeId: 'tenure-1' })

const restored = new Ownership('workspace-ownership', owner.records())
restored.scope('tenure-1').phase // Closed
```

以上例子只改变内存，不执行外部效果。`Applied` 不是 `Committed`；实际创建资源之前，组合者要先确认这笔预留已经持久提交。

## 范围与资源是两种东西

scope 是收尾范围，可有多个根，也可挂在已经存在的父 scope 下。父关系创建后不变，不能抢挂、改挂或复活已关闭身份。新节点只能引用已经存在的父节点，自链和环没有合法入口。

resource 是一次待创建或已创建的资源实例，kind 为 session、process、tool、job、provider 或 effect。它属于唯一 scope，resourceId 在同一登记簿内不复用。预留一旦成功，即使物理启动还没有回执，也要继续有人负责它。

固定 DevOps 等长期资源可以归属 `work`，短期工具进程归属 `tenure-1`。关闭后者只涉及自己的子树，不把父范围资源顺便释放，也不需要每次接力都迁移资源。

这些名称不是权限角色。Ownership 不决定谁能自评、当前是哪个阶段、是否可以交付；它只给出已经登记的未收尾资源。

## 九种消息

| type | 输入 | 结果与限制 |
|---|---|---|
| OpenScope | scopeId、parentId | 开立范围；parentId 必须明确，根使用 null |
| Reserve | resourceId、scopeId、kind | 在开放范围内预留一次资源归属，产生 lease |
| Started | lease、binding | 已观察到物理承接；不能用传输回执或猜测代替 |
| Ended | lease、binding、outcome | 该实例已确认结束，outcome 为 Completed、Failed 或 Cancelled |
| NotStarted | lease、reason | 已确定未启动且不会迟到执行的拒绝；已 Started 的资源不能用它结算 |
| Unknown | lease | 本次没有新事实；不追加、不释放、不改变既有终态 |
| Cancel | lease | 仅记录取消请求；未终结资源仍为 blocker。已终结时返回 Settled，不伪造新取消 |
| Drain | scopeId | 同时关闭范围及后代的新准入；不清除预留或活动资源。已关闭时返回 Closed |
| Close | scopeId | 先检查子树全部未终结资源；只有空集合才在一次变化中关闭整棵子树 |

消息通过 `execute(requestId, message)` 发送，返回 status、revision、result、record：

**Applied** 表示一笔新的内存归属变化，并给出可保存的完整 record。**Replayed** 表示同一已接受 requestId 和规范消息，返回原结果、原修订及原记录。**Observed** 表示没有新变化，不写记录，record 为 null。相同 requestId 对应不同消息时拒绝；不改变状态的观察没有建立新的持久请求身份。

重放结果描述原来那次已接受的事实，不是当前快照，更不是新的执行许可。当前状态由 `resource()`、`scope()` 或 `blockers()` 查询。非法输入和冲突抛错，记录与状态保持不变。

## 取消不是结束，排空不是释放

Cancel 和 Drain 都不会把未完成计数减一。Drain 之后禁止新增后代 scope 或新预留，但已经预留的物理启动可能正好晚到，所以仍接收其 Started，并将其继续列为待取消资源。

只有精确的 Ended 或 NotStarted 才把对应 lease 从 blocker 集合中移除。超时、发出信号、连接关闭、不再有输出都不是本库的终态证据。清理过程中出错不能使用“清空列表”绕过去。

`Close` 先完整检查再改变状态。一个后代仍在 Running 或 Reserved 时，失败不会先关闭其他空子树；当子树已没有未终结资源，可以一次关闭全部后代，不要求调用者照着内部树逐个打补丁。

`blockers(scopeId)` 递归包含后代，按资源首次预留顺序返回分离视图，不按调用者的读取顺序变化。每项包含 lease、scopeId、kind、phase、binding、outcome、reason 和 cancellationRequested。这个列表是事实投影，不是要求调用特定服务的脚本；取消顺序与实际物理动作仍由 C 决定。

## 容器可复用，实例不可混用

lease 是 `{ registryId, resourceId, token }`。token 绑定登记簿、资源、owner 与 kind，主要防止误传，不是认证或恶意代码隔离机制。

Started/Ended 的 binding 为 `{ externalId, incarnationId }`。externalId 可以是物理会话名或 PID；incarnationId 必须指认这一次实例，而不是重复使用容器名。C 应从真实启动或查询协议获得并保持该关联。

同 kind 的一个物理容器不能同时被两个 Running 资源占用。资源结束后，容器可以供新的 resourceId 和新的 incarnationId 使用；旧的精确终态仍可重放，但不会删除新实例的归属。不同 kind 使用不同物理命名空间，外侧不能用改 kind 的方式把同一真实对象重复登记。

Started 回执丢失时，精确 Ended 仍能结算原预留；即便该容器已被更新的实例占用，旧终态也只能释放旧 lease。NotStarted 则必须是最终拒绝，暂时查询不到或等待超时都不够。

## 持久提交由组合者负责

生产库没有 Journal 接口、写盘函数、计时器或进程句柄。真实组合的顺序是：C 读取已提交记录，建立 Ownership 候选，向它发送消息，将返回 record 与期望修订交给 Journal；只有首次 Committed 后才发布候选并允许随后的外部效果。

Conflict、NotWritten、Unknown 都不能变成创建许可，不隐式重试。Unknown 时先封存本次协作，重开存储并核对同一个请求；不能因候选内存是 Applied 就认为已经落盘。相同记录被另一个提交者先写入时，Replayed 也不是第二份启动许可。

关闭资源准入也要按这个提交边界处理。Reserve 与 Drain 并发时，修订比较必须只有一个胜者：Drain 先成功，则旧预留候选不能发布；Reserve 先成功，则重新评估的 Drain 必须包含它。把多个独立进程各自的内存对象当成共享锁是不成立的。

`scripts/tests/ownership-composition.test.mjs` 验证两种竞争顺序、相同预留竞争、COMMIT 前后丢回执。实际安装包消费者把 Ownership、Journal、ProcessSession、Work 作为四个独立对象使用：预留提交后启动真实进程；TERM 被忽略和等待超时后 Work 仍被阻塞；确认物理结束后结算 lease，再关闭范围和退休。

重启场景在真实子进程已经退出、归属终态尚未提交时强杀协调进程。外部观察者已将 Closed 证据写入测试见证文件；重启先恢复未完成归属，再核对见证，既不盲目释放，也不重跑命令。这个文件模拟有持久终态查询的物理 owner，不是库自动发现进程已死的能力。

## 历史与封装

records 保存的是已经接受的归属变化，不是待执行的物理命令。恢复仅重建本地对象，不启动进程、发送信号或追加日志。消息、请求、修订和前一摘要共同进入记录，恢复检验规范 JSON、递增修订、摘要链与所有领域约束；重算了摘要的非法变化也不能通过。

摘要不是签名。没有外部保留的可信 head，合法历史前缀不能自行判断尾部缺失；不提供自动合流、自动修复或多机共识。单条规范记录上限 64 KiB，总历史与内存随实际记录增长，不静默淘汰仍有归属意义的事实。

F# 对象表达式将状态保留在闭包内。公开对象只有消息方法，输入、lease、物理关联和返回视图都没有可修改内部状态的别名。同步调用也拒绝重入；树的遍历使用显式栈，不靠递归清理堆深。

## 验收入口与尚未覆盖的边界

```sh
npm run build -- session
node --test src/session/tests/*.test.mjs
npm test
```

公开类型见 `src/session/index.d.ts`，规则与证据见 `src/session/AGENTS.md`，本轮结果见 `施工顺序.md`。独立构建不提供前三刀源码；安装包验收在 Node/Bun 的真实组合之后，删除所有前三刀产物和类型，再验证 Ownership 单独使用。

本库只能管理已登记资源，不能发现逃逸后代、伪造的外部事实或未登记任务。ProcessSession 的 Closed 不等于全部进程树退出；本轮组合只证明其受测物理范围。真实宿主关联、旧代码退出、跨登记簿迁移与完整的物理监管仍未实现。
