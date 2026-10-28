# projection — 请求投影的信息边界

层：内核。npm 入口 `wanxiangli/projection`，导出工厂 `Projection()`。不得 import 任何宿主 SDK、Trace 或存储；不持有状态、不读文件或环境变量、不渲染宿主线格式（`wire`/`semantic` 给出的是 provider 投影的规范字节，不是宿主请求对象）。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-17.md`；现行需求 `requirements/work/WHAT.md` [034]、`requirements/participant-horizon/WHAT.md`、`requirements/provider-projection/WHAT.md` [004]–[006]。消息解码、XTrace 游标观测、重锚事实写入与保留消息怎样写回宿主请求，都留在宿主组合者。

# AXIOM

1. [使用者] 新任期看见全部用户消息、触发接力的那次 review 调用与它的结果，以及屏障之后标明属于自己的消息。更早的 assistant、reasoning 和其余工具交换都不可见。原始字节不改。
    - 理由：前任的话混进后任会让模型把别人的半截工作当成自己的承诺。触发接力的 review 回合是交接本身，后任要看见自己从哪里接手。用户的话不是前任的话：切掉它，后任就不知道要做什么，只能凭空推进（ses.txt：根消息「实施 @指南.txt」被切，后任空推到完成）。
2. [使用者] 宿主不得编造身份。
    - 理由：没有稳定宿主 id 的语义交换无法被定位到任期；猜一个游标或整体保留/丢弃都会悄悄改变模型看到的历史。
3. [使用者] 发给模型的投影不能取决于功能注册的先后。
    - 理由：注册顺序是实现细节；同一组意图换个顺序得到不同请求，前缀缓存与可复现性都会失效，冲突也会被静默吞掉。

4. [使用者] 已被 Relayed 退休的 attempt 不能再借一次请求继续说话；后任的请求不能被误杀。
    - 理由：退休后宿主仍可能重放旧 attempt 的消息集，放行会让旧 attempt 越过交接继续行动；反过来把后任的请求当成旧 attempt 清空，会让交接后的工作凭空停住。

5. [使用者] 实际发出的内容要能逐字节复核；跨会话比较不得被每次都不同的机器 id 污染。
    - 理由：封印与前缀缓存只认真实字节；夹具与截止证明需要去掉 callId 后仍稳定的语义字节。一份对象兼作两用，就会长出各自的私有规范化。

# LEMMA

1. [AXIOM 1] 切点是触发调用与其对应结果中较晚的一条，按 toolCallId 与 resultFor 定位。切点及之前除用户消息与触发调用、触发结果外的下标都不进入后任。找不到调用或结果时结果为空。
2. [AXIOM 1] role 为 user（不区分大小写）且不是合成行的消息，不论在切点前后、属于哪个任期、有无归属，都进入后任，原序保留；触发调用与触发结果（不是合成行时）也进入后任。其余消息在切点之后只保留 tenureId 等于后任且不是合成行的。宿主 id、游标都不能单独放行。无法归属的非用户消息不进入后任。
3. [AXIOM 2] 游标只能属于有宿主 id 的消息。缺字段、空身份、稀疏数组和 accessor 整次拒绝，不编造归属。
4. 输入先完整校验（数组快照、拒绝稀疏数组与 accessor、游标为非负 bigint）；回答冻结。
5. [AXIOM 3] 同批出现不同替换基底，或同一插入 key 的 anchor/行数/行指纹不同，显式冲突（基底冲突优先，行冲突报最小 key）；同值重复幂等，以首次出现为代表。
6. [AXIOM 3] 锚点指向（替换后或原始）基底的下标，插在该行之前；同一锚点按 key 序紧邻；append 在全部锚定行之后按 key 序；锚点超出基底长度整次拒绝。

7. [AXIOM 4, 2] 只有 Relayed 且带投影切点的退休才可能过时。切点 = 第一条带切点工具 call/result 的消息；请求的物理消息 = 最后一条 user（不区分大小写）消息的宿主 id，没有 id 永远证明不了归属。归属后任当且仅当：物理消息在切点之后且是当前逻辑运行的根；或是该退休门控 nudge 的接纳物理消息；或在切点之后且请求已被接纳；或切点已不在线格式中且该消息的接纳证据之根等于当前根。否则过时。
8. [AXIOM 5] 规范字节手写固定：字段顺序 provider/model/variant/tools/system/messages，消息 role/parts，部件 kind 在先；缺省与 null 同为 `null`，空串照写；字符串只转义 `\\` `"` `\n` `\r` `\t`，其余字符（含其他控制字符与孤立代理）原样保留（历史封印格式，不改成标准 JSON 转义）。
9. [AXIOM 5, 2] `wire` 的 tool-call/tool-result 必须带 callId；`semantic` 的部件带 callId 即拒绝（不静默丢弃）。`wireMessage` 恰是 `wire` 中对应的消息元素。未知 kind、非字符串、稀疏与 accessor 一律拒绝。

