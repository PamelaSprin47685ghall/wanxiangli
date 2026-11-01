# casebook

层：内核。同一入口保留索引纯规则，以及暂存事务、会话草稿、取用单飞、Bookkeeper 附着和结算冲突的独立对象。它们各自拥有状态，不合成一份共享账本。无 IO、不读存储、不读时钟、不写事件，不 import 宿主 SDK 或其它 wanxiangli 模块。npm 入口 `wanxiangli/casebook`。

`CasebookSettlementOwner` 拥有自己的 conflicts 字典，按 eventId 认领冲突。首次 StorageInvalid 通知并返回 LogScopeFailure；首次语义冲突通知并返回 CaseUnavailable，重复返回 CaseUnavailableKnown；Unscoped 不认领。通知异常被吞掉，不改变结果或已有认领；Redeliver 仅接受原 owner 已认领的同一对象引用。各实例互相隔离，不读取索引或基线。相关用例在 `tests/settlement.test.mjs`，与文件差异计算分开维护。

## 单次案例编辑

Bookkeeper 修改一对问答时，`BookkeeperStaging.edit` 为这次调用取得原始快照，返回独立的 `CasebookEdit`。它私有保存本次 question/answer 补丁与成功设置次数；模型读到的始终是开始时的快照。事务槽仍由 staging 拥有，ProgramSession 仍负责运行和结算。

编辑的 `api` 提供读取与两个 setter，`runtimeBaseClass` 提供原有锚点视图。每个字段只能成功设置一次；首次非法类型不消耗设置次数，重复调用先报重复错误。失败文案在失败发生时才向调用方索取。模型捕获错误后仍可继续程序，不额外把整次编辑标坏。

调用方只在程序成功且返回值解析成功后调用 `commit`。它把两项补丁一起应用到 txId 当前的事务槽；未改字段保留当前值，零 setter 仍标记 touched。原事务被同名重开时，旧编辑按原语义提交到新槽；重复 commit 不增加一次性限制。失败或未提交的调用不改事务；缺失槽继续返回原错误。编辑不启动程序、不读资源、不增加互斥锁或事务代际。

锚点仍按声明顺序在原文中向后定位，保留 RegExp、UTF-16 位置、偏移递归与裁剪、零宽匹配和原错误文字。本能力不承担文件系统锚点规则。接口以 `index.d.ts` 为准。

# AXIOM

1. [使用者] 模型在索引里看到的每个 shelfmark，原样回传给 fetch 时必须找回同一个 Case；索引只给模型 `{shelfmark, question}`，不泄漏会话身份。
    - 理由：knowledge-reuse-012。定位符失效，旧案就再也取不回；泄漏身份，低信任索引就带出了内部状态。

# LEMMA

1. [本模块 AXIOM 1] shelfmark = 公开标题 + ` · ` + 8 位十六进制判别后缀。标题取第一条非空行、去行首 `#-*` 与空白、折叠词间空白，超过 72 个码元截为 71 个加 `…`；截断不得落在代理对中间。
    - 推理：孤立代理不是良构字符串，任何 UTF-8 传输都会把它换成 U+FFFD，模型回传的 shelfmark 与索引里的不再相等。
2. [本模块 AXIOM 1] 判别后缀是主仓一直发出的那一个：sessionId 的 UTF-16 码元按低、高字节两次喂入 FNV-1a 式滚动散列，乘法用双精度且不截回 32 位（异或时才按 ToInt32 取模），结果取 32 位。逐位冻结，不“修正”为教科书 FNV-1a。
    - 推理：已发出的 shelfmark 留在模型的对话里；换散列就让它们全部失效。
3. [本模块 AXIOM 1] 公开条目按 shelfmark 码元序稳定排序；定位取同序中第一个同名者。条目对象只有 `shelfmark` 与 `question` 两个键。
4. [本模块 AXIOM 1] epoch 只在无上一快照、调用方标记失效、或公开条目逐项（含次序）变化时推进；内部 Case 次序或字段变化而公开条目不变时不推进。
5. [knowledge-reuse-008] LRU 淘汰：容量 ≤ 0 或未超容量不淘汰；否则按访问序升序淘汰最旧的 `count - capacity` 个，同序保留输入次序。
6. [knowledge-reuse-006] 暂存事务状态机：beginTransaction 同名覆盖并把 Touched 归 false；apply 对有效槽一律记为 touched（补丁全空也记，原值保留）；take 必须 touched，未写拒绝且不删除事务，成功取出即删除；abort 幂等，缺失事务也成功；缺失事务上的 snapshot/apply/take 报逐字 `todowrite-for-bookkeeper: no staged transaction`，未写的 take 报逐字 `the staged transaction was not written by this completion`，touched 对缺失为 false。所有操作同步完成，不承诺跨线程或跨进程共享。
    - 推理：LC-029——初始 Q/A 不能冒充本次交付，写入标志是交付与否的唯一凭据；两串错误文本是 provider 看到的话，改措辞即改协议。覆盖语义让 txId 重开无需先 abort，失败路径（拒绝、投递失败、身份校验失败）都以 abort 清槽而不留残桩。

