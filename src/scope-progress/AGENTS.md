# scope-progress

> **产品面退役说明（2026-10-30）**：自动顾问席与咨询队列已整体删除；宿主不再以计费估计、Stall／ResetDue 或 `advisorDue` 开席。Scope 生命周期以 `scope-retention` + 共同法 «Scope» 的 retention 为准。本包只保留宿主冷恢复所需的 Scope epoch 载体（`reset`／`ensureEpoch`／`status().epoch`／`recordedEpoch`／journal 绑定／`clear`），以及历史计费实现与测试供冷日志阅读；`tests/*.test.mjs` 是 **PACKAGE-HISTORICAL** 契约，不是宿主产品验收。新文案不得把估计字段、`AdvisorFlow`、`AdvisorProcessQueue` 或 advisor 准入事实写成现行入口。

独立 npm 入口：`wanxiangli/scope-progress`。本包不知道具体 Host、会话消息格式、Provider SDK、Journal 的物理格式与文件位置。

## 边界

- 现行产品路径只有 Scope epoch 载体；宿主不因 progress 健康度拒绝 Provider 回合。
- `record`／`settle`／`settlePending`、`estimate`、`resetDue`、`trigger: ResetDue|Stall`、`durableProgress*` 只供历史日志与历史测试阅读，无产品调用者。
- 顾问席相关实现（`AdvisorFlow`／`AdvisorProcessQueue`／`advisorClaim|Finish|Pending|StageBegin|StageConfirm` 及 `advisorDue` 触发）已删除，不得再作为现行入口或恢复目标。
- 包不物理删除历史计费 ABI；冷日志仍可引用。
