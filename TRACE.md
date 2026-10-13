# 第三刀：确认轨迹与固定取材边界

`wanxiangli/trace` 的 `Trace` 是一个独立内存对象。它保存已经确认的观察和原始字节，分配本地游标，冻结取材边界；没有磁盘、进程、Work、Journal 或宿主服务参数。

这一刀解决的是“当时究竟记录了什么、属于哪段观察”。不生成摘要，不压缩用户原文，不推断工具权限，也不是完整 LWR 或 provider 请求装配器。

## 最小用法

```js
import { Trace } from 'wanxiangli/trace'

const trace = new Trace('conversation-observer-1')
const beginning = trace.head()
const original = new TextEncoder().encode('用户原话\r\n🧭 e\u0301\u0000')

trace.capture({
  type: 'MessageObserved', messageId: 'message-1',
  role: 'user', origin: 'human', runId: null,
})
trace.capture({
  type: 'PartConfirmed', messageId: 'message-1', partId: 'text-1',
  index: 0, kind: 'text', bytes: original,
})
trace.capture({ type: 'MessageFinished', messageId: 'message-1', partCount: 1 })

const through = trace.head()
const window = trace.materialize(beginning, through)
const recoveredBytes = window.originals[0].parts[0].content.bytes
const restored = new Trace('conversation-observer-1', trace.records())
restored.read(beginning, through) // 同一条历史、同一段材料
```

`Trace` 返回封装状态的对象，不以可读写实例字段或继承工作。结果和字节都是分离视图；用户后续修改输入或结果不能改写对象内的原件。

## 捕获的六类事实

| type | 输入及含义 |
|---|---|
| Opening | bytes；可选开场，只能在第一条出现，同内容重放幂等 |
| RunStarted | runId；已经观察到该 provider 运行存在 |
| MessageObserved | messageId、role、origin、runId；冻结消息归属并分配首次观察游标 |
| PartConfirmed | messageId、partId、index、kind、bytes；该消息已确认的完整部件 |
| MessageFinished | messageId、partCount；该消息的部件已收齐 |
| RunFinished | runId、outcome；Completed、Failed 或 Cancelled 的实际终态 |

消息 role 为 user、system、assistant 或 tool。user 的 origin 为 human、plugin 或 host-internal；system 不接受 human；assistant/tool 的 origin 必须为 provider，并关联已开始的运行。没有根据正文猜来源的路径，也没有“没识别出来就当 human”的回退。

部件 kind 为 text、tool-call、tool-result 或 binary。tool-call 只能属于 assistant，tool-result 只能属于 tool。每条消息的 index 从零连续增长；不同消息可以交错捕获。partId 在消息内唯一；同身份对应不同内容、index 或 kind 时拒绝。

消息完成后不再接受新部件，运行结束前其所有已观察消息必须完成。已完成对象仍接受完全相同的历史观察重放，但不接受缺失的新事实。宿主必须先排好已确认事实的因果顺序，不能先终结、再靠轨迹库补写迟到材料。未知运行结果不是 RunFinished。

确认只是适配者通过这个协议报告的事实，库无法证明宿主没有说谎。流式临时快照、可覆盖候选和失败探针不属于捕获词表；原消息被用户编辑时须使用新的稳定观察身份，不能覆盖旧身份。

## 身份、游标与记录

`capture()` 返回 `{ status, cursor, record }`。Appended 表示首次在**内存**接受；Replayed 表示同身份、同内容已经接受，返回原游标和原记录。来源不同或任一字节不同不是重放。拒绝时不增加游标，也不留下部分状态。

每条记录是规范 JSON，字段只有 traceId、cursor、previous、observation、digest。二进制使用规范 base64；对象键排序，无额外空白或换行。digest 是前四个字段规范编码的 SHA-256；首条 previous 来自 `['trace-origin-v1', traceId]` 的 JSON 摘要，后续指向前一条摘要。

