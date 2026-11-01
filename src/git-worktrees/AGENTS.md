# Git 工作树

本模块让组装方为一次工作创建隔离工作树，恢复时接管已有工作树，结束后明确保留或清理。它帮助总流程在不碰源工作区草稿的前提下完成改动，不决定委任、发布或日志事实。

`GitWorktrees(repo, run)` 绑定仓库和现有执行能力。它只发送 cwd 与 argv；宿主固定执行 Git，保留自身超时、输出、异常与默认工作目录行为。库不 spawn、不增加执行层、缓存或锁。只有 remove 不设置 cwd，其他命令使用绑定 repo。列举通过 `wanxiangli/git-porcelain` 的公开 worktrees／branches 解析器，不编译其源码。

`create(identity, path, sourceRef)` 使用宿主给出的分支名与来源，成功才拥有资源；失败不产生资源。`adopt` 按已有身份和路径接管，不查询、不创建。身份命名、何时接管与何时保留由组装方决定，核不认识 Manager。

create 资源默认在 dispose 时清理；adopt 默认保留。`markDurable` 只关闭自动清理，显式 release 仍可执行。资源的路径和身份只读，释放状态归私有闭包。

release 先 remove 工作树，再 deleteBranch。remove 返回 Error 仍执行删分支；抛异常则停止。只有两步成功才记已释放；部分失败后再次 release 会重做两步。两个返回错误合为 `worktree=…; branch=…`，单项错误保留相应前缀。成功释放后重复调用直接成功；并发调用不串行、不共享完成 Promise，不新增并发幂等保证。dispose 忽略返回错误和抛出的异常。

命令退出非零时取非空白 stderr，否则取 stdout，保留原文；执行器抛出的错误对象原样传播。库不把清理结果解释为业务提交结果，也不自动重新创建或迁移工作树。
