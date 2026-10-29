# scope-retention

独立 npm 入口：`wanxiangli/scope-retention`。管 Scope 注解生命周期与 keep 额度（retention），不知道具体 Host 消息格式。

## AXIOM

1. 每个工具调用带打平 `scope`：`kind` ∈ resetScope｜keepLast｜removeLast｜meToo。语义见共同法 «Scope»。
2. 仅 `keepLast` 扣 1；同拍一实注 + N−1 meToo；额度 0 时非豁免工具必须 resetScope。
3. `removeLast` 记 `BeatRetracted`（出站投影用）；连续空转计数 ≥3 时 `advisorDue`。
4. 单次 `newScopeRetentionBudget` 硬顶 `MaxRetentionBudget`（48）。
5. 豁免工具：negotiate、askPreviousScope、askPrevious、deliver——不扣额度，额度为 0 也不强制 reset。

## SPEC

- `tests/001.test.mjs`：解析／校验、reset／keep／remove／meToo、额度耗尽拒收、空转计数、journal 重放。
