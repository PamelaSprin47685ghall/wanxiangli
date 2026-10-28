# git-porcelain — Git 输出规范解析与路径缓存

层：物理读取与路径缓存。独立 npm 入口 `wanxiangli/git-porcelain`。在总流程中，本模块负责纯文本解析 Git porcelain 格式命令输出（工作树列表、分支、进行中 rebase 状态），并通过 RuntimePathStore 缓存规范化的主工作区路径。

## 状态所有权
- 纯文本解析函数无内部状态。
- **RuntimePathStore** 独占持有主工作区规范化路径与只读计算缓存。
- 不直接启动进程，不执行 git 命令。

## AXIOM
1. [使用者] 清理与恢复只能按 Git 自己报告的工作树与分支身份行事；把主工作树、别人的分支当成 manager 工作树会误删关键数据。
2. [使用者] 只有 rebase-merge / rebase-apply 目录真实存在才算 rebase 进行中。
3. [使用者] 运行时状态根只取主工作树；裸仓没有工作树，必须失败关闭。

## LEMMA
1. [AXIOM 1] 解析 `worktree list --porcelain`，空行分隔记录，识别完整分支 ref 与工作树路径。
2. [AXIOM 1] 分支列表解析自动剥离 `*` / `+` 检出标记；仅非主工作树且短名不匹配活跃任务的 manager 分支判定为陈旧工作树。
3. [AXIOM 3] `RuntimePathStore` 规范化路径结尾，异步计算失败安全驱逐，支持 CAS 缓存失效。

## SPEC（调用方流程）

1. **工作树与分支解析**：
   - 宿主执行 git 命令后将输出文本传入解析。系统准确还原工作树结构、活动分支及 rebase 中断状态。
2. **陈旧工作树判定**：
   - 传入活跃任务列表，系统筛选出已失效的 manager 工作树及其临时分支，供上层执行安全回收。
3. **主工作区路径计算与缓存**：
   - 通过 `RuntimePathStore.getOrCompute` 统一获取工作区绝对物理路径，并发请求共享计算结果。
