# sandbox — 受限 JS 执行膜

层：内核。npm 入口 `wanxiangli/sandbox`，导出工厂 `Sandbox()`。不得 import 宿主 SDK；不持有跨调用状态；不读文件或环境变量。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-25.md`；现行需求 `requirements/repository-programming/WHAT.md` [006]。能力投影、基类生成、park/unpark 产品协议、JsFailure 解码留在宿主组合者。

# AXIOM

1. [使用者] 模型程序不得获得文件系统、网络、进程或环境变量。
    - 理由：repository-programming [006]；node:vm 文档明确不是安全机制，必须自行切断宿主 realm 可达路径。
2. [使用者] 执行有硬性超时；超时后终止并清理。
    - 理由：同 [006]；`runInContext` 的 timeout 只覆盖同步段，await 之后的死循环要靠 afterEvaluate 驱动排水。
3. [使用者] 执行有硬性**内存**上限；超出上限时执行以可区分的方式结束，且宿主进程存活。
    - 理由：同 [006] 要求「硬性超时、内存与输出上限」。`node:vm` 的 `resourceLimits` 在本机 Node 26.8.1 上会**打死宿主进程**（maxOldSpaceSize=64 → 分配循环到 ~4 GB → FATAL ERROR → exit 134），不可用作栅栏；`worker_threads` 的 `resourceLimits` 才会以 `ERR_WORKER_OUT_OF_MEMORY` 回报且宿主存活。内存上限必须是**执行契约**而不是调用方的善意。
4. [使用者] 执行在**独立执行上下文**中运行时，程序仍拿不到宿主进程、网络、文件系统与环境变量。
    - 理由：同 [006]；换一个隔离机制不构成放宽 AXIOM 1 的理由。若新边界能被绕过逃逸，它比没有边界更危险，因为它看起来是安全的。

# LEMMA

1. [AXIOM 1] 上下文用 `DONT_CONTEXTIFY` 创建；宿主对象不挂到全局；凡进入程序的宿主值（返回值、Error、Promise、函数、Callable 实例）都复制或包装成 sandbox-realm 值。
2. [AXIOM 1] membrane 与模型程序同 realm：membrane 用到的内建方法（WeakMap/Reflect/数组拷贝）在模型代码运行前捕获引用，经捕获的 Reflect.apply 调用；模型改写原型不影响 membrane。
3. [AXIOM 1] 期限检查用宿主时钟，不读可被程序改写的 sandbox `Date.now`。
4. [AXIOM 2] 宿主侧驱动循环在每次 `runInContext('void 0')` 上施加剩余 timeout，使 await 之后的同步死循环同样以超时结束。
5. [AXIOM 2] 驱动循环按唤醒推进，不空转：程序等待的宿主 Promise 用宿主 realm 的回调订阅（落在宿主微任务队列），结算或宿主回调进程序代码时唤醒驱动；两次唤醒之间睡到期限或慢轮询（unref 定时器）。空闲程序（park、等宿主 Promise）不占 CPU，也不单独让进程存活；期限过后在进程存活期间仍以超时结束。
6. [AXIOM 1] **程序侧与宿主侧共享可变对象的那条 park 协议整体留在库内。** park/unpark/abandon/deadline-reset 是**双方协议**而非单方取值：程序在 `await this.park(payload)` 处挂起并由宿主唤醒；`unpark(handle, value)` 把值送回**那个挂起的 await**；`abandon(handle)` 以**同一个稳定 sentinel** reject 展开程序栈，使原生 `try/finally` 跑完；`AbandonRequested` 期间拒绝新 park；`ParkStack` 标记挂起行；期限可重置且在**下一次 api 调用前**生效。
    - 推理：若协议拆到两个仓库，park 与期限的语义就会落在边界两侧，只有宿主侧能改动它；这与「个体拥有自身，组合者拥有协作」（根 LEMMA 4）相悖。因此库的隔离执行形态自带完整协议，宿主只在协议之后提供 api 的物理实现、错误映射与参数旁接。
7. [AXIOM 1, 3] 隔离形态下的 **api 是代理**，不是宿主闭包：程序侧的每次 api 成员调用经 RPC 交给宿主执行，结果回传；宿主闭包不可结构化克隆，故不得直接注入隔离上下文。
    - 推理：宿主 api 成员（`cat`/`write`/`rg`/`spawn`/durable append 等）是宿主侧 F# 闭包，做物理 I/O 与持久追加。跨线程传递函数不可行，只能以消息代替。
8. [AXIOM 3, 4] 隔离形态下的**期限判定权在宿主**：worker 询问宿主「是否已过期」，宿主用自己的时钟回答；worker 不以自己的 `Date.now()` 判定超时。期限值由宿主持有且可变。
    - 推理：AXIOM 2 的期限检查必须用宿主时钟（LEMMA 3）；worker 的时钟是另一台机器的时钟，而期限还须可重置（LEMMA 6）。让 worker 自行判定会同时丢掉这两条。
9. [AXIOM 2, 3] **超时与内存耗尽是两个不同的结局**，不得互相冒充。
    - 理由：宿主要把两者映射到不同的失败码，混同会让一次 OOM 被读成一次超时，反之亦然。

# SPEC

1. [LEMMA 1] 下列逃逸在 membrane 下均拿不到宿主 `process`，且不能在 workspace 外写文件；在 naive 实现上会成功（base-red）。
    - 全局 `api` / `__deadlineRef` / `globalThis.constructor` / `this.ls` 返回值的 `constructor.constructor`
    - 证明：`tests/001.test.mjs`
2. [LEMMA 4] 同步死循环与 await 之后的死循环都在 deadlineMs 量级内以超时结束。
    - 证明：`tests/002.test.mjs`（await 路径在子进程中跑，避免 node:test async_hooks 与 afterEvaluate 冲突）
3. 正常 api 往返仍返回 sandbox 数据（例如 `ls` 的 entries 数组）。
    - 证明：`tests/001.test.mjs` normal ls
4. [LEMMA 2] 模型改写 `WeakMap.prototype.has` / `.set` 不能观察到 membrane 传入的宿主值（0.23.1 上会泄漏宿主对象并拿到 `process`）。
    - 证明：`tests/003.test.mjs`
5. [LEMMA 5] 等一个不结算的宿主 Promise 的程序：1 s 内 CPU < 300 ms，进程 5 s 内自然退出（0.62.0 上空转到 60 s 期限）；迟到结算与宿主回调仍能推进程序；期限过后仍以超时结束。
    - 证明：`tests/004.test.mjs`
6. [AXIOM 3, LEMMA 7, 9] 隔离形态下，分配超过声明上限的程序以**内存耗尽**结束，**宿主进程存活**，且该结局与**超时**可区分。
    - 证明：`tests/005.test.mjs`（base-red：naive 形态无内存围栏时该程序不会以内存耗尽结束）
    - 变异：把上限调大或去掉后本条必须变红；上限可被静默击败比没有上限更糟。
7. [AXIOM 4, LEMMA 1] 隔离形态下程序仍拿不到宿主 `process`，也拿不到 `require`。
    - 证明：`tests/005.test.mjs`（与 `tests/001.test.mjs` 同族的逃逸断言在隔离形态下同样成立）
8. [LEMMA 6] 隔离形态下 park/unpark/abandon 三条通道的语义与**非隔离形态逐条相同**：`unpark` 的值送回那个挂起的 await；`abandon` 以**同一个稳定 sentinel** reject（不得变成超时）；`AbandonRequested` 期间拒绝新 park；挂起行仍被 `ParkStack` 标记。
    - 证明：`tests/006.test.mjs`
9. [LEMMA 8] 隔离形态下期限仍由宿主持有且可重置，重置在**下一次 api 调用前**生效；过期判定以宿主时钟为准。
    - 证明：`tests/006.test.mjs`

# 隔离形态的公开面（新增，不改动既有面）

既有 `run` / `runNaive` / `resetDeadline` 与 `SandboxRunHandle` 的形状与语义**不变**；`tests/001`–`004` 继续证明它们今天证明的事。隔离形态是**新增能力**，不是既有面的改写。

```
runIsolated(options: IsolatedRunOptions): IsolatedRunHandle

