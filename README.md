# wanxiangli

逐步承接宿主职责的独立库。F# 实现，编译为独立 ESM，通过 npm 包使用。

当前不是完整新宿主。`wanxiangli/work` 承接 **工作开立 → 评审 → 接力或交付 → 持久恢复**；`wanxiangli/process` 是独立的真实进程会话；`wanxiangli/trace` 是确认轨迹、字节原件和固定取材区间；`wanxiangli/ownership` 是资源归属与收尾。宿主已通过 npm 公开入口消费这些入口；`src/` 中只有说明、没有 fsproj 的目录仍是草稿。

进程入口是 `wanxiangli/process` / `ProcessSession`：真实启动、有界 stdin、双路原始输出尾部、独立等待和 POSIX 进程组信号。它不导入下面三个入口，下面三个入口也不导入它。完整用法、字节游标和监管边界见 `PROCESS.md`。

轨迹入口是 `wanxiangli/trace` / `Trace`：稳定观察身份、只追加的已确认部件、原始字节和运行终态；边界同时绑定轨迹、游标和前缀摘要。原始观察、全部用户原件和当前区间消息是同一份事实的不同视图，不复制成可相互覆盖的账本。它不依赖前两刀，也不把存储服务换名后注入。完整用法及字节、恢复、来源可信度的限制见 `TRACE.md`。

归属入口是 `wanxiangli/ownership` / `Ownership`：作用域森林、唯一资源预留、取消与排空、带实例身份的终态和递归 blocker。Reserved、Unknown、信号与超时都不会释放归属；固定父范围资源不随子任期关闭。本库不调用前三刀，C 分别组合归属、物理观察、持久提交和 Work 退休。完整协议和限制见 `OWNERSHIP.md`。

收敛入口是 `wanxiangli/convergence` / `KWayMerge`：多 writer 事实流的结构归并。各 writer 内追加顺序不变，parent 先于 child，就绪 head 之间按 EventId 文本序；同 id 同字节去重、异字节为身份碰撞（裁决委托 `wanxiangli/events`），同名 writer 流拒绝而不静默折叠；`mergeRetained` 把整个保留集合之外的 parent 视为 retention 窗口边界。纯计算，不读文件、不加锁、不解释业务事件；段聚合、retention 截止与业务折叠归调用方。规则与证明见 `src/convergence/AGENTS.md`。

保留入口是 `wanxiangli/retention` / `WriterRetention`：整条 writer 的 UTC 日期分组保留规则（今天与昨天保留，更早整条过期）。截止时刻与活动时刻由调用方给出，非有限时间拒绝而非判过期；不读时钟、不读文件、不删除。见 `src/retention/AGENTS.md`。

段名入口是 `wanxiangli/segments` / `WriterSegments`：writer 段文件的命名与分组律（`<writerId>-dddd.ndjson`，恰好四位 ASCII 数字，序号 0..9999 越界拒绝；连续段系列并组、断续名降为旧式 stem；旧式与段共存的形态命名），以及调用方读出的字节上的 writer 流成帧（`decodeStream`）与共存裁决（`coexistence`：series / legacy / continuation / diverged）。不读目录、不读写文件、不删除、不加锁。见 `src/segments/AGENTS.md`。

Casebook 索引入口是 `wanxiangli/casebook` / `CasebookIndexLaw`：公开索引的纯投影（标题与 shelfmark、稳定排序与定位、epoch 是否推进、LRU 淘汰名单）。不读存储、不持有快照、不写事件。见 `src/casebook/AGENTS.md`。

Casebook 维护入口是 `wanxiangli/casebook-maintenance` / `CasebookMaintenanceLaw`：fetch 按差异维护的纯决策（B→T 零上下文 diff、是否请求 CaseRefresh、读取故障不冒充 Missing、预算截断）。不读文件、不读写 payload、不调 Bookkeeper。见 `src/casebook-maintenance/AGENTS.md`。

Casebook 访问入口是 `wanxiangli/casebook-access` / `CasebookAccessLaw`：实质访问的纯分类（哪些访问计入 relatedPaths、工具结果的路径、规范形、执行器单文件读取）。不读文件、不持有会话状态。见 `src/casebook-access/AGENTS.md`。

