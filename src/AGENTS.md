# 总规则

本文件约束 `src/` 下全部代码。根目录 `AGENTS.md` 是元规则，讲 AXIOM / LEMMA / SPEC 本身怎么写；本文件讲这些代码为什么存在、边界画在哪里、什么该删。GUIDE 只在根目录一份，此处不重复。

引用约定：根目录条目写作 `根 AXIOM 3`、`根 LEMMA 4`、`根 SPEC 2`；本文件写作 `总规则 LEMMA 4`、`总规则 SPEC 3`；子模块的规则与测试就近放置，不复制根 GUIDE。

# 当前 program/runtime 职责索引

| 公开入口 | 源码 | 状态与行为所有者 |
| --- | --- | --- |
| `wanxiangli/program` | `program/`、`program/wait/` | Program() 登记入口，ProgramSession 会话登记与重放，私有 Run 单次运行、暂停代际与结算，ProgramCatalog 投影，Wait 等待控制 |
| `wanxiangli/runtime` | `runtime/` 及 files/process/pty/spool/time | Runtime 独立进程，RuntimeTools 原语与字面锚点，FileSession 读版本，各物理对象自己的资源和输出 |
| `wanxiangli/provider-calibration` | `provider-calibration/` | ProviderCalibration 进程内会话用量与声明上限的单一自治状态 owner，宿主仅写入真实观测 |
| `wanxiangli/external-namespaces` | `external-namespaces/` | ExternalNamespaces 进程级已声明 MCP 命名空间单调集合及严格匹配；宿主配置解码和角色授权留在宿主 |

program → runtime 是根规则明确的永久单向基础依赖，仅消费公开产物。模型入口恰为 name/program/planB；顶层一次性期限约束本次所有 call/unpark，成员不能续期。独立 join() 无参数，编程内 join/dag 已删除。旧八入口退出。

下方既有阶段清单与历史证明只记录当时范围，不作为当前 exports 或最终验收状态；当前构建、真实执行和安装均须独立验证。

# AXIOM

1. [使用者] 一次用户委托要能驱动多轮无人值守的工程工作，事后能逐轮说清这一轮为什么发生、什么已经成立、路因此怎么变。
    - 理由：用户花钱买的是省下来的重读。说不出理由，用户就得自己把轨迹读一遍，等于没省。

2. [使用者] 宿主（omp、opencode 或别的）的寿命短于本系统。
    - 理由：宿主会换。绑死一个宿主，换一次就重写一次，用户为同一件事付两次钱。

3. [开发者] 内核、存储与宿主能力各自成立，由显式组合者协调；内核不认识宿主，GAP 承担宿主差异。
    - 理由：合作方式变化时，不该连带重写参与者。组合者拥有顺序与提交处理，但不接管参与者的领域判断。

4. [使用者] 逐个从旧系统抽取真实职责，只允许旧系统通过 npm 依赖新系统。
    - 理由：每一刀都必须成为可用资产；不同时维护两份同职责实现。旧仓的修改另行授权。

5. [开发者] 本项目选择 F# 自治对象与显式组合，使用 npm 交付 JavaScript，不引入 Actor 运行时。
    - 理由：沿用工具链和语言，改变的是职责与状态归属；单线程也能用普通成员消息完成合作。

# LEMMA

1. [根 AXIOM 5, 6] 按后果判断不可逆性，不按动作名称判断。请求结果未知时不得重发。
    - 推理：重试、派工、接力也可能真的启动第二个执行者；不能因为名字属于内部流程就把它当作可撤销动作。

2. [根 LEMMA 9] 临时例外只登记在根 `AGENTS.md` 的《例外清单》，不在子目录建立第二份清单。
    - 推理：一处登记才有统一的使用方和解除条件；证明未完成与临时例外分开记录。

3. [AXIOM 2, 3, 5; 根 LEMMA 3, 4] Work 接受命令与历史数据，Journal 接受不透明记录；两者之间不注入服务。DurableWork 分别向二者发送消息，负责从持久历史建立候选、比较修订并按提交结果答复。
    - 推理：把读取和提交的流程放到 C，Work 才能在没有 Journal 及其替身时成立。C 只处理合作协议，不解析事件或重写业务条件。

