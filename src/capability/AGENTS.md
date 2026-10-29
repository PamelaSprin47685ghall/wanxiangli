# capability

层：内核。不得 import 任何宿主 SDK。

# AXIOM

1. [使用者] 一个角色只能做它被授权做的事；而且"看不见"与"做不了"必须是同一件事。
    - 理由：只要两者能分叉，模型就会看见一个它无权调用的工具，或反之。前者浪费它一轮，后者是真的越权。

# LEMMA

1. [本模块 AXIOM 1] 能力 = 角色 × 请求类型。模型可见的工具面与运行时门禁读同一份能力事实。
    - 推理：两份事实就会分叉。分叉后，模型按看得见的做，运行时按另一份拒，两边都觉得自己对。

2. [本模块 AXIOM 1] 同一角色换执行者（重试、换模型、换档位）权限不变。
    - 推理：执行者是谁是物理调度问题，与角色授权是两回事。混在一起，换一次模型就换一次权限。

3. [本模块 AXIOM 1] 内部专用的动作不进普通角色的工具面。
    - 理由：内部动作是别的角色的职责边界；露出来就会诱导越界。

4. [本模块 AXIOM 1] 工具面按角色与能力生成，不手写每角色一份变体。
    - 推理：手写的变体会各自漂移，直到没人说得清某个角色到底有什么。

# SPEC

1. [本模块 LEMMA 1] 角色到能力的映射只有一个写入口（`OfficeMatrix.permissions`）；`permissions` 与 `isAllowed` 读同一份集合。能力到宿主工具名的映射也只有一个写入口（`ToolSurface.toolNames`），名字→能力反查 `permissionOfToolName` 与 `admitsToolForRole` 读同一份映射与矩阵（CUT-08 第 2 段）。
    - 证明：`tests/001.test.mjs` SPEC[capability-001] 对六个活跃角色逐能力比对 permissions 与 isAllowed；`tests/002.test.mjs` SPEC[capability-004] 对每个名字、每个角色比对反查与矩阵。

2. [本模块 LEMMA 1] 角色无法解析时，工具面置空，且运行时拒绝一切调用。
    - 证明：`tests/001.test.mjs` SPEC[capability-002]：历史角色、内部槽位、大小写错误、非字符串一律空集与 false；未知能力标签 false。

4. [本模块 LEMMA 1] Manager 门禁只读精确生命周期事实：无在任者、只有确认无评审 → 空集；清理阻塞 → Join+Finality；最终在任者 → 收尾面；已评审 → 收回只读面；否则完整集合。事实字段只有布尔 true 才成立。
    - 证明：`tests/001.test.mjs` SPEC[capability-003] 的逐分支正反例与畸形事实反例。

5. [本模块 LEMMA 1] 宿主实用工具（`skill`、`assume`）不是办公能力，不进矩阵；它们的准入也只有一个写入口（`ToolSurface.admitsUtility`），schema 投影、请求工具表与执行准入读同一判定。现行角色持有，矩阵之外的角色标签（历史、内部 distiller、未知、大小写错误、非字符串）失败关闭（CUT-08 第 4 段）。
    - 证明：`tests/003.test.mjs` SPEC[capability-005]。

3. [本模块 LEMMA 4] 基类成员、工具描述、示例与运行时门禁由同一份能力生成；缺一项能力，四处一致缺失。
    - 证明：[TODO] 生成物一致性测试。

# TODO

- 角色集合与能力矩阵已由宿主 Foundation/OfficeCapability 迁入（CUT-08，2026-10-20）；宿主保留能力 DU 与标签编解码投影。
- 生成的具体形态（编程面还是逐个工具）待 canary 证明后再定。
- 旧系统的 12 角色 / 23 能力 / 四层同构 / JS 编程面：只保留"可见即可做"这一条，其余不传承。

## Advisor 例外：协议工具不等于办公实用工具（2026-10-24）

Advisor 的 `OfficeMatrix.permissions` 仍是空集，`skill` 与 `assume` 虽是矩阵外的宿主工具，但也必须通过 `admitsUtility` 对 Advisor **明确拒绝**。`negotiate(questions: string)`、`askPreviousScope` 与任意工具上的 `scope.kind=resetScope` 注解同属 Scope 协议（办公权能 `ResetScope`），在物理 Host 接口准入；**没有独立 resetScope 工具**。不是赋予 Advisor 通用 utility 权限。测试必须同时覆盖 capability 的 utility 拒绝和 Host 实际权限对象／请求投影；提示词里写“不得使用”不足以构成能力边界。

## LiveHostConfigStore 活配置状态与深层树读写

1. 职责唯一所有者：`LiveHostConfigStore` 是纯进程内自治对象，独占持有可变宿主活配置引用（`mutable current`），负责深层树状读取、自动建中间节点深层写入、写入后 round-trip 读回核验、冻结对象抛错捕获并返回结构化结果。
2. 宿主与库分工：宿主适配器（`LiveHostConfig`）仅作为中立 `IHostConfigPort` 端口与宿主事件钩子之间的映射薄壳，主仓不再保留任何 `mutable current` 字段或树遍历代码。