IsolatedRunOptions = {
  api: object,                  // 宿主 api 对象；库在隔离侧把它包成代理
  deadlineMs: number,
  deadlineEpochMs: number,
  baseClassSource: string,
  modelSource: string,
  memoryLimitBytes: number,    // 必填、正数。上限是契约，不是默认值。
}

IsolatedRunHandle = {
  programPromise: Promise<string>,   // 与 run() 同形：wrapper JSON 串（含 sentinel）
  deadlineRef: { current: number },  // resetDeadline() 对它仍然有效
}
```

`memoryLimitBytes` **缺失或非正数即拒绝**（启动前），不由库内部默认一个值——上限必须是**契约**，否则「这次运行有 N 字节上限」这句话就不成立，库侧 oracle 也无从判定。

**实现约束**（对实现者，非对调用方）：

1. worker 内建 vm context，**复用**既有 `INSTALL` 源与 `__makeRunner`，`DONT_CONTEXTIFY` 保持。不建第二套 membrane，不建第二套逃逸防护。
2. 程序侧拿到的是 api 的**代理**：成员调用 → RPC → 宿主 → 结果回传（LEMMA 7）。
3. 期限判定在宿主侧（LEMMA 8）；worker 询问，宿主用**自己的时钟**回答。
4. 内存上限由 worker 的 `resourceLimits` 承担；耗尽时以 worker 自身的错误身份回报，与超时可区分（LEMMA 9）。
5. 隔离形态下 `require` / `process` 仍不可达（AXIOM 4）。
6. 嵌套隔离（宿主 api 内部再起一次隔离）须防死锁与资源上限叠加；本轮不承诺支持，行为须显式而非静默。

**发版与消费**：库先发版（新 version + `dist/` 产物 + `src/*.d.ts`），主仓 `package.json` 以 `"wanxiangli": "file:wanxiangli"` 消费该版本，**再由主仓提交 gitlink**；主仓 gitlink 不得指向未发布提交。
