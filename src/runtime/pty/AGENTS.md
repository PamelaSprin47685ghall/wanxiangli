# pty — 真实伪终端会话

层：物理能力库。入口 `wanxiangli/pty`，对象 `Terminal`（只有静态 `Terminal.open`）。只使用 `node:fs`、`node:path` 与 `process.kill`；伪终端驱动（Bun 下为 bun-pty 的 `spawn`）由组合者注入，本库不在运行时依赖 bun-pty，也不导入进程、宿主、Work、Journal 或兄弟库。

## AXIOM
1. [使用者] 终端就是终端：程序看到的是 tty，不能用管道冒充；写入、读取、信号、尺寸都作用在同一个真实会话上。
   - 理由：交互程序在管道下行为不同（缓冲、提示、颜色、行编辑），冒充会让调用方基于假行为工作。
2. [使用者、开发者] 关闭一次会话后不留后代：整个进程组被回收，忽略 TERM 的程序会被升级到 KILL。
   - 理由：孤儿进程会持续占用端口、文件和 CPU，并在下一次运行中制造幽灵副作用。
3. [使用者] 每个动作如实报告结果：失败的动作、真实错误码；会话已退出时明确说 `Closed`，不假装写入成功。
   - 理由：bun-pty 在退出后写入不会报错，静默成功会让调用方以为输入已送达。

## LEMMA
1. [AXIOM 1, 3] `Terminal.open({ driver, command, cwd, cols, rows })` 先校验全部字段与 `cwd` 是存在的目录，再调用 `driver('sh', ['-lc', command], { name: 'xterm-256color', cols, rows, cwd })`。驱动抛错或返回的对象没有正整数 `pid` 与 `onData`/`onExit`，返回 `Failed{operation:'spawn'}`。
   - 推理：bun-pty 对不存在的 `cwd` 会在别处照常运行命令；先检查目录才能保证命令不在错误位置执行。
2. [AXIOM 1] `read(waitMs)` 取走已缓冲的全部输出；缓冲为空且会话仍开时挂起，第一个到达的字节立即应答，`waitMs` 只界定沉默终端的等待（应答 `""`）。同一时刻只允许一个挂起读，第二个返回 `Busy`。退出后读取返回剩余输出与 `closed: true`。
   - 推理："写入后读取"若立即回答空串就与 shell 回显竞速；以字节到达为准才确定。
3. [AXIOM 3] 退出后 `write`/`signal`/`resize` 返回 `Closed`；驱动抛错返回 `Failed`。`signal` 发往进程组（`-pid`），失败时退回单进程。
4. [AXIOM 2] `close(graceMs)`：向进程组发 TERM，最多等 `graceMs`；未退出则发 KILL，再最多等 `max(graceMs, 1000)`；确认退出后再向进程组补发一次 KILL，回收领头进程退出后残留的组员。仍未确认退出返回 `Unconfirmed{pid}`，不谎报。已退出时返回 `AlreadyExited` 并同样清扫进程组。
   - 推理：领头 shell 退出不代表组员退出；忽略 TERM 的后代只有组级 KILL 能回收。

## SPEC
1. [LEMMA 1] 非法选项在调用驱动前拒绝；`cwd` 缺失为 ENOENT、是文件为 ENOTDIR；驱动抛错或返回非终端为 spawn 失败；驱动收到 `sh -lc` 与声明尺寸。
   - 证明：`tests/001.test.mjs`（此处只用会抛错的驱动检验拒绝路径，不用假终端检验行为）。
2. [LEMMA 2, 3] 真实 bun-pty：`test -t 0` 为真；写入后读回回显与程序输出；UTF-8 完整；沉默终端按时应答空串、并发读为 `Busy`；挂起读被首字节唤醒；`resize` 后 `stty size` 为新尺寸；退出后各动作为 `Closed`；缺失 `cwd` 不会在别处运行。
   - 证明：`tests/002.test.mjs`，在 Bun 子进程中运行 `tests/scenario.mjs`。
3. [LEMMA 4] 忽略 TERM 的后代在 `close` 后不再存活；忽略 TERM 的领头进程被升级为 KILL；第二次 `close` 为 `AlreadyExited`；INT 送达前台程序后 `wait` 结算。
   - 证明：`tests/003.test.mjs`。

## 已知边界
- 只在 Linux x64 + Bun 1.x + bun-pty 0.4.10 实测；macOS/Windows 无证据，不作支持声明。
- bun-pty 不报告终止信号：`exit.signal` 恒为 `null`，被信号终止时 `exitCode` 为驱动给出的值（实测为 1）。
- 自行 `setsid` 脱离进程组的后代不在回收范围内。
- 输出按驱动给出的字符串累积，不做字节级外存；需要完整外存的调用方自行组合 `wanxiangli/spool`。
