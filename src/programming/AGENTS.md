# programming — 受限 JS 编程面投影

层：内核。npm 入口 `wanxiangli/programming`，导出工厂 `Programming()`。不读宿主 SDK；不持有跨调用状态；不读文件或环境变量。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-25.md`。沙箱执行归 `wanxiangli/sandbox`；办公矩阵归 `wanxiangli/capability`；基类散文模板、ToolsBindings、Plan 工作流留宿主。

# AXIOM

1. [使用者] todowrite-for-ROLE 只从唯一权威能力集投影；没有可投影的编程面能力时不生成该工具。
2. [使用者] schema 准入、执行准入与生成器成员目录读同一份投影。

# LEMMA

1. [AXIOM 1] 办公能力标签 → JS 能力标签的映射只有一份；JsPlan 展开为 Read/Write/Ask；无映射的标签（Edit、Pty、Deliver…）不产生成员。
2. [AXIOM 2] 成员名与附加能力（dag 需要 Join）只有一份 registry；Manager 的读成员挂到 reviewOnly.*。

# SPEC

1. [LEMMA 1] Edit 单独不投影；Exec 单独投影 call；JsPlan 单独投影 Read/Write/Ask。
2. [LEMMA 2] schema/admission/generator 共用 `admitsSurface`；Orchestrator 持有 Fork 时成员面改为 Commission。
