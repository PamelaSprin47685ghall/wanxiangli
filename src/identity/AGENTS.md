# identity — 参与者身份与执行绑定

层：内核。独立 npm 入口 `wanxiangli/identity`。在总流程中，本模块负责参与者身份（name, role, persona）的规范解析、消息来源鉴别以及与物理执行绑定的解耦管理。

## 状态所有权
- **Identity** 独占拥有参与者身份目录、活跃角色白名单（六个）与身份继承规则。
- **ExecutionBinding** 拥有物理会话与模型目标的执行绑定状态。
- 无可变全局状态，属于无状态纯计算。

## AXIOM
1. [使用者] 稳定的参与者身份与动态的物理执行绑定是两件事；把换模型、换租约当成换人，或把身份变更伪装成重绑，都会把动作做到错误的当事人头上。
2. [使用者] 缺失或未知来源的入站请求必须被拒绝，不得静默归为人类。

## LEMMA
1. [AXIOM 1] 身份记录在构造点一次性核验；消费点整体重验，不绕过校验逻辑。
2. [AXIOM 1] 活跃角色词汇严格闭合为六个（orchestrator、manager、engineer、devops、plan、advisor）；规范名必须全小写无连字符。
3. [AXIOM 2] 消息来源只认四类：human-root、agent-owner-root、host-internal、continuation，其余一律拒绝为 `UnknownPromptOrigin`。
4. [AXIOM 1] 重绑物理目标（`rebindTarget`）仅修改 modelTarget 与 capacityFence，身份记录保持不可变。

## SPEC（调用方流程）

1. **参与者身份解析**：
   - 传入身份名称与角色。系统严格核对白名单并返回标准身份记录；非法格式或退役角色明确报错拒绝。
2. **来源分类判定**：
   - 传入请求上下文调用 `classifyOrigin`。kind 与所属字段对得上才归入四类之一；缺失、未知词汇或形状不对一律返回 `UnknownPromptOrigin`，绝不默认回退为人。
3. **物理执行重绑**：
   - 发生模型切换或重试时，调用 `rebindTarget` 更新底层目标，参与者的身份记录逐字段完整保留。
