# casebook-maintenance — 案卷维护 Diff 与冲突派发

层：内核纯计算与进程内状态自治。独立 npm 入口 `wanxiangli/casebook-maintenance`。在总流程中，本模块负责计算关联文件从基线到目标状态的统一 Diff，以便对历史案卷进行增量刷新，并在发生语义冲突时安全去重通知。

## 状态所有权
- 纯计算函数独占拥有零上下文统一 Diff（Myers 算法）计算与截断逻辑。
- **CasebookSettlementOwner** 独占持有冲突字典与按事件 ID 幂等去重认领逻辑。

## AXIOM
1. [使用者] fetch 只在关联文件真的从维护基线变到目标状态时请求 CaseRefresh，并且交给 Bookkeeper 的 diff 恰好描述该变化。
    - 理由：无变化时请求维护是浪费并可能改坏正文；diff 不忠实会让维护基于假变化。
2. [使用者] 读取故障不得冒充 Missing；无法读取不能当作文件已被删除。
3. [使用者] 冲突认领单次送达且不可越界认领。

## LEMMA
1. [AXIOM 1] `fileDiff` 产生标准 unified diff；两端无变化返回空串。
2. [AXIOM 2] 仅当文件系统明确返回 ENOENT 时判定为 `missing`，其余错误归类为 `fault`。
3. [AXIOM 1] 超预算时保留头尾各约一半并拼接截断声明，截断点不切断代理对。
4. [AXIOM 3] `CasebookSettlementOwner` 对同一 eventId 幂等去重，安全触发回调并隔离异常。

## SPEC（调用方流程）

1. **维护 Diff 计算与摘要**：
   - 案卷刷新前比对文件基线与当前状态，生成精准 Diff 文本；若 Diff 为空则无需发起刷新。
2. **读取故障判定与截断**：
   - 遇到读取异常时区分文件缺失与系统故障；对超大 Diff 实施预算内截断，避免膨胀。
3. **冲突认领与通知**：
   - 观测到案卷冲突时通过 `CasebookSettlementOwner.Observe` 登记；仅首次触发回调通知，重放事件安全忽略。
