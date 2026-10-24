# provider-calibration — 实测 provider 校准

本包是进程内会话 provider 观测的唯一 owner。物理事件中提取数值留给宿主；库不认识 SDK、消息包络、Journal 或模型计费规则。

## AXIOM

1. [使用者] 报告给模型的缓存用量与上下文上限必须来自 provider 实际观测，不从 token 计数猜测。
2. [开发者] 两种观测由同一个会话状态 owner 保存；读值不能暴露内部可变别名。

## LEMMA

1. [AXIOM 1, 2] 每个 session 的最新用量与声明上限分别更新，未知项返回 null，不推断缺失项。
2. [AXIOM 2] session 退出同时清掉两种观测，避免复用时读到过期数据；进程退出可清空全部状态。
3. [AXIOM 1] 物理观测的来源由宿主判断，库只接收实际取得的观测值。

## SPEC

1. tests/001.test.mjs：独立更新、缺值、会话隔离、返回值无内部可变别名、单会话关闭与清空。
2. tests/002.test.mjs：确定性伪随机交错 12,000 次，与独立参考模型逐步对照，覆盖重复写入与删除。不冒称数学证明。
3. 宿主从真实 message.updated / chat.params 记录值，并删除两个旧字典 owner；回归核对 Pair Hint 输出。库单测不替代真实 provider canary。
