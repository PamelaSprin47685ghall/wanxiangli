# scope-progress

独立 npm 入口：`wanxiangli/scope-progress`。本包只管理 Scope 的计费回合和自动 Advisor 咨询状态，不知道具体 Host、会话消息格式、Provider SDK、Journal 的物理格式与文件位置。

## AXIOM

1. 工作模型在有效 `todowrite` 中报告当前 Scope 的剩余计费回合数。一个 Provider 回合只计一次，同一回合多个报告取最小值，没有有效报告则不计费。
2. 非递减报告与已报告零仍继续计费会请求顾问咨询；估计为零则保留 ResetDue 直到新的真实 Scope 开始。不分析模型动机，也不建立隐含缺报惩罚。
3. Advisor Process 是同一 Session 一次只运行一份的四段协作。工作者临时问询与持续顾问席位是不同的物理会话；库只要求明确的问答与投递端口。

## LEMMA

1. 每项报告绑定 `sessionId + scopeId + providerRunId + toolCallId`。同一 Provider 回合结算一次，同身份内容冲突明确拒绝；已完成的 Process 仍记得触发身份，不能再发一次外部模型请求。
2. Scope 标识仅随成功提交的 `ScopeReanchored` 改变；Provider Context compaction、工作任期变化及 agent-attributed steer 不能重置进度基线。
3. 一个正在运行的咨询最多合并一项等待咨询，所有触发身份保留；阶段顺序 A→B→C→D，不容许后阶段在前阶段失败后执行。
4. 四段问询在开始时固定宿主报告的语言，支持 `en`／`zh-CN`，不接受未知语言；模型看到的只是自然问题，不能看到内部进程、存储或临时对话身份。
5. 每次模型请求、steer 前均要验证源 Scope 仍然有效。回答时结果未知不得自动重发外部调用。

## SPEC

- `tests/001.test.mjs`：免费回合、多报告 `min`、重复身份、零估计、跨 Scope 结算。
- `tests/002.test.mjs`：顾问队列单飞、等待合并、完成后重复触发拒绝。
- `tests/003.test.mjs`：四段顺序、双语自然问询、非法语言拒绝、失败释放、晚到废弃。
- `tests/004.test.mjs`：真实 SQLite 原子受理与 Finished、跨进程 SIGKILL、同身份异载荷冲突、确定性 CAS 修订冲突重试、跨实例及独立 OS 进程全局单飞、终局 Unknown 阻止解锁、冷恢复 advisorPending 只读未决观察。
- `tests/005.test.mjs`：每个 A／B／C／D 与最终 Host steer 的 `StageBegan`／`StageAnswered` SQLite 原子预留、不同 prose 冲突、无答复 Unknown 不重发。 阶段预留同时持久绑定真实的 reportIds 列表，拒绝另一 Process 复用同一报告或以不同成员集合重放。
- `tests/006.test.mjs`：通过全新 AdvisorFlow + 新 SQLite 连接冷恢复已确认阶段，只调用尚未预留的问询；第二段未知、物理 steer 未知及发送后抛错不重发。 冷启动多份 Pending 无需新宿主回合依次完成；已被合并的多报告组只按 StageBegan(1) 实际持久成员恢复。
- `tests/007.test.mjs`：真实 SQLite `Recorded`／`Settled`、每个 Provider 回合最小值、重放、零预算 ResetDue、CAS 竞争和 Unknown 拒绝。
- `tests/008.test.mjs`：完整 ScopeProgress Actor 的 SQLite 工厂、初始 Scope 可信证据检查、丢内存恢复、真实 OS SIGKILL 与 AdvisorDue outbox。
- `requirements/advisor/tests/004.test.mjs`：经正式 npm 出口验证顾问四段协作。
- `requirements/host-boundary/tests/scope-hni-physical.test.mjs`：OpenCode 真实 Provider Hook 与临时工具执行门禁。

**持久边界**：`DurableAdmission.advisorClaim` 使用注入的 `wanxiangli/eventstore` 原子日志，在首次 `Committed` 之后才授权外部咨询；同一报告重放、冲突、Unknown、强杀后恢复均不再重复付费。OpenCode 以 `.Herdchestra/wanxiangshu/advisor-process.sqlite` 的真实 SQLite 保存咨询受理事实，完全独立于 Work 生命周期。

**持久终局与全局单飞**：已受理且未写入 Finished 的 Session/Scope 报告阻止其它进程启动第二个咨询；进程内合法等待项可以合并。`advisorFinish` 以真实 SQLite 原子追加，只有 Committed/Replayed 才释放内存队列。冲突与 Unknown 不释放。日志事件快照与提交期望修订号来自同一次读取；只有明确的 RevisionConflict 才重新读取并有界重试，提交 Unknown 不重试。Finished 写入抛错保留 active 围栏。Process ID 由 Session、Scope 与首次报告确定性 SHA-256 导出，跨进程重启不会重新从 advisor:1 编号。

**最终 steer 边界**：只有物理接纳成功的 Advisor 文本才能进入 Finished(Completed)；Host 返回结果未知、发送后抛错则当前 Process 保持未决，不以模型失败名义结算。

**有限冷恢复**：`advisorPending` 只读最早未决的真实报告；`AdvisorFlow.resume` 只认领同 Scope 同报告的 `Replayed` 身份。阶段已写 `StageAnswered` 则直接复用保存的 prose；已写 `StageBegan` 而答复未确认时，不再发对应 Provider 请求。OpenCode 在 `chat.params` 优先从 AgentJournal 的真实 `ScopeReanchored` 投影读取 Scope epoch（在其不可得时才沿用 ScopeProgress 已观察的 epoch），然后认领未决报告。即使内存余额全部丢失，只要持久 Scope 身份仍有效，就可以恢复咨询而不虚构估计；身份均不可得时不猜测。

**顺序恢复与失败归属**：仅在 Finished 已持久确认后，运行中 Flow 才会通过 Pending 的 durable replay 顺序认领下一条已受理报告；未确认的阶段不会跳过。外部端口返回 Ok=false 但未证明 ConfirmedFailure 时必须保持 Unknown；模型/供应商的异常不是后续付费咨询的解锁凭据。

**计费持久事实**：新 `DurableProgress` 以现有 `wanxiangli/eventstore` 的原子日志逐个确认 ProviderRunId/ToolCallId 及当回合 min，结算只写一次 `Settled`；ScopeProgress Actor 的 `configureJournal` 注入后所有 record/settle/pending/status 从日志读写，`recordedEpoch` 仅在真实凭证下承认初始 Scope 0。已结算但来不及触发 Advisor 的记录经 `durableProgressDue` 作为可重放 outbox 重新派发，由 AdvisorClaim 单飞去重。OpenCode 工厂已在 PluginHooks 接线；官方宿主 Fable 编译、OpenCode 真实 `advisor-014` 计费恢复及 `advisor-015` 双工作区进度隔离均已通过。SessionId 对应专用 SQLite factory；session.deleted 解除绑定。没有持久 workspace 时拒绝，不沿用其它插件的默认 factory。

**剩余界限**：StageBegan 仍是逻辑出站请求预留，不含 SDK ProviderRunId/供应商物理回执；结果 Unknown 的外部问询不能自动核实。OMP 尚无可信工具调用所属 ProviderRunId，因此其原生 `todowrite` 计费及自动 Advisor 接线仍未实现；未配置持久 Journal 的纯库实例仍按显式的内存模式工作。
