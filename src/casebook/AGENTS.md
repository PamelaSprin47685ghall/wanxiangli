# casebook — 案卷索引、暂存与授权管理

层：内核纯计算与进程内状态自治。独立 npm 入口 `wanxiangli/casebook`。在总流程中，本模块负责案卷索引的规范编码（Shelfmark）、LRU 淘汰法则、Bookkeeper 事务暂存状态机以及会话附着与提示词单次授权。

## 状态所有权
- **CasebookIndexLaw** 纯计算独占拥有 Shelfmark 散列计算与稳定排序规则。
- **BookkeeperStaging** 拥有进程内暂存事务槽状态。
- **BookkeeperLedger** 拥有会话附着映射与单次提示词授权记录。
- 纯同步内存对象，不读写磁盘与外部存储。

## AXIOM
1. [使用者] 模型在索引里看到的每个 shelfmark，原样回传给 fetch 时必须找回同一个 Case；索引只给模型 `{shelfmark, question}`，不泄漏会话身份。
2. [使用者] 暂存事务必须显式写入后方可提交；未写或异常必须明确拒绝并安全清理。

## LEMMA
1. [AXIOM 1] shelfmark 由公开标题与 8 位十六进制后缀拼接构成，对代理对安全截断，保证 UTF-8 往返一致。
2. [AXIOM 1] 条目按 shelfmark 稳定排序；容量超出时按 LRU 访问序淘汰最旧项。
3. [AXIOM 2] 暂存事务支持 beginTransaction、apply、take 与 abort；未写入的事务调用 take 明确报错拒绝。
4. [AXIOM 1] `BookkeeperLedger` 管理专用内部会话附着，提示词授权必须逐字节精确匹配且只能消费一次。

## SPEC（调用方流程）

1. **索引构建与检索**：
   - 传入案卷列表调用索引生成。系统计算稳定 Shelfmark 并保序输出供模型查阅；模型回传 Shelfmark 定位对应历史。
2. **案卷暂存事务流转**：
   - 整理案卷时开启暂存事务，写入增量补丁；完成后通过 `take` 提取提交内容并清空槽位；异常时通过 `abort` 幂等回滚。
3. **附着会话与提示词单次授权**：
   - 为 Bookkeeper 会话绑定事务上下文；派发提示词时逐字节比对授权文本，消费一次后即失效，解绑时彻底清空授权。
