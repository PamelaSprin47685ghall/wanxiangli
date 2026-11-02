# Git 解析、工作树与发布

`wanxiangli/git` 提供三个分别使用的对象：GitPorcelain 读取 Git 输出，GitWorktrees 管工作树资源，GitPublication 整理和发布固定候选。它们帮助总流程在隔离工作区完成并交付改动，不决定委任、授权或业务提交。三个对象同属一个工程，仍各自拥有状态；读取解析器无需构造资源或发布对象。

## 输出解析

GitPorcelain 不 spawn、不读写文件。`worktree list --porcelain` 按空行分记录，CRLF 的 CR 只作行终止；worktrees 保留完整分支 ref，detached 为 null。branches 去掉 `*`/`+` 检出标记；shortBranch 仅去掉 refs/heads/。

`primaryWorktree` 读取 `-z` 输出的首条记录；bare 与无法识别分别返回错误形状。rebaseStatePaths 只交回成功、非空白探针的裁剪路径；路径是否存在由使用者检查。产品分支前缀、任务归属和陈旧资源筛选留在外侧；解析器不持有工作区定位缓存。

## 工作树资源

`GitWorktrees(repo, run)` 绑定仓库和调用方执行器，只发送 cwd/argv，不增加执行层、锁或缓存。remove 不设置 cwd，其他命令使用绑定 repo。列举在工程内组合唯一的纯解析实现。

create 使用调用方给出的分支名、路径和来源，成功才返回资源；adopt 接管已有资源，不查询、不创建。create 资源默认在 dispose 时清理；adopt 默认保留。markDurable 只关闭自动清理，显式 release 仍可执行。资源路径、身份只读，释放状态归资源闭包。

release 先 remove 工作树再 deleteBranch。remove 返回 Error 仍删分支；抛异常则停止。两步均成功才记已释放；部分失败后再次 release 重做两步。两个返回错误合为 `worktree=…; branch=…`，单项错误保留前缀。成功后重复调用直接成功；并发调用不串行、不共用 Promise。dispose 忽略返回错误和异常。

非零退出选择非空白 stderr，否则 stdout，保留原文；runner 拒绝原对象传播。资源清理不代表业务提交，不自动重新创建工作树。

## 候选准备与发布

GitPublication 绑定 repo 和 runner；预算、取消、spool 与进程执行归调用方。rebase 探针先读取 Git 给出的路径，再用 Node fs 检查目录实际存在，不把 REBASE_HEAD 当作在途 rebase。入口因此会加载 Node 文件依赖；纯解析仍不做 I/O。

prepare 先 add -A，再拒绝未合并路径和冲突标记；存在 rebase 目录时直接 continue，不重复 stage。否则删除旧 REBASE_HEAD 后按原文 commit message 提交，保留 nothing-to-commit 的成功解释。独立 rebase 的 continue 路径先 stage；新 rebase 先删旧 REBASE_HEAD，再 rebase target。删除旧引用的非零退出被忽略，runner 抛错仍停止。

fastForward 依序核对工作树 HEAD 与 pin、当前分支与 target、目标 HEAD 与 expectedHead、ancestor、干净工作树，再 merge 固定 SHA，最后核对实际 HEAD。失败不继续，目标变化为 target-moved，其余为 failed；保留原 ref-moved 文本识别。

dirtyPaths 保留 porcelain 文本与 rename 目标读法；stdout/stderr 选择和错误原文不统一改写。对象不提供跨命令原子 CAS，外部进程仍可能竞争。物理 merge 后核对失败不能解释为未发生，也不能自动重发。工作树资源与发布对象的合作由外侧安排，门闩、授权、日志结算与重试不并入本模块。
