# 第二刀：真实进程会话

`wanxiangli/process` 提供一个 `ProcessSession` 对象：启动一次真实命令，写入 stdin，观察两个输出流，等待直接子进程及管道结束，并向其 POSIX 进程组请求终止。F# 实现，独立 ESM；没有第一刀、SQLite、宿主 SDK 或旧仓依赖。

这是 pipe 进程能力，不是 PTY、沙箱或后台进程监管器。它不判断工作有没有通过评审、不存日志、不自动重试。Work 与它是独立参与者；需要协作时，由外侧决定先持久认领哪个操作、何时启动进程，以及如何把实际观察交给 Work。

## 最小用法

```js
import { ProcessSession } from 'wanxiangli/process'

const run = new ProcessSession({
  executable: process.execPath,
  args: ['-e', 'process.stdin.pipe(process.stdout)'],
  cwd: process.cwd(),
  env: {},
  tailBytes: 65536,
  maxWriteBytes: 262144,
})

try {
  const start = await run.started()
  if (start.kind === 'Failed') throw new Error(start.error.message)
  const sent = await run.write(new TextEncoder().encode('真正的子进程\n'))
  if (sent.kind !== 'Written') throw new Error('Input consumption is unknown')
  run.endInput()
  const end = await run.wait(5000)
  if (end.kind === 'TimedOut') throw new Error('The process has not finished')
  console.log(run.read('stdout', 0).text)
  console.log(end.state.exit)
} finally {
  // 调用方选择清理政策。发信号不是完成，仍须读取最终观察。
  run.signal('SIGKILL')
  const cleanup = await run.wait(5000)
  if (cleanup.kind !== 'Closed') throw new Error('Process or inherited pipes remain open')
}
```

Node 和 Bun 使用同一入口、同一实现，走各自的 `node:child_process` 兼容接口。构建仍用现有 npm Fable 工具链，不增加依赖或构建框架。实际验证的平台与运行时见 `施工顺序.md`。

## 输入必须明确

构造参数六项都必填，不隐式继承环境或工作目录。

| 字段 | 含义 |
|---|---|
| executable | 绝对可执行路径；没有隐式 PATH 搜索 |
| args | 原样传入的字符串数组，空字符串有效；不经过 shell 展开 |
| cwd | 绝对工作目录；不存在时报告实际启动错误 |
| env | 完整环境快照，不是合并到当前进程环境的增量 |
| tailBytes | 每路留存的字节数，0 至 16 MiB；两路合计至多两倍容量 |
| maxWriteBytes | 单次 stdin 上限，1 至 16 MiB；同一时刻最多一笔待完成写入 |

字段缺失、多余字段、访问器、数组空洞、NUL、非法 Unicode 和非法容量在启动前拒绝。需要 shell 时，显式给出 shell 的绝对路径和参数，不增加模糊的字符串命令入口。

容量限制是当前实现的资源边界，不是业务规模定律。留存上限不包括原生流的瞬时块、返回给调用方的副本或调用方自己保留的结果；同时创建多少进程与多少等待由外侧负责。

## 七个消息

| 消息 | 结果及边界 |
|---|---|
| started() | Started 携带 PID；Failed 携带真实启动错误。多次调用不再次启动 |
| inspect() | 当前观察的副本，绝不暴露 ChildProcess 或内部缓冲 |
| write(bytes) | 只收非共享 Uint8Array；Written 只说明管道写入回调成功，不说明子进程已消费或业务完成。错误返回 Unknown，不补写 |
| endInput() | 幂等请求 EOF；不能把尚未返回的写入当作已经成功 |
| read(channel, after) | stdout 或 stderr 自身的字节区间；读不会改变共享读位置 |
| signal(name) | SIGTERM、SIGKILL、SIGINT 或 SIGHUP；Requested 只说明已发出请求。观察到直接子进程退出后返回 NotRunning，不使用旧 PGID |
| wait(milliseconds) | 1 至 2³¹−1 的整数毫秒；Closed 或 TimedOut。超时不发信号、不取消其他等待、不重启进程 |

