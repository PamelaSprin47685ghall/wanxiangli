# advisor

层：纯规则 + 进程内账本。顾问咨询（vibe-fs `requirements/advisor`）的材料身份、follow-up 增量、已交付账本与散文读回的唯一 owner；不得 import 宿主 SDK，不生成 view、不渲染 TOML、不读语言资源、不建立或派发顾问 child。npm 入口 `wanxiangli/advisor`。

承接主仓 `Execution/Delegation/Advisor/{View,Cursor,Seat}` 与 `Repository/Programming/Js/Anchor/AnchorView.materialKey` 中的纯部分（CUT-39）。view 生成（锚点账本、reportMapping 投影）、TOML 渲染、专席 child、两条 prompt 的派发与终态围栏仍归主仓组合者。

# AXIOM

1. [使用者] 顾问只被交底一次：已经交给它的材料不重发，变化了的材料（同一锚点的新摘要、可反复替换的锚点 0）仍要看见（advisor-003）。
    - 理由：重发让每次追问按完整上下文计价并混淆旧判断；按编号去重会吞掉新摘要。
2. [使用者] 只有成功的咨询才算交底；失败或未确认不消费增量（advisor-003）。
3. [使用者] 顾问的回答是它真的说出的散文；没有就是拒绝，不伪造建议（advisor-004）。

# LEMMA

1. [AXIOM 1] `materialKey`：身份 = 代表锚点 + 精确文本，以 `锚点:UTF-16 长度:文本` 编码，任两对 (anchor, text) 不碰撞。锚点为非负整数，文本为字符串，否则抛 malformed。
2. [AXIOM 1] `plan(delivered, material)`：输入是调用方已生成的完整 view；只过滤输出（不先剔除已交付锚点再生成）。delta 保持 view 顺序；`deliveredAnchors` 为整张 view 的去重锚点；`deliveredMaterial` 只是 delta 的身份；`hasNewMaterial` 当且仅当 delta 非空。
3. [AXIOM 1, 2] `ledger()` 返回的 `AdvisorLedger`：按调用 session 隔离、实例之间隔离；只有 `record` 推进且单调（并集）；空列表不建条目；`clear`/`clearAll` 是唯一的遗忘。
4. [AXIOM 3] `answer(messages)`：取最后一条角色为 assistant（大小写不敏感）且文本非空白的消息；否则 null。

# SPEC

1. [LEMMA 1–4] 证明：`tests/001.test.mjs`（含反例与差分）。

# 不做

- 不持久化：进程重启即丢弃账本，与主仓专席同寿。
- 不判定终态围栏（哪个 Completed 回答本次咨询）：那依赖宿主 run 身份，归主仓 `AdvisorSeat`。
