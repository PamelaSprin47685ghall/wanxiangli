# advisor

层：纯规则 + 进程内账本。顾问咨询（vibe-fs `requirements/advisor`）的材料身份、follow-up 增量、已交付账本、专席单飞注册表与已结算运行账本的唯一 owner；不得 import 宿主 SDK，不生成 view、不渲染 TOML、不读语言资源、不物理建立或派发顾问 child。npm 入口 `wanxiangli/advisor`。

承接主仓 `Execution/Delegation/Advisor/{View,Cursor,Seat}` 中的纯状态部分（CUT-39）。宿主先按 carry 数组解析可见历史和字面值；本模块管理材料身份与交付增量，并由 `AdvisorSeatRegistry` 自治拥有调用方专席单飞任务与失败锁存、由 `SettledRunLedger` 拥有运行标识与席位绑定的单调账本并判定陈旧运行。TOML 渲染、物理会话创建与从 Host 消息树提取 `ProviderRunIdentity` 仍归主仓组合者。

# AXIOM

1. [使用者] 顾问只被交底一次：已经交给它的材料不重发，变化了的精确文本仍要看见；一次 carry 内显式重复的条目按顺序保留（advisor-003）。
    - 理由：重发让每次追问按完整上下文计价并混淆旧判断；按编号去重会吞掉新摘要。
2. [使用者] 只有成功的咨询才算交底；失败或未确认不消费增量（advisor-003）。
3. [使用者] 顾问的回答是它真的说出的散文；没有就是拒绝，不伪造建议（advisor-004）。
4. [专席] 专席长寿命复用且单飞创建：同一调用方的并发咨询必须共享同一个单飞任务；创建失败后不得永久中毒，下一次咨询必须可重新尝试。
5. [围栏] 跨代际不误结算：已结算的运行记录在账，旧运行（sticky 重放或迟到终端）必定被拒，绝不能误结算后续新咨询。

# LEMMA

1. [AXIOM 1] `materialKey`：身份 = 来源 + 精确文本，以 `锚点或literal:UTF-16 长度:文本` 编码。历史锚点是非负整数；无锚点的字面值来源是 literal，两者身份互不混淆。空白和空串原样保留；非法值抛 malformed。
2. [AXIOM 1] `plan(delivered, material)`：输入是调用方已生成的完整 view；只过滤输出（不先剔除已交付锚点再生成）。delta 保持 view 顺序；`deliveredAnchors` 为整张 view 的去重锚点；`deliveredMaterial` 只是 delta 的身份；`hasNewMaterial` 当且仅当 delta 非空。
3. [AXIOM 1, 2] `ledger()` 返回的 `AdvisorLedger`：按调用 session 隔离、实例之间隔离；只有 `record` 推进且单调（并集）；空列表不建条目；`clear`/`clearAll` 是唯一的遗忘。
4. [AXIOM 3] `answer(messages)`：取最后一条角色为 assistant（大小写不敏感）且文本非空白的消息；否则 null。
5. [AXIOM 4] `AdvisorSeatRegistry`：以 `callerSessionId` 为键，并发 `ensureSeatChild` 只调用一次启动工厂；失败标记 `CreateFailed`，下一次调用前重置；`clear` 与 `clearAll` 幂等。
6. [AXIOM 5] `SettledRunLedger`：以 `childSessionId` 为键，单调记录最新结算运行；`isStale` 精确拦截与已结算运行相同的旧运行；`clearSession` 与 `clearAll` 幂等。

# SPEC

1. [LEMMA 1–6] 证明：`tests/001.test.mjs`（含跨代际防误结算、单飞创建防重、失败锁存与幂等清理反例）。

# 不做

- 不持久化：进程重启即丢弃账本与席位，生命周期为 process-live。
- 不做物理消息提取：宿主从 Host 消息树提取 `ProviderRunIdentity` 并与 `PromptKey` 校验；库侧拥有运行标识与席位绑定的单调账本（`SettledRunLedger`），并负责判定候选运行是否陈旧（`isStale`）。
