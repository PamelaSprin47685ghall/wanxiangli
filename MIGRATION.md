# 渐进抽取与旧仓接线边界

## 第四刀补充：0.5.0 资源归属与收尾

独立入口 `wanxiangli/ownership` 只管理已登记的收尾范围与资源义务；说明见 `OWNERSHIP.md`。本轮没有读取或修改旧仓，前三刀生产实现没有改动。它不是新的业务 Work，也不接管 ProcessSession 的物理判断。

未来接线时，由 C 选择 scope：长期资源属于工作父范围，任期活动属于子范围。物理启动或首个提示必须在归属预留持久确认之后；Reserved 和未知启动同样阻止范围关闭。归属不能根据超时、信号、文字结果或一个可复用的会话 ID 自动释放。

实际实例绑定应贯穿创建与查询；回执携带 registryId/resourceId/token 及 externalId/incarnationId，旧实例终态不能释放新实例。Drain 的持久提交先关闭新准入，再查询 blocker 和发起物理收尾。终态确认后结算 lease，最终把本范围的剩余 blocker 交给实际 Work 门禁；不能保留旧侧另一份可独立清空的活动列表作为第二权威。

Ownership 不迁移所有权，不查询宿主，不发现逃逸后代；旧宿主现有的会话分类、附件绑定、物理监管与新范围之间需要真实适配和回归后再裁决。当前安装包的实际 ProcessSession/SQLite/Work 场景只证明这些受测参与者，不是旧仓接线完成的报告。

## 第三刀补充：0.4.0 确认轨迹

独立入口 `wanxiangli/trace` 不依赖前两刀；原始字节、稳定观察身份、固定区间和终态由 Trace 维护。用法见 `TRACE.md`。本轮没有读取或修改旧仓，也没有运行旧仓构建或替协作者改动代码。

后续接线时，由旧宿主适配提供明确来源、稳定 message/part/run 身份和已确认部件。流式候选不能冒充原件；同身份的消息编辑不能覆盖旧字节，须给出新的观察身份。完成回执必须在已确认部件捕获之后；Unknown 不转成终态。

Trace 的 cut 与 Work/ProcessSession 的游标不是同一种值，不能混用或只强转数字。跨库的取材、提交和呈现由组合者通过公开消息组织。Appended 只证明内存接受；外侧先确认真实 Journal 提交，再对调用方报告已持久保存。现有宿主 XTrace/前缀与新协议没有宣称字节兼容，旧实现的退出仍须在实际接线和回归后裁定。

第三刀提供的 statement 只取固定范围内最后已完成助手散文，不能冒充完整 LWR、自动总结或评审证明。本文下方的第一刀历史接线范围仍保留。

本文件是下一阶段的接线边界，不是已经修改旧仓的报告。依据总规则 AXIOM 4：只允许旧系统通过 npm 依赖新系统。

0.3.0 新增的正交进程能力见 `PROCESS.md`。本轮只使用新仓草稿及公开运行时文档，没有重读正在由合作者修改的旧仓；因此下面第一刀的旧仓调查仍是历史材料，不当作旧仓当前快照。

## 第二刀的接回边界

`ProcessSession` 可独立消费，但尚未替换旧进程入口。以后获准接线时，由旧侧或明确的组合者把 argv、环境、目录、容量和操作身份组织好；库不接收旧 Context，也不替 Work 产生持久提交或成功评审。

新增 API 没有改变 0.2.0 的 Work、DurableWork、SqliteJournal 接口。与持久操作组合时，必须先取得相应操作的首次提交许可，再启动进程；`started`、`write`、`wait` 各只说明自己的物理观察，不自动映射为 Delivered 或 NotStarted。命令已启动但非零退出、失去输出或等待超时，都不能谎报成从未启动。

输出采用原始字节尾部，不是旧 spool 的完整持久日志替代。PTY、全量输出落盘、父程序崩溃后的监管、逃离进程组的后代，以及旧门禁与宿主信号仍需另行落实。没有当前调用方的证据前，不预建兼容层，也不宣布旧目录可以删除。

## 为什么选这一刀

只读检查旧工作区中的 `requirements/work/WHAT.md` 与 `src/Wanxiangshu/Mission/Lifecycle/{Facts,Kernel,Fold}.fs` 后，选择由同一个 owner 承接 Plan、Manager、Relay 共有的生命周期。该工作区当时有大量未提交改动；本次没有替它构建、测试或认定其全部行为正确。

新库承接的是开立、唯一任期、评审推进、确认、退休、后继开任、执行交付认领、DevOps 绑定、权威推进和持久恢复。不是把旧 namespace 搬进新目录，也不是保留一套旧实现再加 facade。

## 单向接入

```text
旧 Plan / Manager / Relay 调用方
           │
           │ 旧仓内部的形状转换与宿主执行
           ▼
   npm: wanxiangli/durable-work (C)
            /                  \
   wanxiangli/work (A)     wanxiangli/eventstore (B)
```

C 组织持久协作：读取 B，向 A 提供数据和命令，把 A 的完整记录提交给 B，然后按真实回执回答。A 不认识 B 的服务，B 不认识 A 的业务。第一刀包含三个 ESM，当前 0.5.0 包还包含后三刀的独立入口；C 使用 A 的公开导入，不把它内联成私有副本。禁止 `npm link`、导入新仓的 `src/`、引用旧系统 dist、从旧仓动态解析依赖，或把整个旧 Context 传进来。

验收通过并获得旧仓修改授权后，才在旧仓执行安装。包由新仓 `npm pack` 产生；把确定版本的 tarball 加入旧仓 npm dependency。包没有发布到 registry，本轮没有替旧仓运行下面的命令：