规则隔离入口是 `wanxiangli/quarantine` / `RuleQuarantine`：Integrator 业务规则的 (rule, scope) 隔离账（失败登记、隔离期跳过、解除）与 `ProjectionCutTail` 截尾载荷编解码、截尾何时生效。不持有 Current、不做全量重放、不写事件；规则本体与重放预算归调用方。见 `src/quarantine/AGENTS.md`。

调度协议入口是 `wanxiangli/routing` / `RoutingProtocol`：用户 `wanxiangshu.mjs` 的协议 2 ABI owner——模块导出形状与版本、同步调用 `route(role, running, previous)`（冻结副本）、target 严格解码、理论容量查询只认布尔。不读文件、不加载模块、不持有容量；选择策略全部属于用户 MJS。见 `src/routing/AGENTS.md`。

## 第一刀：两个独立个体，一个组合者

| 入口 | 对象 | 职责 |
|---|---|---|
| `wanxiangli/work` | `Work` | 自治内存对象：工作规则、原子转移、历史数据、重放与恢复 |
| `wanxiangli/eventstore` | `SqliteJournal` | 修订号比较、原子追加、字节保存、提交结局 |
| `wanxiangli/durable-work` | `DurableWork` | 协调两者：读取事实、建立候选、比较提交、处理竞争与未知回执 |

```text
                  DurableWork (C)
                  /             \
          Work (A)               SqliteJournal (B)
     命令、结果、领域记录          记录、修订号、提交结果
```

Work 不持有 Journal，不调用它，也不接收它的接口、闭包或替身。Journal 不认识工作规则。C 在公开消息之间完成协作，不解析事件、不复制 Plan/S4 的判断；类型和产物依赖朝向参与者，A、B 之间没有依赖边。

三个公开构造器返回 F# 对象表达式：私有可变状态留在 JavaScript 闭包中，公开对象只含协议方法。没有全局单例、公共大 Context、邮箱或通用调度器，也不依赖 `instanceof`、继承或暴露字段来识别对象。仅在 F# 源码里写 private 不足以保证生成物的封装，因此验收检查实际产物的字段和别名边界。

Work 跨调用持有自己的内存状态；每次变化在私有候选上完整验证后替换，失败不留下半次变化。DurableWork 每次从 Journal 的已提交记录建立候选，只在首次确认提交后公布结果；它只持有活动标记和未知请求身份，不保留第二份业务账本。

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

