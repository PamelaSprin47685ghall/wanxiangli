# assembly — 持久工作组合

公开对象 `DurableWork`，npm 入口 `wanxiangli/durable-work`。它是 C，不是把 Journal 再注入 Work 的外观。

## AXIOM
1. [使用者] 只有确认持久提交的决定可以触发真实效果；丢回执不能导致再次执行。
   - 理由：这决定恢复时是否会重复修改用户成果。
2. [开发者] 工作规则与存储可以分别改变，合作流程只有一个负责人。
   - 理由：修提交竞争不应重写 Plan/S4，修领域规则不应重写 SQLite。

## LEMMA
1. [AXIOM 1, 2; 根 LEMMA 4] C 读取 Journal 的记录，向 Work 提供数据并请求应用命令，再把 Work 产生的一笔记录追加到 Journal。C 不解析事件或复制领域分支。
   - 推理：工作合法性归 Work，修订互斥归 Journal；顺序与结果关联是第三项完整职责。
2. [AXIOM 1] 候选 Work 在事务内完成内存变化，但其 Applied 不能对外冒充 Committed。失败丢弃候选；Unknown 封存本组合，只能先观察提交。
   - 推理：候选独立维护自己的不变量，C 无须替它回滚字段；只有持久事实是重启后的依据。
3. [AXIOM 1, 2] 同步不等于不可重入。同一 C 的在途消息互斥，不把活动调用或未知状态做成全局单例。
   - 推理：原生驱动或测试故障回调仍可能重入；其他工作的组合不能因此被锁住。

## SPEC
1. [LEMMA 1, 2] 仅首次 Committed 返回新决定；重复追加读回精确记录并经 Work 重放，不第二次签发交付。冲突显式返回，不自动重试。
   - 证明：`tests/001.test.mjs` 的真实 SQLite 开立、恢复与两种协作方式；`tests/002.test.mjs` 的确定性交错提交，均已通过。
2. [LEMMA 2] 写前/写后异常、畸形回执或回放记录不匹配为 Unknown；不暴露候选状态、不允许盲重试。NotWritten 不改变持久状态。
   - 证明：`tests/002.test.mjs` 已通过；`scripts/tests/package.test.mjs` 的 Node/Bun 实际消费者在外部效果后 SIGKILL，恢复未重复执行。
3. [LEMMA 3] 同一组合重入拒绝，错误后释放活动标记；独立组合可争抢同一修订，也可各自服务不同工作。
   - 证明：`tests/002.test.mjs` 已通过。本 API 同步，不声称支持异步 Journal。

## 边界

- Work 的内存契约是 Applied，DurableWork 增加持久承诺，因此是新组合契约，不冒称透明、可选的持久化 decorator。
- 移除 C 与 SQLite 后，Work 的完整内存能力保留；持久能力不保留，也不再宣称存在。
- C 只拥有活动标记和未知提交身份，没有第二份业务账本。Journal 的生命周期由创建它的外层负责，便于多个工作共用一个日志对象。
- 不导入宿主 SDK，不运行 provider 或进程；更外层消费首次提交结果并观察真实外部效果。
