# Git 候选准备与发布

本模块把工作树修改整理成候选，并在组装方已经决定发布后，将固定候选以 ff-only 合入固定分支。它帮助总流程交付实际改动，不授予发布许可、不审阅、不写业务事实，也不管理工作树资源的保留与释放。

GitPublication 绑定 repo 和调用方提供的 runner。所有命令通过 cwd/argv 发送，执行、预算、取消、输出 spool 与进程错误仍归调用方；runner 拒绝原对象传播。目录探针使用 git-porcelain 的公开 rebaseStatePaths，再检查 Git 所给路径实际存在且为目录，不把 REBASE_HEAD 当成在途 rebase。

prepare 先 add -A，再拒绝未合并路径和冲突标记；若真有 rebase 目录，直接 continue，不重复 stage。否则删除旧 REBASE_HEAD 后按调用方原文 commit message 提交，保留 nothing-to-commit 的成功解释。独立 rebase 的 continue 路径先 stage；新 rebase 先清旧 REBASE_HEAD，再执行 rebase target。旧引用删除的非零退出被忽略，runner 抛错仍停止。

fastForward 顺序核对工作树 HEAD 与 pin、当前分支与冻结 target、目标 HEAD 与 expectedHead、ancestor 和干净工作树，随后 merge 固定 SHA，最后核对实际 HEAD。失败不继续后续命令；目标变化以 target-moved 标识，其他失败为 failed。宽泛的旧 Git ref-moved 文本识别保持，不在本项更改分类。

dirtyPaths 保留普通 porcelain 文本及 rename 目标的读法；各操作沿原 stdout/stderr 选择与错误原文，不统一成新的诊断格式。本对象没有跨 Git 命令的原子 CAS；外部进程仍可能竞争。物理 merge 后若结果核对失败，交回失败供外侧观察，不能自动重发或宣称未发生。产品角色命名、门闩、授权、日志结算和重试决定都在外侧。