npm run build -- assembly
node --test src/assembly/tests/*.test.mjs

npm run build -- process
node --test src/process/tests/*.test.mjs

npm run build -- trace
node --test src/trace/tests/*.test.mjs

npm run build -- session
node --test src/session/tests/*.test.mjs

# 实际交付包；不发布到 registry
npm pack
```

构建只有一个入口 `scripts/build.mjs`：读取各目录的显式 fsproj → npm Fable 编译 → esbuild 生成 ESM。组合者保留 `wanxiangli/work` 的公开导入，不内联、编译兄弟源码。构建以工程、源码和工具链的内容指纹按模块跳过未改动的输入，不维护跨模块源码依赖图。指定一个模块不会重编其他模块；编译失败不覆盖旧产物。单编 assembly 后运行组合测试，需要已构建的参与者产物，不需要其源码。

一次构建在同一 Node 进程内顺序编译模块，兼容的引用和编译选项共用 FCS checker。每个工程解析前清除项目缓存；引用 DLL 内容或选项不同则使用各自的 checker。工程解析仍交给 Fable，`scripts/compiler.mjs` 等待编译输出完成后才交给打包步骤。构建结束后进程退出，不跨构建保留 checker；全部模块命中缓存时不加载编译器。两个构建脚本、FCS 和元数据包版本都计入工具链指纹。

构建期间保存选中模块的源码或工程文件，会使本轮构建失败并提示重新运行。下次普通构建会补编失效模块；无需清空整个库。缓存命中的模块也会在构建结束前复查。

发布包没有 npm 运行时依赖，Fable 运行库用到的部分已打入产物。消费者不需要 F# 源码、编译器、esbuild 或本仓路径。当前包标为 private，防止验收前意外发布；tarball 安装不受影响。Fable 的许可声明随包保留。

独立安装包验收覆盖拆除兄弟产物、Node/Bun 真实进程、Trace 原件恢复，以及真实资源阻止 Work 退休和协调进程强杀后的未结算归属。这些测试不是完整宿主、进程树监管或原始来源认证的证明；宿主抽取与 HNI 迁移状态统一记录在 wanxiangshu 仓库根目录 `AGENTS.md` 的迁移章节。

## 独立内存用法

没有数据库，也没有存储替身。可以直接运行领域规则、校验离线记录或恢复一个隔离对象：

```js
import { Work } from 'wanxiangli/work'

const work = new Work('local-work')
const reply = work.execute('open', {
  type: 'Open', root: '本地工作', sequence: ['S4'],
  ownerId: 'manager', openingCursor: 0,
})
console.log(reply.status) // Applied，不是 Committed
const restored = new Work('local-work', work.records())
console.log(restored.inspect().active.id === work.inspect().active.id) // true
```

`records()` 返回可复制的序列化数据，`history()` 返回解码后的事务视图；两者都没有存储回调。`execute()` 只在新转移时返回一条 `record`，观察与重放返回 null。每条领域记录已包含完整转移，不是要求组合者逐条执行的脚本。

## 持久组合用法

下面在内存 SQLite 中完成一条 S4 工作，验证的是真实库，不涉及宿主执行能力。实际持久化时把 `:memory:` 换成调用者明确提供的数据库绝对路径；父目录须已存在。连接交由日志独占管理，`journal.close()` 会关闭该连接。

```js
import { DurableWork } from 'wanxiangli/durable-work'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DatabaseSync } from 'node:sqlite'

const journal = new SqliteJournal(new DatabaseSync(':memory:'))
const work = new DurableWork('work-1', journal)

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

在 Bun 中只替换连接的构造；三个对象仍是同一份包、同一份实现：

```js
import { Database } from 'bun:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'

const journal = new SqliteJournal(new Database(':memory:'))
```

完整命令及返回值在三个入口自带的 `.d.ts` 中；包验收会在干净消费者里运行 TypeScript 正反类型用例，包括拒绝向 Work 注入 Journal、拒绝把 Applied 当作 Committed。命令名、字段名和结果名都是协议，不做语言翻译。本库不直接生成面向模型的提示词。

DurableWork 是新增持久承诺的组合，不是声称与内存版完全同约的透明 decorator。拆掉 C 和 SQLite 后，Work 仍完整兑现内存契约；持久保证不保留，也不能继续宣称存在。同一组领域测试分别验证基础版与组合版。暂时没有其他增强层，不为满足设计风格预建框架。

## 已承接的工作规则

Plan 序列固定为 S1→S2→S3，执行序列固定为 S4。每任至多一次评审，不能自评；相同请求重放返回原结果，不产生第二次评审。空 findings 晋级，否则留级。findings 只在本次返回，不复制进持久事件。

Plan 的一次 deliver 接力到当前折叠阶段；末阶段晋级后才获得交付授权。S4 必须先评审，再由两个不同 toolCallId 完成确认、退休；Promoted 交付，Stayed 接力。开立和首任、接力退休和后任，各在同一事务。旧回执重放不能作用到后任。

DevOps 绑定跨任期保留。Advance 要求已评审、旧权威值匹配、新值从未用过。Reopen 创建新的任期，清空评审与交付授权，不复活已退休的对象。物理 blocker 由调用方提供；测试失败、findings 非空或脏工作区本身不是 blocker。

`inspect()` 给出分离视图，`recover()` 给出从记录导出的下一项义务。Work 的记录是内存中已应用的转移；DurableWork 的记录来自已提交历史，二者不混称。`rounds` 是任期与阶段的结构化核对记录，不是完整 LWR 正文或用户原文轨迹。

## 交付外部执行者

持权 Plan 不在库内启动子会话。Work 产生领域事实 `DeliveryRequested`，携带稳定 operationId、草案摘要与路径；它不声称该事实已经持久。DurableWork 先把整笔记录提交到 Journal，再返回同一领域结果。**只有来自 DurableWork 的 `status === 'Committed'` 且 `result.kind === 'DeliveryRequested'` 时，更外层才可以首次发起该操作。Applied 不满足这个条件。**

外层创建执行 session 后，必须在发送首 prompt **之前**把 `{ operationId, execSessionId }` 作为 `ResolveDelivery(SessionCreated)` 提交成功；这产生 `DeliverySessionBound`。因此重放、恢复及丢回执后的 `ObserveExecution` 会携带已经绑定的 `execSessionId`，而不是要求调用方重新猜测或再创建一个 session。

调用方随后将真实观察继续提交为 `ResolveDelivery`：

| 观察 | 结果 |
|---|---|
| SessionCreated：同一 operationId 与真实 execSessionId | 绑定容器身份；仍保持 pending，不等于启动成功 |
| Accepted：同一 operationId、已绑定执行者身份、摘要、路径，且无 blocker | 退休为 Delivered |
| Unknown | 保持 pending，不追加成功、不重发 |
| NotStarted | 记录拒绝，允许使用新请求身份显式开新尝试 |

Accepted 在 SessionCreated 持久绑定之前会被拒绝。NotStarted 必须是执行侧对这个 operationId **已确定且不会再改变的拒绝**；暂时查不到会话、超时或丢失回执都不算。调用方必须防止已拒绝的操作稍后又被启动。不能把本库的逻辑单任唯一性当成物理进程互斥锁。

外部完成之后、回执提交之前崩溃的真实场景在包验收中覆盖：安装 tarball 的消费者启动一个真正的子进程，子进程写入效果文件，父进程被 SIGKILL；新进程只查询原操作并结算，效果计数仍为一。同一场景在 Node 和 Bun 下运行；环境没有 Bun 时会明确诊断未验证该运行时。该证明不是 omp/OpenCode 子会话能力证明。

## 失败与存储边界

输入非法、错误任期、未知事件和损坏历史抛错，且不留下半次转移。Work 的结果为 Applied/Replayed/Observed；DurableWork 的提交结果分清：

| status | 调用方应如何理解 |
|---|---|
| Committed | 本次新事实已确认提交 |
| Replayed / Observed | 返回已知结果或当前义务，不能当成新的外部执行许可 |
| Conflict | 另一个请求先赢得修订号；本次零写，不自动重试 |
| NotWritten | 已知没提交；没有外部执行许可 |
| Unknown | 不能断言已写或没写；封存组合，重开存储与 DurableWork 后核对同一请求 |

未知提交期间只有 `recover()` 返回 ObserveCommit；`inspect/history/records/execute` 不再暴露可能被误用为许可的状态。同一 Work、Journal 或 DurableWork 的同步重入均拒绝，不限制其他对象运行。实例字段不泄漏，但外部仍须履行公开契约：如实提供物理观察，并把原生数据库连接独占交给 Journal。

SQLite 使用 `BEGIN IMMEDIATE`、WAL、`synchronous=FULL` 和零等待竞争策略。整个事务体作为 UTF-8 BLOB 保存，包含 BOM、NUL、组合字符的字节可完整读回；非法 UTF-16 孤立代理项拒绝，不静默替换。单笔体积上限 1 MiB。读回检查修订连续性与摘要，普通 UPDATE/DELETE 被 schema 拒绝；没有自动修复。

这是一份本地磁盘上的同步小型事实日志，不用于 token 流，不包含多机同步、远程合并、保留策略或磁盘断电证明。DurableWork 每次读取本工作的历史；Work 创建候选也重放已有记录，成本随历史长度增长。这里先保留最简完整实现，不建立持久快照或通用缓存。真实负载证明需要时，再各自加强，不改变参与者之间的依赖方向。

## 验收入口与迁移范围

`npm test` 分别运行无存储替身的 Work 测试、真实 SQLite 的事务测试、DurableWork 组合与故障测试、同一领域契约的两种整体、拆除兄弟源码及组合者后的独立验证，以及 Node/Bun 实际安装包的强杀恢复。测试还覆盖先完成内存工作再存档、逐笔提交后发布两种真实合作方式，A、B 的内部实现不变。

宿主接线、接口切换与旧实现删除边界统一见 wanxiangshu 仓库根目录 `AGENTS.md` 的迁移章节；本库不维护第二份迁移指南。宿主当前版本为 0.66.0，各公开入口见 `package.json` 的 `exports`。
