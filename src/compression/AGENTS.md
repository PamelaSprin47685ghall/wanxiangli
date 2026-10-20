# compression — ANCHOR 视图覆盖定律

层：内核。npm 入口 `wanxiangli/compression`，导出工厂 `Compression()`。不得 import 任何宿主 SDK、Trace 或存储；不读文件或环境变量、不计量 token。覆盖定律四条消息无状态；`checkpoints()` 返回的检查点准入台账是唯一有状态对象，只记内存中的 call 准入，不写任何事实。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-16.md`（子范围①②）；现行需求 `requirements/context-compression/WHAT.md` [003][017][031][028]、`requirements/obligation-ledger/WHAT.md` [005]。锚点编号台账、声明的暂存与一次性消费、o200k 计量、摘要怎样写回宿主消息，都留在宿主组合者。

# AXIOM

1. [使用者] 历史越短越便宜，但删什么只能由模型显式声明决定，宿主不得替它压。
    - 理由：模型是唯一知道哪些上下文对任务重要的主体（context-compression [001][008]）。
2. [使用者] 摘要一旦提交就永久生效，重放必须得到同一个视图。
    - 理由：视图决定发给模型的字节；同样的历史给出不同视图，既破坏缓存也破坏审计。
3. [使用者] 一次成功的 view 调用恰好沉淀一个检查点；失败调用不沉淀，结局不明的写入不能重写。
    - 理由：检查点决定压缩窗口；重复或伪造的检查点会把未发生的压缩当成事实（obligation-ledger [005]）。

# LEMMA

1. [AXIOM 1] view 形状严格为 `{ prefixUntil, thenMap }`：`prefixUntil` 为非负整数；`thenMap` 键为规范非负整数字符串，值为 `null` 或非空白摘要。任一处非法整次拒绝，只报第一处原因，原因文字与宿主原实现逐字一致。
2. [AXIOM 1] 锚点 0 永远存活；被替换过的真实锚点退出存活集合，不复活。存活锚点把内容划分为区间：从自身到下一个存活锚点之前，最后一个区间到输入末尾。
3. [AXIOM 1, 2] 本轮声明只在本轮输入的存活分区上定位：编号小于 `prefixUntil` 或已不存活的锚点静默忽略，`null` 表示保留；替换的区间边界在替换当时拍下，后来新增的锚点不会落入旧替换。
4. [AXIOM 2] 投影按替换的因果先后折叠：一次替换覆盖它拍下的区间，连同区间内此前的摘要；锚点 0 的替换呈现为开头摘要。没有覆盖到任何行的替换不改变视图。
5. [AXIOM 3] 检查点准入按 `(session, callId)` 精确键（长度前缀，不会别名）：首个 completed 终态得到 `append`，同一调用写入未结局时的重复终态 `join` 同一写入；`committed` 后永远 `skip`；error 终态封住该调用；`WriterUnavailable`（未尝试）释放以便重试；`WriteUnknown`/`NoNewWriteReleaseFailed`/`FactRejected` 保持在途，后来者 join 同一失败，永不重写。

# SPEC

1. [LEMMA 1] `parseView` 接受合法声明并按锚点升序给出对；各类非法形状逐一报出第一处原因；从不抛出，accessor 字段被拒绝且不被读取。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2, 3, 4] `live`/`plan`/`project`：0 永存、受保护与已死锚点被忽略、先 6 后 5 时第二次覆盖第一次摘要、旧尾部替换不吞后来内容、同轮相邻摘要互不吞并、开头摘要覆盖到下一存活锚点、空覆盖不改变视图。
    - 证明：`tests/002.test.mjs`；与宿主原实现的双算见宿主 CUT-16 证据。
3. 输入先完整校验（数组快照、拒绝稀疏数组与 accessor）；回答冻结，调用方事后改动输入不影响已返回结果。
    - 证明：`tests/003.test.mjs`。
4. [LEMMA 5] `checkpoints()`：只追加一次、在途重复 join、提交后 skip、error 封口、键不别名、终局失败不重试而未尝试可重试、非法输入（含 accessor）被拒且不留痕、实例互不影响。
    - 证明：`tests/004.test.mjs`；宿主组合者只保留真正的 journal 写入与在途 Task 会合。

# 与旧草稿的关系

本目录此前只有占位草稿（字节上限切块、"用户原文不可覆盖"、todowrite 检查点窗口）。现行需求已废除 200 KiB 切块与独立 Y 轴（[003]），真实用户消息与 tool result 都是可编址锚点，只能被模型显式 view 声明替换（[017][031]）；宿主任何隐式改写仍被禁止。检查点窗口去重已由 `prefix`（LEMMA 5）承担，不在此重复。
