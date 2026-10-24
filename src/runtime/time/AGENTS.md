# time — 显式时间与因果等待（时基部分）

层：内核。入口 `wanxiangli/time`，导出对象 `Time`。承接主仓 `Foundation/Temporal`、`Process/{Deadline,DeadlineSurface,NodeTiming,VirtualTiming}` 的显式时间职责（CUT-21）。不依赖本仓任何其他模块。

## 草稿重判

- 原草稿"本包只定义契约；物理时钟在 host-omp"撤回，理由与 process 模块相同：把唯一物理封装推给宿主层，会使独立验证只能等待宿主实例。`nodeTimerPort` / `nodeClockPort` 是本库唯一封装 `setTimeout` / `clearTimeout` / 系统 `UtcNow` 的实例，作为物理适配器留在本模块。
- 原草稿 TODO"时钟与定时器的操作签名待定"已定：以主仓已测签名为准（`ITimerPort.Delay: milliseconds:int -> IDeadlineHandle`），不采用草稿的 `Now / StartDeadline` 形态。契约变更需走主仓 WHAT 流程，不在抽取时顺手改。

## AXIOM

1. [使用者] 时间不是权威。业务只在显式拿到时钟时才读时间；到期只结束等待，不制造业务事实。
    - 理由：随时读全局时间，等于让"现在是几点"变成隐藏输入，同一份输入会得两个结果，事后无法复述决策。
2. [使用者] 时序证明不依赖物理墙钟等待。
    - 理由：靠真实等待的测试，结果随时序而变；边界时刻与取消顺序必须可重复。

## LEMMA

1. [本模块 AXIOM 1] 时钟与定时器都靠注入；除 `nodeClockPort` / `nodeTimerPort` 两个显式声明的物理例外，本库不读全局时间、不排全局定时器。
    - 推理：能随手读到的东西就一定会被随手读到，隐藏输入就是这么长出来的。
2. [本模块 AXIOM 1] 截止时间是"当前时刻 + 预算"算出的强类型值；剩余量、到期与下一段等待由纯计算结合注入时钟得出。计算不因溢出或时区表示改变结果。
    - 推理：散落的裸时间戳比较会让同一个预算在不同代码路径得到不同解释。
3. [本模块 AXIOM 2] 同样的注入可换成确定性虚拟实现；不推进则不触发，取消后推进也不触发。
    - 推理：虚拟时基的确定性是测试可信的前提。
4. [本模块 AXIOM 1] `IDeadlineHandle` 契约与 `wanxiangli/time` 的实现同构；消费方（如 wait 模块）按库仓惯例本地声明该结构化契约，不做源码跨工程引用，运行时由组合者注入本模块实例。
    - 推理：与 assembly 声明 Journal 契约同一先例；编译单元独立性优先，鸭子结构一致保证运行时互通。

## SPEC

1. [本模块 LEMMA 1, 2] 到期、剩余与下段等待由纯计算得出；极端预算钳制不溢出，`nextWaitMs` 封顶 `MaxTimerWaitMs`；负预算是已到期的截止时间。
    - 证明：`tests/002.test.mjs`（含 MaxValue 钳制、封顶、负预算、时区等价）。[TODO] 运行验证由 DevOps 执行。
2. [本模块 LEMMA 3] 虚拟定时器不推进不触发、差 1ms 不触发、按注册序触发、实例互相隔离、取消后推进不触发、Dispose 后不再触发。
    - 证明：`tests/001.test.mjs`（取消不偷其他 waiter）、`tests/003.test.mjs`、`tests/004.test.mjs`（虚拟时钟不受真实时间影响）。[TODO] 运行验证由 DevOps 执行。
3. [本模块 LEMMA 1] 发射产物零 ambient 墙钟读取；物理例外只有 `nodeClockPort`。
    - 证明：`tests/004.test.mjs` 的产物文本检查与行为断言。[TODO] 运行验证由 DevOps 执行。
4. [本模块 AXIOM 1] 到期只结算等待；`raceExit` 如实报告哪侧胜出，不发明退出事实。
    - 证明：`tests/006.test.mjs`；复合等待的完整反例在 `src/wait/tests/006.test.mjs`。[TODO] 运行验证由 DevOps 执行。
5. [总规则 SPEC 1] 本模块零兄弟依赖、零进程 spawn、零存储；单独携带本目录源码即可编译并跑本目录测试。
    - 证明：`tests/008.test.mjs` 的产物导入检查。[TODO] 隔离编译验证由 DevOps 执行。

## 边界

- **分居降级（明示范围缩减）**：主仓 time-capability-008 的物理/虚拟/契约 fsproj 级分居，在本仓单 bundle 形态下降级为导出面对分组——`nodeTimerPort` / `nodeClockPort` / `timerTask` / `raceExit` 为生产构造器，`virtualTimerPort` / `virtualClockPort` 标注验证专用（见 `index.d.ts`）。编译级分居由主仓切换时保留主仓分片结构承担。此项缩减已登记在主仓 `proposals/extraction-kanban/evidence/CUT-21/README.md`，升级方案（拆独立验证模块）需协调者另行授权。
- `SessionStartedAt` 单次采样与持久化属主仓会话层（CUT-21 卡 C 项）；本库只提供稳定时基（`tests/007.test.mjs` 覆盖纯时基语义）。
- 硬期限的执行语义（分段等待、超时强杀）归主仓进程面（CUT-02 已释放面）；本库只提供 `Deadline` 纯计算与 `MaxTimerWaitMs` 上界。
- `ITimerPort.Delay` 毫秒为 JS 安全整数域内非负值；非法预算的拒绝归调用方（进程面）所有，不在本层发明。
