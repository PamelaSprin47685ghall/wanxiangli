# pair-hint

层：独立的模型消息与 scope 协议内核，npm 入口 wanxiangli/pair-hint。不依赖宿主 SDK、Journal 或会话全局状态。

## AXIOM

1. [使用者] 只有显式 resetScope 调用能清理旧上下文；原始用户消息与 reset 调用及结果必须保留。模型自行决定经验与原文的交接。
2. [使用者] 用户消息注入与工具结果注入是两条独立、明确的 API；OMP role/content 和 OpenCode info/parts/state.output 的真实载体不能混淆。

## LEMMA

1. [AXIOM 1] 最新 reset 是唯一清理边界。之前的用户消息与 reset 对保留，之后完整保留；同批工具调用在 reset 的块位置切分。
2. [AXIOM 2] 用户消息和工具结果有两种独立的后缀写入位置，但只在模型即将收到的请求副本中呈现。真实工具返回值、用户原文与持久化历史保持原样；同一提示不重复添加。
3. [AXIOM 1, 2] 未初始化时非 reset 结果只带初始化提醒；初始化后带预算，预算为零时可另加不打断工作的弱 steer。

## SPEC

1. tests/001.test.mjs：OMP 边界、用户 steer、多次 reset、调用和结果关联。
2. tests/002.test.mjs：OpenCode info/parts/state.output、独立写入、去重。
3. tests/003.test.mjs：用户线和工具线分开、跨宿主不改写原始输入。
4. tests/004.test.mjs：独立会话对象接收 turn/prompt/reset 消息，预算与初始化状态只由该对象维护。
5. tests/005.test.mjs：持久化 Pair Hint 的用户载体与工具结果载体分别写入、剥离、去重；不原地改写 OpenCode envelope。

6. tests/006.test.mjs：来自不同宿主的同一份 HNI 中立消息视图，得到相同的 reset 保留计划、用户提醒与工具结果后缀位置；旧原始消息不进入 ScopeSession。

## 边界

ScopeSession 拥有 turnBudget 与当前 prompt 身份，组合者只提供 turn 开始、真实用户消息和 reset 已提交的事实；Journal/前缀世代与 Pair Hint 的宿主日志位置仍归各自的 owner。HNI 中立输入不包含宿主原始消息；物理载体的解码/回写只在宿主适配器执行，工具回调和历史数据不得承担注入职责。
