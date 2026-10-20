# projection — 请求投影的信息边界

层：内核。npm 入口 `wanxiangli/projection`，导出工厂 `Projection()`。不得 import 任何宿主 SDK、Trace 或存储；不持有状态、不读文件或环境变量、不渲染宿主线格式。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-17.md`；现行需求 `requirements/work/WHAT.md` [034]、`requirements/participant-horizon/WHAT.md`、`requirements/provider-projection/WHAT.md`。消息解码、XTrace 游标观测、重锚事实写入与保留消息怎样写回宿主请求，都留在宿主组合者。

# AXIOM

1. [使用者] 新任期只看见属于自己的工作；用户说过的话永远不丢。
    - 理由：前任的 assistant/tool 交换混进后任会让模型把别人的半截工作当成自己的承诺；用户原文是唯一的需求来源。
2. [使用者] 宿主不得编造身份。
    - 理由：没有稳定宿主 id 的语义交换无法被定位到任期；猜一个游标或整体保留/丢弃都会悄悄改变模型看到的历史。

# LEMMA

1. [AXIOM 1] 非合成 user 消息无条件保留，保持原顺序；合成行与 user/assistant/tool 之外的角色一律剥离。
2. [AXIOM 1] assistant/tool 只在首次观测游标 `>= openingCursor` 时保留；有宿主 id 但尚未被捕获（无游标）的视为当前任期，保留。
3. [AXIOM 2] 无宿主 id 且无语义内容的 assistant/tool 剥离；无宿主 id 却带语义内容的整次拒绝。游标只能属于有 id 的消息。
4. 输入先完整校验（数组快照、拒绝稀疏数组与 accessor、游标为非负 bigint）；回答是冻结的下标数组。

# SPEC

1. [LEMMA 1, 2, 3] 用户保留、前任交换剥离、当前交换保留、未捕获保留、合成剥离、未知角色剥离、无 id 无语义剥离、无 id 有语义抛错。
    - 证明：`tests/001.test.mjs`；与宿主原 `TenureIsolation.assemble` 的双算见宿主 CUT-17 证据。
2. [LEMMA 4] 非法输入逐一被拒且 accessor 不被读取；回答冻结。
    - 证明：`tests/002.test.mjs`。
