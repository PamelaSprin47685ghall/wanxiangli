# git-porcelain

层：物理读法。Git 打印的工作树、分支与进行中 rebase 文本怎样读的唯一 owner；不 spawn 进程、不碰文件、不决定发布或委任。npm 入口 `wanxiangli/git-porcelain`。

# AXIOM

1. [使用者] 清理与恢复只能按 Git 自己报告的工作树与分支身份行事；把主工作树、别人的分支或被标记前缀污染的名字当成 manager 工作树，会误删目录或分支。
    - 理由：change-integration 与 ORCH-006 以分支为工作树的稳定身份。
2. [使用者] 只有 rebase-merge / rebase-apply 目录存在才算 rebase 进行中；残留的 REBASE_HEAD 不是证据。
    - 理由：ORCH-003 冲突续做。
3. [使用者] 运行时状态根只取主工作树；裸仓没有工作树，必须失败关闭。

# LEMMA

1. [AXIOM 1] `worktree list --porcelain` 以空行分隔记录；`worktree ` 开记录、`branch ` 给完整 ref；CR 只是行终止符的一部分，不是记录分隔符。
2. [AXIOM 1] `branch --list` 的 `*`/`+` 检出标记不属于分支名。
3. [AXIOM 1] manager 分支是 `manager/<job>`，带或不带 `refs/heads/` 前缀都认；比较前去掉 `refs/heads/`。
4. [AXIOM 2] rev-parse 成功且路径非空的探针才进入待检目录。
5. [AXIOM 3] `-z` 输出的第一条记录含 `bare` 即裸仓；首字段不是 `worktree ` 即无法识别。

6. [AXIOM 1] 工作树回收：只有 manager 分支且短名不属于任何活跃 job 的工作树才算陈旧；主工作树与 detached 工作树永不陈旧。归属按短名整体比较，不从分支名里反解 job id。陈旧分支原样返回待删。

# SPEC

1. [LEMMA 1–5] 证明：`tests/001.test.mjs`。
2. [LEMMA 6] 证明：`tests/001.test.mjs` `SPEC[git-porcelain-2]`。
