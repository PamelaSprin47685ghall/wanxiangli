# 第一刀：工作生命周期

本文件是下一阶段的接线边界，不是已经修改旧仓的报告。依据总规则 AXIOM 4：只允许旧系统通过 npm 依赖新系统。

## 为什么选这一刀

只读检查旧工作区中的 `requirements/work/WHAT.md` 与 `src/Wanxiangshu/Mission/Lifecycle/{Facts,Kernel,Fold}.fs` 后，选择由同一个 owner 承接 Plan、Manager、Relay 共有的生命周期。该工作区当时有大量未提交改动；本次没有替它构建、测试或认定其全部行为正确。

新库承接的是开立、唯一任期、评审推进、确认、退休、后继开任、执行交付认领、DevOps 绑定、权威推进和持久恢复。不是把旧 namespace 搬进新目录，也不是保留一套旧实现再加 facade。

## 单向接入

```text
旧 Plan / Manager / Relay 调用方
           │
           │ 旧仓内部的形状转换与宿主执行
           ▼
   npm: wanxiangli/work
           │
           │ read + append 结构契约
           ▼
   npm: wanxiangli/eventstore
```

图中的连接由使用方创建；两个新库没有互相 import。最终 npm 包只含两个独立 ESM、类型声明和说明，不引用旧仓或任何个人目录。禁止 `npm link`、导入新仓的 `src/`、引用旧系统 dist、从旧仓动态解析依赖，或把整个旧 Context 传进来。

验收通过并获得旧仓修改授权后，才在旧仓执行安装。包由新仓 `npm pack` 产生；把确定版本的 tarball 加入旧仓 npm dependency。包没有发布到 registry，本轮没有替旧仓运行下面的命令：

```sh
npm install ../wanxiangli/wanxiangli-0.1.0.tgz
```

Node 路径要求 >=22.13；旧包原先的 Node >=20 声明不够。Bun 1.3.14 实测没有 `node:sqlite`，因此在组装处使用 `new SqliteJournal(new Database(path))`，其中 Database 来自 `bun:sqlite`；Node 则传 `node:sqlite` 的 DatabaseSync。新库不直接导入任何一个驱动。

两种运行时的实际 tarball 消费者已经分别完成崩溃恢复场景，但这不等于实际 OpenCode 插件已经载入成功。授权后仍须在旧宿主内验证，不能仅凭独立 Bun 场景略过接线证明。

## 规则对应与明确差异

| 旧职责或规则 | 新归属 / 处理 |
|---|---|
| 开立与首任；接力退休与后任 | `Work` 的原子事件组合；SQLite 一笔事务 |
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

交付时把 operationId 贯穿真实启动和查询。只有首次新提交的 DispatchExecution 可以调用启动；回执未知、重启、重复回调只查询。NotStarted 必须能阻止迟到的原启动请求，暂时未查到不是拒绝。宿主不能提供这种身份贯穿时，接线阶段应失败，不能降级成无条件重试。

运行相关 work、planning、relay 需求回归，并补真实宿主场景：重复回调不重复执行、后任不吃前任回执、接力保持 DevOps、丢启动回执后恢复只查询。当前新包测试不能替代这些测试。

最后删除旧仓中已经被承接且不再使用的规则代码及重复测试入口。`Mission/Lifecycle/{Facts,Codec,Fold,Kernel,Surface}` 是重点审查候选，不是未经引用检查即可整目录删除的许可；Plan、Manager、Relay 中宿主投影和物理执行责任仍可能留下。

## 完成条件

本轮结束点：新库独立构建、测试、安装；旧仓零改动，等待使用者验收。

完整抽吸结束点：旧系统真实消费这个 npm 包；同一新工作只走一个生命周期 owner；对应旧规则已退出；真实宿主回归通过。两者不能混写成同一个“已完成”。

在途旧工作要么先完成，再切新工作入口；要么在下一阶段明确批准有限的排空期。排空期间旧身份与新身份必须分区，不能双写同一工作。只有存在真实在途使用方时才登记过渡例外，本轮不预建翻译层、开关或第二套日志。
