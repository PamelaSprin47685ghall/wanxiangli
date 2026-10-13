# wanxiangli

从旧万象术抽取的工作生命周期库。F# 实现，编译为独立 ESM，通过 npm 包使用。

本次不是完整新宿主。已经实现的是：**工作开立 → 评审 → 接力或交付 → 持久恢复**。旧仓尚未接线；原 `src/` 中只有说明、没有 fsproj 的目录仍是草稿。

## 两个独立入口

| 入口 | 对象 | 职责 |
|---|---|---|
| `wanxiangli/work` | `Work` | 工作规则、原子事件组合、重放、恢复、交付操作认领 |
| `wanxiangli/eventstore` | `SqliteJournal` | 修订号比较、原子追加、字节保存、提交结局 |

两库没有源码或工程引用关系。`Work` 接受两方法的结构契约 `Journal`；生产中可传 `SqliteJournal`，内核测试传一个只实现存储语义的内存日志。`SqliteJournal` 接受组装方创建的原生 SQLite 连接；不探测运行时，不动态猜选驱动。存储不认识生命周期，生命周期不认识 SQLite、OpenCode、omp 或旧系统。

F# 对象封装局部可变状态。没有全局单例、公共大 Context、通用工作流引擎或多层 port 包。每次调用从已提交事实重建局部状态，失败候选直接丢弃，不把内存快照当第二权威。

## 构建与验证

构建与完整验证要求 Node >=22.13.0 与 npm；不需要 .NET SDK。工具链版本锁在 `package-lock.json`。`node:sqlite` 在 Node 22.13 不需要实验开关，但该版本的 API 仍标为 experimental；本次完整验收环境是 Node 25.9.0，安装包场景另在 Bun 1.3.14 通过。Node 官方接口说明见 `https://nodejs.org/api/sqlite.html`。

```sh
npm ci --ignore-scripts
npm test

# 只编译一个库
npm run build -- lifecycle
node --test src/lifecycle/tests/*.test.mjs

npm run build -- eventstore
node --test src/eventstore/tests/*.test.mjs

# 实际交付包；不发布到 registry
npm pack
```

构建只有一个脚本：读取各目录的显式 fsproj → npm Fable 编译 → esbuild 打成一个独立 ESM。没有自建增量图、缓存协议或编译分片系统。指定一个模块不会重编其他模块；编译失败不覆盖旧产物。

发布包没有 npm 运行时依赖，Fable 运行库用到的部分已打入产物。消费者不需要 F# 源码、编译器、esbuild 或本仓路径。当前包标为 private，防止验收前意外发布；tarball 安装不受影响。Fable 的许可声明随包保留。

## 最小使用示例

下面在内存 SQLite 中完成一条 S4 工作，验证的是真实库，不涉及宿主执行能力。实际持久化时把 `:memory:` 换成调用者明确提供的数据库绝对路径；父目录须已存在。连接交由日志独占管理，`journal.close()` 会关闭该连接。

```js
import { Work } from 'wanxiangli/work'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DatabaseSync } from 'node:sqlite'

const journal = new SqliteJournal(new DatabaseSync(':memory:'))
const work = new Work('work-1', journal)

function commit(requestId, command) {
  const reply = work.execute(requestId, command)
  if (reply.status !== 'Committed') {
    throw new Error(`Expected a new commit, got ${reply.status}`)
  }
  return reply.result
}

try {
  const opened = commit('open-1', {
    type: 'Open', root: '完成本次工程任务', sequence: ['S4'],
    ownerId: 'manager', openingCursor: 0,
  })
  commit('review-1', {
    type: 'Review', incumbencyId: opened.incumbencyId,
    reviewerId: 'reviewer', findings: [],
  })
  const delivery = {
    type: 'Deliver', incumbencyId: opened.incumbencyId,
    providerRunId: 'run-1', cursor: 10, blockers: [],
  }
  commit('confirm-1', { ...delivery, toolCallId: 'call-1' })
  const result = commit('retire-1', { ...delivery, toolCallId: 'call-2' })
  console.log(result.kind) // Delivered
  console.log(work.recover().next) // Done
} finally {
  journal.close()
}
```

在 Bun 中只替换连接的构造；Work 和 SqliteJournal 仍是同一份包、同一份实现：

```js
import { Database } from 'bun:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'

const journal = new SqliteJournal(new Database(':memory:'))
```

完整命令及返回值在两个入口自带的 `.d.ts` 中；包验收会在干净消费者里运行 TypeScript 正反类型用例。命令名、字段名和结果名都是协议，不做语言翻译。本库不直接生成面向模型的提示词。