错误参数及当前不允许的写入同步抛错，在物理写入前拒绝。实际 stdin 错误属于消费结果未知，不能通过 catch 后重发来掩盖。

## 输出是原始字节，文本只是一个明确区间

每条管道持续排空，分别拥有固定容量环形缓冲。即使调用方从来不读，也不因保留全部历史耗尽内存或因无人读管道阻塞。超限只丢最早的字节；不会杀命令，也不把日志交给模型摘要。stdout 与 stderr 不合并为一个声称有真实全序的流。

`read(channel, after)` 返回：

```text
from、to       本次返回原始字节的半开区间 [from, to)
discarded      请求的 after 到实际 from 之间已无法返回的字节数
bytes          原始尾部副本；长度 = to - from
text           [textFrom, textTo) 的严格 UTF-8 解码，或 null
textFrom、textTo 文本对应的精确字节区间
```

按原始字节持续读取，用上一次的 `to` 作为下一次 `after`。按文本读取，用 `textTo` 作为下次游标，才能等齐尚未完整到达的字符。若发生截尾，先处理 `discarded`；不能把丢失区间当成已经读过的内容。

切口位于字符内部时，文本从下一个完整字符开始。进程未闭合时，末尾尚未齐的 UTF-8 字节暂不解码；闭合后仍不完整或区间内部存在非法编码时，`text` 为 null，而 `bytes` 保留原样。BOM、NUL、组合字符和形似指令的文本不被改写。文本区间不能代替原始字节范围，`null` 也不是空输出。

## 退出、信号与监管范围

观察阶段是 Starting → Running → Draining → Closed。启动失败直接闭合，并保留 failure；不伪造退出码零。Draining 表示直接子进程已经退出，但继承输出管道尚未全部关闭。退出信号和退出码是数据，不拼进 stdout。

信号发送至本次新建的 POSIX 进程组，而不是只发给主进程。子进程可能捕获或忽略 SIGTERM，所以 Requested 后仍应等待。直接子进程退出后，不再使用旧 PID/PGID 去猜测性清理；这时继承管道还可能由其他进程占用。

**Closed 不是“所有后代都已死”的证明。** 后代可以另建进程组、关闭继承管道后继续运行；调用方崩溃也可能留下后台工作。需要抵御这些情况时，应使用外部进程监管、容器或其他真实隔离机制，本库没有用重试、轮询次数或输出安静来冒充这份保证。

API 在 Linux/macOS 上使用 POSIX 操作；本轮只以 Linux 实测为证。Windows 在启动前拒绝，不假装已有进程树终止能力。PTY、完整磁盘 spool、跨进程恢复、资源总量调度和真实宿主能力仍不在本刀范围内。

## 验证与来源

```sh
npm run build -- process
node --test src/process/tests/*.test.mjs
npm test
```

单库测试运行真实命令、pipe 和孙进程，不注入假进程服务。独立构建移除第一刀的源码；安装包测试还删除 Work、Journal、DurableWork 的产物后再运行进程消费者。负向验证会观察真正的 spawn 入口，证明非法参数不会创建进程。

`src/process/AGENTS.md` 记录规则与证明。原草稿保留的行为是“真实退出、信号不等于完成、等待时限、字节尾部”；“物理实现只能在宿主”“先定义没有实例的契约”和预建全局 LargeGate 被明确撤回。本次没有读取或修改合作者正在精修的原仓，不宣称旧能力已全部替换。

原生事件语义核对来源：Node 官方 `https://nodejs.org/api/child_process.html` 的 spawn、exit、close、detached、kill；Bun 官方 `https://bun.sh/docs/runtime/nodejs-compat`。文档说明不能替代本库实际运行测试，也不能据此宣称未测试平台已支持。