4. [AXIOM 1; 根 AXIOM 5; LEMMA 1] 用户原文逐字节保留；模型的话可以重述。
    - 推理：用户原文不可逆（LEMMA 1），而且是逐轮理由的最终依据。模型的话丢了，下一轮可以从 durable 事实重新查出来。两者代价不同，不能共用一条压缩规则。

5. [AXIOM 3; AXIOM 1] GAP 只观测宿主，不猜。
    - 推理：GAP 与宿主同寿。它猜错，内核拿到假事实，AXIOM 1 的“说清”就退化成编故事。宿主没给的事实，标成缺失，不补。

6. [AXIOM 2, 3, 5; 根 LEMMA 3, 4, 5] 进程执行作为独立物理能力成立，不认识工作阶段或日志；可直接使用标准运行时，不必先经过宿主。实际执行与任务认领的合作由外侧负责。
    - 推理：真实进程的启动、管道和信号本身就是完整职责；把它约束成只有空契约、必须等宿主实例，反而失去独立使用和验证的边界。

7. [LEMMA 1, 5, 6; 根 LEMMA 3, 4] 资源归属独立于业务任期和物理容器。Ownership 保存唯一 owner 与未收尾义务，物理 owner 给出实例终态，C 在持久提交后把归属投影交给实际业务门禁。
    - 推理：超时和信号不是结束，业务退休也不能代替资源收尾；这些判断需要各自拥有。把物理查询注入 Ownership，或把资源树塞进 Work，都会重新扩大维护边界。

# SPEC

1. [AXIOM 3; LEMMA 3] 独立职责逐个编译并直接验证公开消息；组合者依赖参与者的交付产物，不编译参与者源码。构建、运行时协作、交付独立分别证明。
    - 证明：`scripts/tests/build.test.mjs` 已通过去掉兄弟源码、实例及存储替身后的 Work 验证；C 单独编译并以参与者产物运行真实组合。安装包在 Node/Bun 干净消费通过。其余草稿不算已实现。

2. [LEMMA 2] 根例外清单是唯一登记处；已消除的旧耦合不永久保留兼容别名。
    - 证明：已退出旧 `Work(workId, journal)` 与 MemoryJournal 替身，改为 `Work(workId, records?)` 和 `DurableWork(workId, journal)`；0.2.0 的类型正反用例与实际消费者通过。根例外项已移除。

3. [AXIOM 2; LEMMA 5] 宿主能力集只能用真实 canary 建立，不从旧系统、文档或想象里抄。
    - 证明：[TODO] 第一条 canary：F# → Fable → JS 产物被 omp 真实载入，然后做到三件事——读到工作区根、拦到一次 provider 请求、起一个子会话。任一条做不到，AXIOM 2 的假设与本文的分层都要重写。

4. [AXIOM 1, 4; 根 LEMMA 4, 6] 首刀承接开立、评审、接力、交付与恢复；Work 的 Applied 不表示落盘，实际外部效果只由更外层在首次 Committed 后发起。
    - 证明：48 项无存储领域测试、18 项真实 SQLite 组合测试、Node/Bun 安装包强杀恢复分别通过。旧仓接线、旧职责删除与宿主 canary 仍未完成。

5. [AXIOM 1; LEMMA 4] 一轮工作结束必须留下可复核的记录：发生了什么、现在什么成立、路因此怎么变。记录由内核产生，形状不跟宿主走。
    - 证明：[TODO] 记录的最小形状与生成点，在对应子模块落地时证明。

6. [AXIOM 1; AXIOM 3] 测试与它验证的规则同处一个子模块，不另设需求树。
    - 证明：已实现的领域、存储、协作、进程、轨迹与归属测试分别在各库 `tests/`；跨库组合、npm 消费及拆除证明在 `scripts/tests/`。

