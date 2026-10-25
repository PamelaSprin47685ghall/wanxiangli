# pair-hint

层：独立的模型消息与 scope 协议内核，npm 入口 wanxiangli/pair-hint。不依赖宿主 SDK、Journal 或会话全局状态。

## AXIOM

1. [使用者] 只有显式 resetScope 调用能清理旧上下文；原始用户消息与 reset 调用及结果必须保留。模型自行决定经验与原文的交接。
2. [使用者] 用户消息注入与工具结果注入是两条独立、明确的 API；OMP role/content 和 OpenCode info/parts/state.output 的真实载体不能混淆。

## LEMMA

1. [AXIOM 1] 最新 reset 是唯一清理边界。之前的用户消息与 reset 对保留，之后完整保留；同批工具调用在 reset 的块位置切分。
2. [AXIOM 2] 用户消息和工具结果有两种独立的后缀写入位置，但只在模型即将收到的请求副本中呈现。真实工具返回值、用户原文与持久化历史保持原样；同一提示不重复添加。
3. [AXIOM 1, 2] 未初始化时非 reset 结果只带初始化提醒；初始化后带预算，预算为零时可另加不打断工作的弱 steer。
4. [AXIOM 1, 2] 已呈现的工具结果是同一 prefix epoch 内的历史字节，`ScopeSession` 按调用身份冻结首次提示尾巴；预算变动或新用户 steer 不回写旧结果，提交 reset 才清除本 epoch 的冻结记录。Side-request 不抢先冻结普通请求尚未呈现的结果。

## SPEC

1. tests/001.test.mjs：OMP 边界、用户 steer、多次 reset、调用和结果关联。
2. tests/002.test.mjs：OpenCode info/parts/state.output、独立写入、去重。
3. tests/003.test.mjs：用户线和工具线分开、跨宿主不改写原始输入。
4. tests/004.test.mjs：独立会话对象接收 turn/prompt/reset 消息，预算与初始化状态只由该对象维护。
5. tests/005.test.mjs：持久化 Pair Hint 的用户载体与工具结果载体分别写入、剥离、去重；不原地改写 OpenCode envelope。

6. tests/006.test.mjs：来自不同宿主的同一份 HNI 中立消息视图，得到相同的 reset 保留计划、用户提醒与工具结果后缀位置；旧原始消息不进入 ScopeSession。
7. tests/007.test.mjs：先构造预算递减与新 steer 造成历史尾巴改字节的红态，再证明首次呈现冻结、冷重锚允许重建、side-request 不抢先冻结。
8. tests/008.test.mjs：受委托方首次问答到达前只提醒 negotiate(questions)，首次真实回答 steer 后才激活 resetScope；随后可选协商不暂停重置。同一委托者绑定复用不强制重问，换委托者时旧回执失效；未 prepare 或尚未真实送达的回答不可解锁。
9. tests/009.test.mjs：动态初始化、首次协商、零预算弱提醒与协商回答经实见语言呈现；中文请求不混英语 `[System:]` 行为指令，非法语言不静默退回英文；同 epoch 的已呈现结果字节不因语言切换而漂移。宿主 HNI 在 cognitive-environment/018 验证真实语言权威。

## 协商补充公理（2026-10-24）

1. [使用者] 父→子、调用者→Advisor 只传当前任务指令；不复制历史背景。第一次澄清必须使用单参数 `negotiate(questions: string)`，一次可集中多个问题。工具调用仅返回已接纳异步传送，不等待真实回答。
2. [AXIOM] 已绑定接收方在首次协商答复真实成为 user steer 之前不激活 `resetScope`；此后协商可选、随时且绝不暂停正常重置。同一接收方/委托者重用不会重复要求首次协商，代际更换时废弃旧回执。
3. [AXIOM] `questions` 仅能路由给实际委托者，回答须与接收方、代际、回执身份匹配并经物理消息确认，才可 `completeNegotiationReply` / `confirmNegotiationSteer`。工具调用回执、空回答、旧委托、错误会话的回答不得解除初始约束。真正的 BTW 临时对话与 SDK 发消息、副作用工具拒绝属于宿主接缝，不进入中立库。

## 边界

ScopeSession 拥有 turnBudget 与当前 prompt 身份，组合者只提供 turn 开始、真实用户消息和 reset 已提交的事实；Journal/前缀世代与 Pair Hint 的宿主日志位置仍归各自的 owner。HNI 中立输入不包含宿主原始消息；物理载体的解码/回写只在宿主适配器执行，工具回调和历史数据不得承担注入职责。
