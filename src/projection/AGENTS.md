# projection — 请求投影的信息边界

层：内核。npm 入口 `wanxiangli/projection`，导出工厂 `Projection()`。不得 import 任何宿主 SDK、Trace 或存储；不持有状态、不读文件或环境变量、不渲染宿主线格式。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-17.md`；现行需求 `requirements/work/WHAT.md` [034]、`requirements/participant-horizon/WHAT.md`、`requirements/provider-projection/WHAT.md` [004]–[006]。消息解码、XTrace 游标观测、重锚事实写入与保留消息怎样写回宿主请求，都留在宿主组合者。

# AXIOM

1. [使用者] 新任期只看见属于自己的工作；用户说过的话永远不丢。
    - 理由：前任的 assistant/tool 交换混进后任会让模型把别人的半截工作当成自己的承诺；用户原文是唯一的需求来源。
2. [使用者] 宿主不得编造身份。
    - 理由：没有稳定宿主 id 的语义交换无法被定位到任期；猜一个游标或整体保留/丢弃都会悄悄改变模型看到的历史。
3. [使用者] 发给模型的投影不能取决于功能注册的先后。
    - 理由：注册顺序是实现细节；同一组意图换个顺序得到不同请求，前缀缓存与可复现性都会失效，冲突也会被静默吞掉。

4. [使用者] 已被 Relayed 退休的 attempt 不能再借一次请求继续说话；后任的请求不能被误杀。
    - 理由：退休后宿主仍可能重放旧 attempt 的消息集，放行会让旧 attempt 越过交接继续行动；反过来把后任的请求当成旧 attempt 清空，会让交接后的工作凭空停住。

# LEMMA

1. [AXIOM 1] 非合成 user 消息无条件保留，保持原顺序；合成行与 user/assistant/tool 之外的角色一律剥离。
2. [AXIOM 1] assistant/tool 只在首次观测游标 `>= openingCursor` 时保留；有宿主 id 但尚未被捕获（无游标）的视为当前任期，保留。
3. [AXIOM 2] 无宿主 id 且无语义内容的 assistant/tool 剥离；无宿主 id 却带语义内容的整次拒绝。游标只能属于有 id 的消息。
4. 输入先完整校验（数组快照、拒绝稀疏数组与 accessor、游标为非负 bigint）；回答冻结。
5. [AXIOM 3] 同批出现不同替换基底，或同一插入 key 的 anchor/行数/行指纹不同，显式冲突（基底冲突优先，行冲突报最小 key）；同值重复幂等，以首次出现为代表。
6. [AXIOM 3] 锚点指向（替换后或原始）基底的下标，插在该行之前；同一锚点按 key 序紧邻；append 在全部锚定行之后按 key 序；锚点超出基底长度整次拒绝。

7. [AXIOM 4, 2] 只有 Relayed 且带投影切点的退休才可能过时。切点 = 第一条带切点工具 call/result 的消息；请求的物理消息 = 最后一条 user（不区分大小写）消息的宿主 id，没有 id 永远证明不了归属。归属后任当且仅当：物理消息在切点之后且是当前逻辑运行的根；或是该退休门控 nudge 的接纳物理消息；或在切点之后且请求已被接纳；或切点已不在线格式中且该消息的接纳证据之根等于当前根。否则过时。

# SPEC

1. [LEMMA 1, 2, 3] 用户保留、前任交换剥离、当前交换保留、未捕获保留、合成剥离、未知角色剥离、无 id 无语义剥离、无 id 有语义抛错。
    - 证明：`tests/001.test.mjs`；与宿主原 `TenureIsolation.assemble` 的双算见宿主 CUT-17 证据。
2. [LEMMA 4] 非法输入逐一被拒且 accessor 不被读取；回答冻结。
    - 证明：`tests/002.test.mjs`。
3. [LEMMA 4, 5, 6] `layout` 与 `plan`（同一规划，plan 不校验锚点范围）：空意图、锚定与 append 次序、替换基底作锚点空间、幂等、各类冲突、200 次随机重排结果不变、越界与非法输入拒绝、回答冻结。
    - 证明：`tests/003.test.mjs`；与宿主原 `ProjectionPlanner`/`ProjectionRenderer` 的双算见宿主 CUT-17 证据。
4. [LEMMA 7, 4] `retired`：无退休不过时、切点仍在且无证据过时、切点前后的新根/已接纳、门控 nudge、切点消失后的接纳根、无 id 的 user、首个切点与大小写、非法输入与 accessor。
    - 证明：`tests/004.test.mjs`；与宿主原 `RelayNarrativeTransform.staleRetirement` 的双算见宿主 CUT-17 证据。