```sh
npm install ../wanxiangli/wanxiangli-0.5.0.tgz
```

Node 路径要求 >=22.13；旧包原先的 Node >=20 声明不够。Bun 1.3.14 实测没有 `node:sqlite`，因此在组装处使用 `new SqliteJournal(new Database(path))`，其中 Database 来自 `bun:sqlite`；Node 则传 `node:sqlite` 的 DatabaseSync。新库不直接导入任何一个驱动。

两种运行时的实际 tarball 消费者已经分别完成崩溃恢复场景，但这不等于实际 OpenCode 插件已经载入成功。授权后仍须在旧宿主内验证，不能仅凭独立 Bun 场景略过接线证明。

## 新仓 0.1 → 0.2

这次是公开接口改变，不保留让旧形状继续藏在 Work 内的别名。

| 0.1 | 0.2 |
|---|---|
| `new Work(workId, journal)` | 持久用法改为 `new DurableWork(workId, journal)`，从 `wanxiangli/durable-work` 导入 |
| Work 必须有 read/append 服务 | `new Work(workId, records?)` 独立运行，构造只接收序列化数据 |
| 一种对象同时负责领域与提交 | Work 返回 Applied；DurableWork 返回 Committed/Conflict/NotWritten/Unknown 等 |
| `DispatchExecution` | `DeliveryRequested` 是领域事实；真实启动必须另核对 DurableWork 的首次 Committed |
| 只有源码层面的字段私有 | F# 对象表达式把状态封装在生成物闭包中，公开对象没有内部字段和辅助方法 |
| Unknown 后仍可读取可能被误用的状态 | 只允许 recover 返回 ObserveCommit，重开组合并核对同一请求 |

SQLite schema、领域记录的字段与身份算法没有因这次拆分而改变。内存状态和持久事实不是两份能互相覆盖的权威：C 的候选由 B 的记录重建，失败即丢弃；Work 单独使用时只承诺内存应用。普通构造与公开方法仍可用，不把构造器 prototype 或 `instanceof` 当公开身份协议。

## 规则对应与明确差异

| 旧职责或规则 | 新归属 / 处理 |
|---|---|
| 开立与首任；接力退休与后任 | Work 原子领域转移，DurableWork 协调 Journal 一笔提交 |
| S1/S2/S3 与 S4；一段与两段 deliver | 保留序列与确认语义，不保留散落的第二规则 owner |
| review 的 Promoted/Stayed 与 findings | 同一任期一次评审；findings 只返回，不落第二份事实 |
| DevOps 绑定、Advance、退休回执重放 | 同一 Work 对象及已提交历史 |
| 先启动执行会话，再写退休 | **改变**：先保留 operationId，外侧启动；未知结果只查询，不重发 |
| Reopened 恢复同一个 incumbency、游标置零 | **改变**：新任期、新观察游标，旧任永不复活 |
| 旧身份摘要和事件包裹格式 | **不兼容**：新身份用规范 JSON 元组摘要，新事务体存 SQLite BLOB；不得把新旧 ID 混用 |
| 旧工作日志 | 不翻译、不重放进新库；按新工作边界切换 |
| provider 信号、XTrace 游标、实际工具权限与执行 | 仍由旧宿主侧观测、接线、执行，不塞回新库 |

## 授权后才做的工作

先沿实际调用链定位 `Mission/Lifecycle/Surface.fs`、Plan/Manager 的工作入口、Relay 的结束与恢复入口。适配只把已观察事实转成 `Command`，把 `Decision` 转回当前调用方结果；不能自己再次计算评审结果、确认次数、下一阶段或退休身份。

实例装配必须统一工作 ID、持久目录和命令请求身份。调用前携带当前任期；宿主回调重入使用相同 requestId 与相同输入，不能给每次重试发一个新 ID。reviewerId 与 ownerId 来源由宿主如实绑定，不能传两个任意名字绕过自评检查。`canWriteSource` 等投影只有被真实工具门禁采用，才成为实际防护。

交付时把 operationId 贯穿真实启动和查询。只有 DurableWork 首次 Committed 的 DeliveryRequested 可以调用启动；内存 Applied、回执未知、重启、重复回调都不另发启动。NotStarted 必须能阻止迟到的原启动请求，暂时未查到不是拒绝。宿主不能提供这种身份贯穿时，接线阶段应失败，不能降级成无条件重试。

运行相关 work、planning、relay 需求回归，并补真实宿主场景：重复回调不重复执行、后任不吃前任回执、接力保持 DevOps、丢启动回执后恢复只查询。当前新包测试不能替代这些测试。

最后删除旧仓中已经被承接且不再使用的规则代码及重复测试入口。`Mission/Lifecycle/{Facts,Codec,Fold,Kernel,Surface}` 是重点审查候选，不是未经引用检查即可整目录删除的许可；Plan、Manager、Relay 中宿主投影和物理执行责任仍可能留下。

## 完成条件

本轮结束点：新库独立构建、测试、安装；旧仓零改动，等待使用者验收。

完整抽吸结束点：旧系统真实消费这个 npm 包；同一新工作只走一个生命周期 owner；对应旧规则已退出；真实宿主回归通过。两者不能混写成同一个“已完成”。

在途旧工作要么先完成，再切新工作入口；要么在下一阶段明确批准有限的排空期。排空期间旧身份与新身份必须分区，不能双写同一工作。只有存在真实在途使用方时才登记过渡例外，本轮不预建翻译层、开关或第二套日志。