# SPEC

1. [LEMMA 1, 2, 3] 屏障前的 assistant、reasoning 和其余工具交换都不可见，屏障前后的用户消息（含根消息与随附的指南内容）以及触发接力的 review 调用与结果都可见；切点取调用与结果的较晚者；后任、合成、其他任期、只有宿主 id、无法归属分别按规则留下或排除；缺一半屏障时为空。
    - 证明：`tests/001.test.mjs`。线格式、布局和 retired 仍由 `tests/003.test.mjs`、`004.test.mjs`、`005.test.mjs` 证明，不随任期切点改变。
2. [LEMMA 4] 非法输入逐一被拒且 accessor 不被读取；回答冻结。
    - 证明：`tests/002.test.mjs`。
3. [LEMMA 4, 5, 6] `layout` 与 `plan`（同一规划，plan 不校验锚点范围）：空意图、锚定与 append 次序、替换基底作锚点空间、幂等、各类冲突、200 次随机重排结果不变、越界与非法输入拒绝、回答冻结。
    - 证明：`tests/003.test.mjs`；与宿主原 `ProjectionPlanner`/`ProjectionRenderer` 的双算见宿主 CUT-17 证据。
4. [LEMMA 7, 4] `retired`：无退休不过时、切点仍在且无证据过时、切点前后的新根/已接纳、门控 nudge、切点消失后的接纳根、无 id 的 user、首个切点与大小写、非法输入与 accessor。
    - 证明：`tests/004.test.mjs`；与宿主原 `RelayNarrativeTransform.staleRetirement` 的双算见宿主 CUT-17 证据。
5. [LEMMA 8, 9, 4] `wire`/`wireMessage`/`semantic`：逐字节期望输出、五种转义与其余字符原样、缺省与 null 等价、wireMessage 与 wire 内元素相同、语义拒绝 callId、线格式要求 callId、非法输入与 accessor。
    - 证明：`tests/005.test.mjs`；与宿主原 `ProviderProjection.renderWire`/`renderSemantic` 的双算见宿主 CUT-17 证据。


# ToolResultBoundStore — 宿主自定义工具输出上限与 UTF-8 尾部截断

层：内核。npm 入口 `wanxiangli/projection`，导出类 `ToolResultBoundStore` 及全局单例 `toolResultBound`。独占持有宿主声明的输出上限可变状态（`hostMaxLines`、`hostMaxBytes`），并提供 UTF-8 标量安全、保持尾部的截断算法。

来源：宿主仓 `src/Wanxiangshu/Host/Contract/ToolResultBound.fs(.fsi)`。

## AXIOM

1. [截断方向] 宿主预检与兜底截断默认保留头部丢弃尾部；为防止宿主二次截断丢失决定性尾部信息，本库在宿主观察到输出之前先行执行尾部保留截断。
2. [预算精确性] 截断标记为固定常量 `"...head truncated (tail kept)...\n\n"`（34 字节，2 行）。内容预算精确等于宿主上限减去标记开销，截断后总行数与总字节数精确落在宿主上限之内，不留任何模糊冗余量。
3. [标量安全] UTF-8 反向截断必须按 Unicode 标量（包含高低代理对 4 字节）边界步进，严禁产生半个字符或孤立代理损坏。
4. [配置防御] 宿主动态声明的上限只有在为有限数值且严格大于标记自身开销（行数 > 2，字节数 > 34）时方可接纳，非法或过小值保持当前上限不变，防止破损配置放宽或破坏窗口。

## LEMMA

1. 默认上限：`DefaultHostMaxLines = 2000`，`DefaultHostMaxBytes = 51200`。
2. `setHostLimits(maxLines, maxBytes)`：当且仅当参数为有限数值且满足 `maxLines > 2`、`maxBytes > 34` 时更新对应上限，其余保持不变。
3. `fitsInWindow(text)`：文本总行数 <= hostMaxLines 且 UTF-8 字节数 <= hostMaxBytes 时为 true。
4. `bound(text)`：未超出上限时原样返回；超出上限时拼接 Marker 与安全截断的 tail，行数 <= hostMaxLines 且字节数 <= hostMaxBytes。
5. `clearHostLimitsForTests()`：将可变上限复位回默认值。
