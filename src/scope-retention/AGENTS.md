# scope-retention

独立 npm 入口：`wanxiangli/scope-retention`。管 Scope 注解生命周期与 keep 额度（retention），不知道具体 Host 消息格式。

**入口**：任意工具上的打平 `scope` 注解；**无独立 resetScope 工具**。`kind=resetScope` 开新额度；宿主档案重锚另走 `ScopeReset.commit` / OMP 等价路径。

## AXIOM

1. 每个工具调用带打平 `scope`：`kind` ∈ resetScope｜keepLast｜removeLast｜meToo。语义见共同法 «Scope»。
2. 仅 `keepLast` 扣 1；同拍一实注 + N−1 meToo，同拍最多扣 1，与到达先后无关。实现约定（只为实现方便，不对 LLM 讲；对外仍是「不能全 meToo」）：本拍首个到达的 meToo 若早于任何实注，当场按一次 `keepLast` 记账（`KeepLast` 行带 `meToo: true`）并照常放行；之后同拍真 `keepLast` 到达不再扣；真 `removeLast`／`resetScope` 到达先撤销这次记账（`KeepLast` 行带 `undo: true`）再按自身语义定。整拍全 meToo 因此就是一次 keepLast。Scope 未开或额度 0 时这次记账不成立，先到的 meToo 按「不能全 meToo」拒收；额度 0 时非豁免工具必须 `scope.kind=resetScope`。
3. `removeLast` 记 `BeatRetracted`（出站投影用）；连续空转计数 ≥3 时 `advisorDue`。
4. 单次 `newScopeRetentionBudget` 硬顶 `MaxRetentionBudget`（48）。
5. 豁免工具：negotiate、askPreviousScope、askPrevious、deliver——keepLast／meToo 不扣额度、不占本拍实注、不受同拍顺序影响，额度为 0 也不强制 reset。

## SPEC

- `tests/001.test.mjs`：解析／校验、reset／keep／remove／meToo、meToo 顺序无关（先到 meToo + 后到 keepLast／removeLast 花费相同）、整拍全 meToo 记一次 keepLast、豁免中立、未开／耗尽时先到 meToo 拒收、空转计数、journal 重放。
