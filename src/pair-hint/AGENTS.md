# pair-hint

层：独立的模型消息与 scope 协议内核，npm 入口 wanxiangli/pair-hint。不依赖宿主 SDK、Journal 或会话全局状态。

## AXIOM

1. [使用者] 只有显式 resetScope 调用能清理旧上下文；真实 operator 输入与 reset 调用及结果必须保留。以 user role 运输的 `attribution: agent` 答复不等于真实操作员，旧 epoch 的代理答复属于可清理过程；模型自行决定经验与原文交接。
2. [使用者] 用户消息注入与工具结果注入是两条独立、明确的 API；OMP role/content 和 OpenCode info/parts/state.output 的真实载体不能混淆。

## LEMMA

1. [AXIOM 1] 最新 reset 是唯一清理边界。之前的用户消息与 reset 对保留，之后完整保留；同批工具调用在 reset 的块位置切分。
2. [AXIOM 2] 用户消息和工具结果有两种独立的后缀写入位置，但只在模型即将收到的请求副本中呈现。真实工具返回值、用户原文与持久化历史保持原样；同一提示不重复添加。
3. [AXIOM 1, 2] 预算与倒数提示已独立迁往 `wanxiangli/scope-progress`：有效 `todowrite` 的必填估计按真实 ProviderRun 聚合 `min`，没有报告的请求免费；估计 0 导致下一主回合由宿主发送单独强 `resetScope` steer。PairHint 只负责 `negotiate` 和第二次起 `askPreviousScope` 尚待首问时的独立强 steer；普通用户/代理消息不修改进度状态。工具结果不追加倒数。
4. [AXIOM 1, 2] 保留已观测 Provider 原文、工具调用和配对结果的真实字节，普通旧工具过程才按 reset barrier 移除；可获得的 assistant thinking/text 不能因为与旧普通工具同消息而丢失。Side-request 不修改真实工作 Session，也不污染最新主会话视图。

## SPEC

1. tests/001.test.mjs：OMP 边界、用户 steer、多次 reset、调用和结果关联。
2. tests/002.test.mjs：OpenCode info/parts/state.output、独立写入、去重。
3. tests/003.test.mjs：用户线和工具线分开、跨宿主不改写原始输入。
4. tests/004.test.mjs：独立会话对象接收 turn/prompt/reset 消息，预算与初始化状态只由该对象维护。
5. tests/005.test.mjs：持久化 Pair Hint 的用户载体与工具结果载体分别写入、剥离、去重；不原地改写 OpenCode envelope。

6. tests/006.test.mjs：来自不同宿主的同一份 HNI 中立消息视图，得到相同的 reset 保留计划、用户提醒与工具结果后缀位置；旧原始消息不进入 ScopeSession。
7. tests/007.test.mjs：先构造预算递减与新 steer 造成历史尾巴改字节的红态，再证明首次呈现冻结、冷重锚允许重建、side-request 不抢先冻结。
8. tests/008.test.mjs：受委托方首次 negotiate(questions) 受理前只提醒 negotiate；受理即完成，立即解除 pending、激活 resetScope，时序继续，不等也不依赖答复 steer；随后可选协商不暂停重置。同一委托者绑定复用不强制重问，换委托者时旧回执失效；答复回执仍须 prepare 且由正确接收方确认才结算，但结算与否不影响门禁。
9. tests/009.test.mjs：动态初始化、首次协商、零预算弱提醒与协商回答经实见语言呈现；中文请求不混英语 `[System:]` 行为指令，非法语言不静默退回英文；同 epoch 的已呈现结果字节不因语言切换而漂移。宿主 HNI 在 cognitive-environment/018 验证真实语言权威。
10. tests/010.test.mjs：negotiate 与 askPreviousScope 首问的相同时序冻结、相同解锁见证（首次有效调用受理即解除），首问后 budget 恢复和旧工具结果提示字节冻结。
11. tests/011.test.mjs：assume、negotiate、askPreviousScope/askPrevious、advisor 原始工具调用和成对结果历次 reset 保留；未配对伪结果与普通旧调用不得混进来。
12. tests/012.test.mjs：KPI 枚举乘法因子是单一自治预算计算函数，原始预算乘因子后向上取整，缺失未知枚举拒绝。
13. tests/013.test.mjs：`negotiate`、`askPreviousScope` 和 Advisor 工作者短命咨询共用唯一最近 transform 输入/输出视图，temp session 只保存来源和视角；旧我咨询只看最后一次 reset 以前的实际 input，不漏新 Scope；下一 transform 覆盖旧版本。receipt ID 同问题幂等，物理 steer 确认后仍保留原始询问身份，不重复付费。

14. tests/014.test.mjs：首次 reset 前每次请求独立 strong steer、绝不写用户/工具原文；首次 reset 后包括真人追加指令和任何 agent 载体消息都延续当前预算，不重新催 reset；旧 epoch 的 agent-attributed user 回复也不能伪装成永久保留的操作员消息；未完成首次 negotiate 与第二次起 askPreviousScope 义务只在强 steer 持续提示；冷历史虽含 reset 但本进程预算未恢复时必须像尚无预算那样持续强催真正重置，不能当已初始化并虚报 0。


15. tests/015.test.mjs：冷重启后的历史 `resetScope` 只证明旧事件存在，未确证当前预算时必须持续通过强 agent steer 催重新 `resetScope`；不得把内存默认 0 当作已耗尽预算、发弱提示或改写工具尾巴。真正重置获得预算后仍按实际回合递减，只有真实 0 触发弱提醒。

16. tests/016.test.mjs：可获得的 assistant thinking/text 穿越 reset；旧普通工具调用与返回配对裁剪，`assume/negotiate/askPreviousScope/askPrevious/advisor/resetScope` 关键工具调用与配对结果始终保留。独立 `OutboundViewStore` 负责真实 Provider archive/serialize/discardSealed 事实，**不**用已删除的 `startTemporaryFromFrozen` 在咨询期再次复制整段历史。

## 协商补充公理（2026-10-24）

1. [使用者] 父→子、调用者→Advisor 只传当前任务指令；不复制历史背景。第一次澄清必须使用单参数 `negotiate(questions: string)`，一次可集中多个问题。工具调用仅返回已接纳异步传送，不等待真实回答。
2. [AXIOM] 已绑定接收方在首次协商答复真实成为 user steer 之前不激活 `resetScope`；此后协商可选、随时且绝不暂停正常重置。同一接收方/委托者重用不会重复要求首次协商，代际更换时废弃旧回执。
3. [AXIOM] `questions` 仅能路由给实际委托者，回答须与接收方、代际、回执身份匹配并经物理消息确认，才可 `completeNegotiationReply` / `confirmNegotiationSteer`。工具调用回执、空回答、旧委托、错误会话的回答不得解除初始约束。真正的 BTW 临时对话与 SDK 发消息、副作用工具拒绝属于宿主接缝，不进入中立库。

## 边界

PairHint 的 ScopeSession 只拥有 negotiate/askPrevious 首问和上下文过滤。`ScopeProgress` 自治持有计费回合的 `min` 和 `ResetDue`。PairHint 中**每个真实工作 Session 仅一份覆写式 `latestViews`**（transform 原始 input / Provider-facing output + system/model 观察值）；临时咨询登记 Session 及投影身份，实际发网时从唯一视图读取。下一次 transform 覆写上一次；不为 temp session 复制完整请求。持久 Blob/AgentJournal 的事实归独立 owner，不能把临时内存当作持久历史。
