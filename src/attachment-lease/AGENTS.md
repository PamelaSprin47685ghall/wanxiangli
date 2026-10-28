# attachment-lease

层：内核。纯计算与自治状态，不得 import 宿主 SDK 或其它 wanxiangli 模块；不列子会话、不建/关/链/弃子会话。npm 入口 `wanxiangli/attachment-lease`。

# AXIOM

1. [使用者] 一个 Attached 种类（Companion、Sync*、Bookkeeper、只读副本）复用的子会话只能是其持久关联点名、且 agent 与 title 精确相同的那个；没有持久关联时一律新建，不收养长得一样的无关联子会话。
    - 理由：managed-session-lifecycle [001] 单一租约机制、[003] 不收养无关联会话。
2. [使用者] 新建或替换出来的子会话只有在关联写成后才算真实；关联失败必须把它弃掉，已复用的旧子会话从不弃。
    - 理由：失败的 link 留下无主子会话，下一次恢复会把它当成冲突或歧义。
3. [使用者] 进程内租约注册表与单飞单例自治管理 (owner, kind) 租约映射，并在首次 ensure 时单飞去重，避免并发创建重复子会话。
    - 理由：Package-21 状态所有权抽取；managed-session-lifecycle [001]、[002]。

# LEMMA

1. [AXIOM 1] 无 restoreHint → create(Created)。
2. [AXIOM 1] 有 restoreHint：Host 子列表中该 id 恰一个且 agent、title 均精确相等 → reuse；恰一个但不精确 → reject Conflicting；零个 → create(Replacement)，并须先关闭已消失的关联再链新子；多于一个 → reject Ambiguous。
3. [AXIOM 2] abortOnFailure(Created | Replacement) = true，abortOnFailure(Reused) = false。
4. [AXIOM 3] AttachmentLeaseRegistry 独占持有 bindings 与 flights 状态：
    - bind 覆写保存结构化条目；tryFind 精确按 (owner, kind) 查找；remove 注销单个租约。
    - tryFindByChild 与 removeByChild 按 childSessionId 反向关联并返回所有匹配 (owner, kind)。
    - ensure 独占单飞并发合并，直接持有在途对象；finishEnsure 移除占位；clear 彻底重置。

# SPEC

1. [LEMMA 1, 2, 3] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `AttachmentLeaseCore.resolve/abortFresh/closeReplaced` 逐项对照见 vibe-fs `evidence/CUT-12/`。
2. [LEMMA 4] 证明：`tests/002.test.mjs`（Package-21 单元测试）。
