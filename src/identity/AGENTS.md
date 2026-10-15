# identity — 参与者身份与执行绑定

层：内核。npm 入口 `wanxiangli/identity`。对象 `Identity` 是身份目录、来源鉴别与绑定合同的无状态 owner。

## AXIOM

1. [使用者] 稳定的参与者身份与动态的物理执行绑定是两件事；把换模型、换租约当成换人，或把身份变更伪装成重绑，都会把动作做到错误的当事人头上。
   - 理由：身份决定"谁担责"，绑定决定"在哪跑"；二者混同后无法回答一次物理重试到底是谁的行为。
   - 来源：提取卡 `proposals/extraction-kanban/cards/CUT-07.md`（宿主仓）。
2. [使用者] 缺失或未知来源的入站请求必须被拒绝，不得静默归为人类（护栏 D-01）。
   - 理由：未知来源回退 human 会把机器行为记到用户账上，且事后不可纠正。

## LEMMA

1. [AXIOM 1] 身份证据（name、role、persona、catalogVersion、origin）在构造点一次证明；`ParticipantIdentityEvidence` 只能经 `resolveAtRoot`/`inheritFromOwner`/`rehydrate` 产生，plain 视图在消费点必须整体重验。
   - 推理：可绕过构造点的证据等于没有证据。
2. [AXIOM 1] 活跃角色词汇闭合（六个）：orchestrator、manager、engineer、devops、blogger、plan。历史角色（coder 等）只供历史事件解码，活跃解析一律拒绝；内部槽位（bookkeeper、predictor）显式映射，不冒充角色。
   - 推理：词汇开放会把已废弃的参与者悄悄复活。
3. [AXIOM 2] 来源鉴别只认四类已验证来源：human-root（必须携带 participant 证明）、agent-owner-root（必须携带 owner/child 的 logical run 与 child 参与者）、host-internal、continuation（闭合词汇）。其余一律 `UnknownPromptOrigin`。
   - 推理：拒绝分支必须闭合，否则"未知"会退化成"默认"。
4. [AXIOM 1] `ExecutionBinding` 持有 sessionId、physicalUserMessageId、role、evidence、modelTarget、capacityFence；`rebindTarget` 只改 modelTarget 与 capacityFence，evidence 逐字段保持原值，且重建时整体重验。
   - 推理：重绑是物理事实，身份是规范事实；两者字段不相交，才可各自演进。

## SPEC

1. [LEMMA 1, 2] 活跃解析接受且仅接受六个活跃角色；历史、内部槽位名、非字符串输入一律 None；历史解码接受 11 个角色。
   - 证明：`tests/001.test.mjs` 的活跃/历史/畸形三组反例与正例。
2. [LEMMA 1] 根选定产出规范证据投影；legacy、malformed、unknown 名分别给出对应错误，无回退；bookkeeper 的 role 投影为 null；rehydrate 对每个字段错配（RoleMismatch、PersonaMismatch、UnsupportedPersonaCatalogVersion、OriginMismatch、OwnerRequired、LegacyParticipantName、BlankParticipantName）逐一拒绝。
   - 证明：`tests/002.test.mjs` 的正控、round-trip 与逐字段反例。
3. [LEMMA 3] classifyOrigin 对 human-root 缺 participant、agent-owner-root 缺任一字段、未知 kind、未知 continuationKind、非 plain-object 输入一律 `UnknownPromptOrigin`；不存在任何产出 human 的回退分支。
   - 证明：`tests/003.test.mjs` 的四类正控与 D-01 无回退断言（失败结果不含 participant/origin 字段）。
4. [LEMMA 4] bindExecution 要求全部字段、活跃角色、证据与绑定角色一致；rebindTarget 只改物理目标，evidence 深比较不变；篡改证据的视图在重建时被拒。
   - 证明：`tests/004.test.mjs` 的字段缺失、RoleNotActive、RoleMismatch、重绑不变量与篡改反例。
5. [LEMMA 1] 继承身份沿用 owner 的 persona 与目录版本；无 owner 见证时 InheritedFromOwner 输入被拒（OwnerRequired）；owner 与输入的 persona 错配被拒。
   - 证明：`tests/005.test.mjs` 的继承正控、round-trip、OwnerRequired、persona 错配与来源/身份组合。

## 边界

- 本包不验证"owner 委派句柄是否存活"或"logical run 是否真实存在"：那是宿主组合层的事实。classifyOrigin 只做词汇与证明形状的 fail-closed 判定。
- `OwnerCatalogVersionMismatch` 在单版本目录（V1）下不可达，是目录演进时的防御分支；出现第二版本目录时须补对应测试。
- 宿主仓（wanxiangshu）调用方切换被 vendor tarball 0.5.2（无 identity 导出）阻塞，归 CUT-33 发布 0.6.0 后的集成队列处理。
- Process、Trace、Ownership 边界不在本包内。