恢复验证编码、字段、身份、连续游标、摘要链和领域次序。重新计算了摘要的非法事件依旧拒绝；不跳过坏行、不自动修复。合法前缀是合法输入，单靠它无法判断尾部是否曾经更长。把先前保留的 `through` 带回 `read` 或 `materialize` 才能核对那段已知历史是否仍在。

摘要不是签名，cut 不是权限凭证。攻击者若重写全部记录并重算摘要，在没有外部可信边界时不能检出；本库不宣称具备这种认证能力，也不把分叉自动归并。

## 字节与文本

bytes 必须是普通 Uint8Array/Buffer 的非共享、非可调整大小视图。库读取原生视图信息并复制数据，不读取可被覆盖的 length、byteLength 或 buffer 字段。最大单部件 512 KiB，最大编码记录 1 MiB。零长度部件合法；大附件须由调用者明确分成多个有稳定身份的已确认部件。

BOM、NUL、CRLF、组合字符、任意非 UTF-8 字节均按原件保存，不做 Unicode 规范化。`content.bytes` 是原始字节副本，`content.text` 是严格 UTF-8 解码结果；无效时为 null，而不是插入替换字符。形似指令的文本仍是数据，不能改变来源、角色或终态。

总历史不静默淘汰，也不把容量不足当成丢弃原文的理由。内存随记录增长；materialize 的输出也随取材范围增长。当前版本没有磁盘流式索引、大附件仓库、压缩或保留策略。

## 同一边界，不同视图

`head()` 与 `cut(cursor)` 返回 `{ traceId, cursor, digest }`。零游标表示这条轨迹的起点。区间固定为 **(after, through]**，两端都检查轨迹身份、范围和前缀摘要。不同 trace、同名 trace 的不同分叉、反向及未来边界都拒绝。

`read(after, through)` 返回区间内每个原始观察，字节已解码为独立的 content；它不依赖其他库解释游标。

`materialize(after, through)` 返回：

| 字段 | 范围 |
|---|---|
| messages | 首次观察游标落在区间内的消息；部件和完成状态只读到 through |
| originals | 从轨迹起点到 through 的全部 human 消息及其已确认部件；不受 after 过滤 |
| opening | through 已包含的那份固定开场；可由表示层不渲染，但原件不删除 |
| statement | messages 中最后一条已完成、含 text 部件的助手消息；只连接 text 原始字节并列出 partIds，没有则 null |

前任消息后来才到的部件仍能在原始观察中找到，但不会把该消息搬进后任 messages。最后助手散文不掺 tool-call/tool-result，也不选尚未完成的助手消息；它是原件引用和字节连接，不是总结、证书或自动评审结果。

窗口不是可修改的权威状态。以后继续追加，再用同一对边界 materialize，结果保持相同；较新事实不会回流到旧窗口。

## 与持久化的真实组合

Trace 不知道 Journal。外侧 C 读取已提交记录建立候选，向候选发送观察，把返回 record 与期望修订号交给 Journal。只有 Committed 后才发布候选；Conflict、NotWritten、Unknown 都不当成 durable 成功，不自动重试。Unknown 时先封存/丢弃候选，再重开存储核对同一记录，不根据内存游标推断提交。

`scripts/tests/trace-consumer.mjs` 是这段显式合作的可运行消费者。安装包测试分别在 Node/Bun 上真实写 SQLite，保持连接打开后 SIGKILL，再从新进程按保留边界读回原字节；重放不重复写入。另删除所有前两刀产物与类型，验证 Trace 单独恢复和取材。

这里没有新增自动持久包装器，Appended 不等于 Committed。真实宿主的捕获/提交顺序、断电行为与多写入者观察合流不在本刀证明内。

## 验证

```sh
npm run build -- trace
node --test src/trace/tests/*.test.mjs
npm test
```

本库没有 npm 运行时依赖，不调用其他职责库。公开类型为 `src/trace/index.d.ts`，规则与证明在 `src/trace/AGENTS.md`；实际版本验收记在 `施工顺序.md`。本轮不读取或修改旧仓，不把当前新协议冒称旧事件格式兼容。