# SPEC

1. [LEMMA 1, 2] 160 组冻结向量与主仓 base（master 1c43198b5 构建）逐字相等；代理对边界截断后为良构字符串且 UTF-8 往返不变。
    - 证明：`tests/012.test.mjs`。
2. [LEMMA 3] 条目无会话键、稳定排序、同名定位取第一个、找不到为 -1。
    - 证明：`tests/012.test.mjs`。
3. [LEMMA 4] 四种推进条件各自成立，内部次序变化不推进。
    - 证明：`tests/012.test.mjs`。
4. [LEMMA 5] 淘汰与参考实现在固定种子随机输入上逐项相等（number 与 bigint 访问序），边界容量不淘汰。
    - 证明：`tests/008.test.mjs`。
5. [LEMMA 6] 事务隔离、begin 覆盖归位未写、未写 take 拒绝且事务保留、全空 apply 记为写入、缺失事务逐字错误、成功 take 删除、abort 幂等。
    - 证明：`tests/006.test.mjs`。未验证：该测试尚未运行，待库构建后由 DevOps 执行回填。

7. [knowledge-reuse-010] 会话草稿状态机：setQ 末轮未答则原地覆写 Q，已答则追加新轮；setA 空草稿补空 Q 轮次，有轮次始终覆写末轮 A；tryTake 原子消费，取出即删，再次调用为 None，快照为只读原生数组；clear 幂等且按会话严格隔离；transcript 逐字格式化所有轮次且未答 A 为空串，无末尾换行符。所有操作同步完成，状态不随进程持久化。
    - 推理：KR-010——草稿是委托期间进程内的临时工作记录，只有终结结算时才一次性转录并归档；原生数组快照隔绝 Fable 链表内部表示泄露。

# SPEC (续)

6. [LEMMA 7] 草稿多会话隔离、Q 覆写与追加、A 覆写与空补、tryTake 原子消费、clear 幂等、transcript 逐字等边界反例全部成立。
    - 证明：`tests/010.test.mjs`。

7. [knowledge-reuse-008/011/012/013] 公开索引状态机：独占持有私有 frozen 快照与 dirty 失效标记。首次冻结即使空 cases 也生成 epoch = 0n、dirty = false；后续无变化且非 dirty 时不推进 epoch；invalidate 或内容/顺序变动推进 epoch；返回防御性深/浅拷贝隔离外部修改；locate 与 shelfmarkFor 保持确定性；独立实例与单例相互隔离。
    - 证明：`tests/014.test.mjs`.


8. [knowledge-reuse-006 / interaction-authority-018 / capability-enforcement-006] Bookkeeper 会话附着与提示词单次授权自治状态机 (BookkeeperLedger)：
    - 绑定附着：bind(sessionId, txId, ownerSessionId) 登记活附着 {txId, ownerSessionId, attachment: "bookkeeper:" + txId}。重复 bind 同一 sessionId 原子覆盖旧附着，并清空该会话原有的待办提示词授权（防跨事务代际泄露）；
    - 解绑撤销：unbind(sessionId) 幂等移除附着，并原子撤销该会话所有关联待办提示词授权（防解绑后幽灵授权残留）；
    - 状态查询：isAttached 判定附着有效性，作为能力准入的 owner-held attachment 事实依据；tryTxId/txIdFor 提供只读事务映射；getAttachment 提供防御性浅拷贝原生对象，严禁泄露内部可变别名；
    - 单次授权门禁：authorize 仅对当前处于附着状态的会话生效且强绑定当前 txId。tryConsume 严格要求当前会话存在未消费授权、所属附着仍存在且 txId 一致、传入的 explicitAgent 与 text 均严格逐字节精确匹配，三者满足时原子删除条目并返回 true；任何参数不匹配或未授权均返回 false 且绝不删除已有授权（防误消费与防篡改）；
    - 会话隔离：所有操作按 sessionId 隔离，互不影响；clear 排空所有会话绑定与授权。
    - 推理：Bookkeeper 是无公开权限的专用内部辅助会话，其工具准入完全取决于会话是否处于附着状态；提示词派发必须满足单次消费与参数逐字节一致门禁，解绑清空授权杜绝代际泄漏。

# SPEC (续2)

8. [LEMMA 8] 附着生命周期（bind/unbind/txIdFor/isAttached/getAttachment）、授权单次消费与精确匹配（agent/text 不匹配拒绝且保留）、解绑清空授权、重新绑定清空旧授权、未附着拒绝授权、多会话强隔离及单例独立性等边界反例全部成立。
    - 证明：tests/017.test.mjs。
