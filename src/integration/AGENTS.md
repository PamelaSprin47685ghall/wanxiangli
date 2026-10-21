# integration

层：Change 集成规律。commission/manager 工作树绑定（PERSIST-009）、发布闸的判定、冲突归属与崩溃恢复续做（ORCH-007）的唯一 owner；不跑 Git、不读写日志、不持锁、不等待。npm 入口 `wanxiangli/integration`。物理 Git 读法归 `git-porcelain`，事务次序（创建/工作/清理/集成）由调用方 C 执行。

# AXIOM

1. [使用者] 一个工作树身份只归一个 manager job；耐久意图与物理观察冲突时失败关闭，绝不收养别人的目录。
    - 理由：PERSIST-009、ORCH-006。
2. [使用者] 发布只能落地被钉住的那一个 rebased 候选，且目标头必须仍是 CAS 期望；目标移动是可重试的未命中，不是失败。
    - 理由：change-integration 的 Integration Gate。
3. [使用者] 重启后只按最后一条耐久事实决定续做，不拿文件系统状态顶替耐久事实。
    - 理由：ORCH-007。
4. [使用者] rebase 失败而有未合并文件，冲突归本 job 自己的候选与目标；没有冲突文件就不是冲突。

# LEMMA

1. [AXIOM 1] NoDurableEffect → 先记意图再建；Created 回执同 owner → 收养；回执或 Requested 冲突换了 job/path → DurableOwnershipConflict；Requested 歧义只看与本 path 或本 identity 相关的物理记录：无 → 证明缺失后创建；全部恰是本 path+identity → 收养并补记 Created；否则 PhysicalIdentityPathConflict；查询失败 → WorktreeQueryFailed。
2. [AXIOM 2] admitCandidate：rebased 记录恰钉本候选与本目标才发布，否则 rebase（有记录 TargetAdvanced，无记录 InitialRebaseRequired）。certify 先查候选钉，再查快照钉。checkPublication 依次查 job、target、CAS。ffMerge：落地提交必须等于候选，声明的 target-moved 错误是 TargetMoved。
3. [AXIOM 3] resume：终态只清理，有 claim 重入，否则续跑 loop。publishClaim 依次：已快进 → 目标未变 → 过期。reenterClaim：claim 目标必须是 job 的 ref，rebased 记录仍钉同一提交与期望头才去核对 HEAD，否则回 loop。
4. [AXIOM 4] rebaseFailed：冲突文件非空 → RecordConflict（原样带回文件），空 → Fail。

# SPEC

1. [LEMMA 1–4] 证明：`tests/001.test.mjs`。
