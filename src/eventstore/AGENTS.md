# eventstore — 原子追加日志

层：SQLite 运行时库，非宿主适配。npm 入口 `wanxiangli/eventstore`。不依赖 lifecycle，也不导入具体 SQLite 驱动。

## AXIOM
1. [使用者] 成功提交的事实在进程被杀后仍能读回，两个写入者不能各自赢得同一修订号。
   - 理由：工作唯一性和崩溃恢复都依赖这件事。
2. [开发者] 不为首个真实使用方自写数据库、文件锁、段滚动和修复器。
   - 理由：这些实现会重新制造本次要减少的维护负担。
3. [使用者] Node 与 Bun 使用同一份日志规则，不因运行时不同维护两套实现。
   - 理由：旧宿主可能运行在 Bun；Node 特有的驱动不能成为内核的隐含前提。

## LEMMA
1. [AXIOM 1, 2] SQLite 事务承载一整笔不透明 UTF-8 文本；同流按修订号递增，追加前比较期望修订号。
   - 推理：互斥与原子性归事务层，领域词表不进入存储。
2. [AXIOM 1] 同流同 requestId 只允许同 body；冲突零追加。未知提交必须保持 Unknown，不能包装成没写或成功。
   - 推理：调用者只有知道提交边界，才不会把未知变成重复外部效果。
3. [AXIOM 1] 历史只追加，读回检验连续性及内容摘要。没有可变业务快照、自动修复或日志翻译。
   - 推理：派生快照不能成为第二事实源。
4. [AXIOM 2, 3] 组装方显式创建原生 SQLite 连接，日志只用 exec、prepare、close；不探测宿主，不复制 SQL 规则。
   - 推理：两种真实驱动具有这组共同操作；差异只留在具体连接的构造处。

## SPEC
1. [LEMMA 1] `BEGIN IMMEDIATE` 内比较修订号并插入；`COMMIT` 成功才返回 Committed。WAL、synchronous=FULL、busy_timeout=0；竞争失败显式返回，不隐式等待重试。
   - 证明：`tests/001.test.mjs`，真实双进程争抢同一修订号，以及 production append 在 COMMIT 前和确认后两处 SIGKILL。相同请求再次提交返回 Replayed，不重新签发首次提交结果。
2. [LEMMA 2] 提交前事务失败并成功回滚为 NotWritten；COMMIT 调用后报错为 Unknown，并封存该连接，要求重开。
   - 证明：`tests/003.test.mjs` 对实际 SQLite 方法注入 INSERT 后故障及 COMMIT 前/后丢回执，核对回滚、连接封存与重开结果。没有证明断电或磁盘控制器行为。
3. [LEMMA 3] requestId 冲突、修订号缺口、摘要损坏拒绝；schema 禁止普通 UPDATE/DELETE。读操作不追加业务事实。
   - 证明：`tests/002.test.mjs` 主动篡改、删掉中间修订、非法输入；`001` 核对含 BOM、NUL、组合字符的 UTF-8 BLOB 字节。
4. [LEMMA 4] 同一 npm 产物接受 Node DatabaseSync 与 Bun Database，两者运行相同的工作交付、外部效果、强杀和恢复场景。
   - 证明：`scripts/tests/package.test.mjs` 的 node / bun 实际消费者。当前实测 Node 25.9.0、Bun 1.3.14；不能据此声称完整宿主支持。
5. [LEMMA 1, 4; 根 LEMMA 3] 连接与活动标记留在对象闭包中；同一 Journal 的同步重入拒绝，不能在提交过程中读取候选行或关闭连接。
   - 证明：`tests/004.test.mjs` 已验证生成物无内部字段、原生 COMMIT 回调中的 read/append/close 均被拒绝；正常提交和下一次操作仍成立。

## 边界

- 连接由组装提供：Node 的 `node:sqlite` 或 Bun 的 `bun:sqlite`。没有原生 npm 扩展编译或自动探测回退。日志负责关闭传入连接，不与其他写入对象共享该连接。
- 本地磁盘、单数据库；不是远程 Git 同步或多机共识。不能把旧主机的文件复制过程当作在线合并。
- 同步 API 诚实保留同步性；本库用于小型工作事实，不用于 provider token 流。大流量需求出现后再测量并隔离工作线程。
- 原草稿的自建 NDJSON 段、载荷外置、多流归并与保留策略撤回，不作为实现义务。SQLite 数据格式与旧日志不同，切换必须以新工作为边界。