7. [AXIOM 1] 代码标识符、包名、提交信息用英语；注释与面向人的说明用中文；面向模型的文本与资源成对提供 `en` / `zh-CN`，缺一侧即启动失败。
    - 证明：[TODO] 成对资源可由机械检查证明；注释语言靠评审，不设扫描门禁。

8. [LEMMA 1, 6; 根 SPEC 2, 3, 4] 第二刀使用独立 ProcessSession 承接真实进程、有限输出和显式等待；超时、信号、退出分别报告，不能自动重启或冒称全树终止。
    - 证明：`process/tests/` 的 49 项测试，以及隔离编译和删除第一刀产物后的 Node/Bun 安装包验收均通过。只有 Linux 实测，PTY、逃逸后代监管、全量落盘与宿主接线未实现。完整命令见 `PROCESS.md`。

9. [LEMMA 4, 5; 根 LEMMA 3, 4, 5] 第三刀由独立 Trace 维护确认轨迹及固定边界：明确来源，不根据正文推断；原始字节不被消息投影或最后助手散文覆盖。持久化由外侧组合，不进入 Trace。
    - 证明：`trace/tests/` 验证逐字节取回、去重、单一终态、固定窗口及恢复拒绝；`scripts/tests/trace-package.test.mjs` 实际安装后完成 Node/Bun 的 SQLite 强杀恢复及去掉前两刀的单独使用。完整回归结果见 `施工顺序.md`；宿主捕获、完整 LWR 与压缩仍未实现。

10. [LEMMA 1, 7; 根 SPEC 2, 3, 4] 第四刀在外部效果之前预留归属；Reserved/Running 均阻止关闭，Drain 不释放，Ended 绑定该次实例。C 关闭准入、确认物理结束后才允许范围关闭与业务退休。
    - 证明：`session/tests/` 覆盖森林、抢占、容器复用、迟到终态、原子关闭和恢复；`scripts/tests/ownership-composition.test.mjs` 覆盖真实 SQLite 竞争及未知提交；安装包在 Node/Bun 上验证实际进程、Work 阻塞、强杀恢复与 Ownership 单独使用。未证明未登记资源发现或完整进程树监管。

# TODO

- 子模块目录已建，共 19 个。每个的 `AGENTS.md` 按重要度逐个落，已落的写进下面这张表；`——` 表示尚未落。

  | 层 | 目录 |
  |---|---|
  | 内核 | `lifecycle` `authority` `handle-lifecycle` `delegate-batch` `events` `eventstore` `failure` `capability` `trace` `delivery` `degeneration` `ablation` `session` `identity` `time` `prefix` `projection` `resources` |
  | 物理能力 | `process` |
  | GAP | `host-omp` |
  | 组装 | `assembly` |
  | 测试入口 | `tests`（只放跨子模块的竖切与 canary） |

- 旧系统里这些包不再建：`journal`（并入 `events` 与 `eventstore`）、多副本收敛（并入 `eventstore`）、`participant`（并入 `identity` 与 `capability`）、行为诊断与规则书、`guidance`、`knowledge`、`strength`、`sphinx`、`repository-*`。它们大多只守可撤销的动作，或只为旧宿主服务。出现真实义务或第二个真实使用方时再建。
- 旧系统的用户可见行为由各子模块在自己的 `AGENTS.md` 里承接；本文只承接到"一次委托驱动多轮无人值守工作且逐轮可复核"这条验收。
- 施工顺序见仓库根 `施工顺序.md`。本次已由使用者改为大粒度渐进抽取，不再把 omp canary 作为独立内核的前置条件。
- 除 lifecycle、eventstore、assembly、process、trace、session 外均为未实现候选；events 已有 0.6.0 的源码实现与契约测试（`src/events/tests/`），运行与安装验证待 DevOps 执行，验证通过前不与已实现六库混写。其中旧的“注入即独立”“只接线无协作责任”等表述不是实现依据。实际开工时依据根规则重判，不因草稿存在而扩大工作包。Trace 的最后助手散文不代表完整 LWR；Ownership 的资源归属不代表实际宿主会话管理已经完成。
