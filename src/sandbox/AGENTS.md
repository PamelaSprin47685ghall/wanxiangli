# sandbox — 受限 JS 执行膜

层：内核。npm 入口 `wanxiangli/sandbox`，导出工厂 `Sandbox()`。不得 import 宿主 SDK；不持有跨调用状态；不读文件或环境变量。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-25.md`；现行需求 `requirements/repository-programming/WHAT.md` [006]。能力投影、基类生成、park/unpark 产品协议、JsFailure 解码留在宿主组合者。

# AXIOM

1. [使用者] 模型程序不得获得文件系统、网络、进程或环境变量。
    - 理由：repository-programming [006]；node:vm 文档明确不是安全机制，必须自行切断宿主 realm 可达路径。
2. [使用者] 执行有硬性超时；超时后终止并清理。
    - 理由：同 [006]；`runInContext` 的 timeout 只覆盖同步段，await 之后的死循环要靠 afterEvaluate 驱动排水。

# LEMMA

1. [AXIOM 1] 上下文用 `DONT_CONTEXTIFY` 创建；宿主对象不挂到全局；凡进入程序的宿主值（返回值、Error、Promise、函数、Callable 实例）都复制或包装成 sandbox-realm 值。
2. [AXIOM 1] membrane 与模型程序同 realm：membrane 用到的内建方法（WeakMap/Reflect/数组拷贝）在模型代码运行前捕获引用，经捕获的 Reflect.apply 调用；模型改写原型不影响 membrane。
3. [AXIOM 1] 期限检查用宿主时钟，不读可被程序改写的 sandbox `Date.now`。
4. [AXIOM 2] 宿主侧驱动循环在每次 `runInContext('void 0')` 上施加剩余 timeout，使 await 之后的同步死循环同样以超时结束。

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
