# scope-retention

独立 npm 入口：`wanxiangli/scope-retention`。管 Scope 注解生命周期与 keep 额度（retention），不知道具体 Host 消息格式。

**入口**：任意工具上的打平 `scope` 注解；**无独立 resetScope 工具**。`kind=resetScope` 开新额度；宿主档案重锚另走 `ScopeReset.commit` / OMP 等价路径。

## AXIOM

1. 每个工具调用带打平 `scope`：`kind` ∈ resetScope｜keepLast｜removeLast｜meToo。语义见共同法 «Scope»。
2. 仅 `keepLast` 扣 1；同拍一实注 + N−1 meToo，与到达先后无关：先到的 meToo 暂收（`provisional`，宿主扣住不执行），实注到达即定（回执 `decided` + `released`）；本拍工具调用到齐仍无实注（`settle`）＝整拍全 meToo，直接拒收，不扣不记账、不带到下一拍；额度 0 时非豁免工具必须 `scope.kind=resetScope`。
3. `removeLast` 记 `BeatRetracted`（出站投影用）；连续空转计数 ≥3 时 `advisorDue`。
4. 单次 `newScopeRetentionBudget` 硬顶 `MaxRetentionBudget`（48）。
5. 豁免工具：negotiate、askPreviousScope、askPrevious、deliver——keepLast／meToo 不扣额度、不占本拍实注、不受同拍顺序影响，额度为 0 也不强制 reset。

## SPEC

- `tests/001.test.mjs`：解析／校验、reset／keep／remove／meToo、meToo 顺序无关、整拍全 meToo 拒收（settle）、豁免中立、额度耗尽拒收、空转计数、journal 重放。
