# warm-start

层：纯规则。仓库 warm-start 的关键词、命中选择、合并去重与整条预算的唯一 owner；不得 import 宿主 SDK，不调用搜索、不渲染提示、不读语言资源。npm 入口 `wanxiangli/warm-start`。

# AXIOM

1. [使用者] 只有显式关键词行驱动搜索；没有关键词就零工作，提示与原文逐字节相同（repository-investigation-007）。
    - 理由：自动抽词或空关键词搜索会把低信任片段塞给不需要的调用。
2. [使用者] 结果有界、确定性排序、超限只删完整条目（repository-investigation-009）。
    - 理由：半条片段会冒充证据；顺序漂移使同一调用两次得到不同提示。
3. [使用者] 片段只交给能直接接触仓库代码证据的角色（repository-investigation-008）。

# LEMMA

1. [AXIOM 1] `normalizeKeywords`：CRLF/CR → LF、逐行 trim、去空行、大小写敏感先到先得去重、至多 MaxKeywords；null/空白 → []。
2. [AXIOM 2] `rankHits`：每词至多 TopKPerKeyword，按搜索顺序名次 1..k。
3. [AXIOM 2] `select`：按关键词序（稳定）拼接，按 (filePath, startLine, endLine, content) 稳定去重，至多 MaxHintsTotal；omitted 计入所有未保留的原始命中。
4. [AXIOM 2] `fit`：从全部保留开始逐条删尾，直到调用方量得的字节 ≤ 预算；每删一条 omitted+1；零条仍超限返回 null（调用方回退）。
5. [AXIOM 3] `isDirectConsumer`：只有规范角色标签 `engineer`、`devops`（大小写敏感）。

# SPEC

1. [LEMMA 1–5] 证明：`tests/001.test.mjs`。