## 已承接的工作规则

Plan 序列固定为 S1→S2→S3，执行序列固定为 S4。每任至多一次评审，不能自评；相同请求重放返回原结果，不产生第二次评审。空 findings 晋级，否则留级。findings 只在本次返回，不复制进持久事件。

Plan 的一次 deliver 接力到当前折叠阶段；末阶段晋级后才获得交付授权。S4 必须先评审，再由两个不同 toolCallId 完成确认、退休；Promoted 交付，Stayed 接力。开立和首任、接力退休和后任，各在同一事务。旧回执重放不能作用到后任。

DevOps 绑定跨任期保留。Advance 要求已评审、旧权威值匹配、新值从未用过。Reopen 创建新的任期，清空评审与交付授权，不复活已退休的对象。物理 blocker 由调用方提供；测试失败、findings 非空或脏工作区本身不是 blocker。

`inspect()` 给出 detached 视图，`history()` 给出已提交事务，`recover()` 给出从事实导出的下一项义务。`rounds` 是任期与阶段的结构化核对记录，不是完整 LWR 正文或用户原文轨迹。

## 交付外部执行者

持权 Plan 不在库内启动子会话。它先落盘 `DeliveryRequested`，首次提交成功才返回 `DispatchExecution`，携带稳定 `operationId`、草案摘要与路径。**只有 `status === 'Committed'` 且 `result.kind === 'DispatchExecution'` 时，外侧可以首次发起该操作。**

重放、恢复及丢回执之后只会得到 `ObserveExecution`，不能再派发。调用方将真实观察提交为 `ResolveDelivery`：

| 观察 | 结果 |
|---|---|
| Accepted：同一 operationId、执行者身份、摘要、路径，且无 blocker | 退休为 Delivered |
| Unknown | 保持 pending，不追加成功、不重发 |
| NotStarted | 记录拒绝，允许使用新请求身份显式开新尝试 |

NotStarted 必须是执行侧对这个 operationId **已确定且不会再改变的拒绝**；暂时查不到会话、超时或丢失回执都不算。调用方必须防止已拒绝的操作稍后又被启动。不能把本库的逻辑单任唯一性当成物理进程互斥锁。

外部完成之后、回执提交之前崩溃的真实场景在包验收中覆盖：安装 tarball 的消费者启动一个真正的子进程，子进程写入效果文件，父进程被 SIGKILL；新进程只查询原操作并结算，效果计数仍为一。同一场景在 Node 和 Bun 下运行；环境没有 Bun 时会明确诊断未验证该运行时。该证明不是 omp/OpenCode 子会话能力证明。

## 失败与存储边界

输入非法、错误任期、未知事件和损坏历史抛错，且不追加。`execute` 的提交结果分清：

| status | 调用方应如何理解 |
|---|---|
| Committed | 本次新事实已确认提交 |
| Replayed / Observed | 返回已知结果或当前义务，不能当成新的外部执行许可 |
| Conflict | 另一个请求先赢得修订号；本次零写，不自动重试 |
| NotWritten | 已知没提交；没有外部执行许可 |
| Unknown | 不能断言已写或没写；停止继续写，重开存储与 Work 后核对同一请求 |

SQLite 使用 `BEGIN IMMEDIATE`、WAL、`synchronous=FULL` 和零等待竞争策略。整个事务体作为 UTF-8 BLOB 保存，包含 BOM、NUL、组合字符的字节可完整读回；非法 UTF-16 孤立代理项拒绝，不静默替换。单笔体积上限 1 MiB。读回检查修订连续性与摘要，普通 UPDATE/DELETE 被 schema 拒绝；没有自动修复。

这是一份本地磁盘上的同步小型事实日志，不用于 token 流，不包含多机同步、远程合并、保留策略或磁盘断电证明。每次操作读取本工作的历史，复杂度随历史长度增长；目前不引入第二份业务缓存。需要高吞吐时先用真实负载测量，再决定工作线程或派生缓存。

## 验收入口与迁移范围

`npm test` 包含生命周期反例、真正的 SQLite 故障注入、双进程竞争、两处 SIGKILL、兄弟源码缺席时的独立构建与测试，以及实际 npm 包安装后的端到端场景。子模块规范及证明在各自 `AGENTS.md` 中。

旧系统的接线与删除清单见 `MIGRATION.md`。本次不读取旧日志，不复制旧业务源码，也没有修改旧仓、执行 git commit 或发布 npm 包。完整抽吸还需要下一阶段授权后的旧仓消费与旧实现退出。
