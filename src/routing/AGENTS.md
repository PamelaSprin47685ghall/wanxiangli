# routing

入口 `wanxiangli/routing` 帮系统把一次模型执行放到用户选择的容量里，并在该次执行结束后归还。模型已由宿主选择时，协调对象接受该目标；它不加载配置、不替用户换模型，也不恢复已经停用的调度器入口。

## 状态归属

`RoutingProtocol` 解释既有同步调度协议。route 只收到 role、running、previous 三个参数；重复占用保留为重复项，目标和输入数组以冻结副本交出。理论容量查询只收到 role，并必须返回布尔值。坏配置、Promise 或坏目标报错；null 表示当前没有可用目标。durable target 仍按最后一个冒号分隔 model 和 reasoning。

`ExecutionRouting` 持有执行与参与者合作的状态：当前物理执行、固定目标缓存、排队等待的结算、保留给续接的输入、延迟释放、provider step 的同请求 Promise，以及本实例的策略异常。它复用四个公开入口：`permit` 签发并识别许可，`admission-queue` 决定队列节点与次序，`borrowing` 持有 token、托管与 step 等待，`run-witness` 持有精确 run 观察。不复制这些对象的账本，也不跨工程编译它们的源码。

lease 直接使用许可对象的原引用。Queued 保留同一节点与 completion Promise；同一物理输入重试不新建节点或等待者。target 按字段值比较，不以引用相等代替原规则。调用方共享同一个协调实例，不能按插件各建一套进程容量。

## 调用与后果

- `acquire` 回答 Admitted、Queued、QueueFull、Cancelled 或 Superseded。Queued 立即交还节点，调用方需要等待时再等 completion。队列上限仍为 32；暂不可用的队首不阻止后面可用的请求。队满且新请求无法立即取得容量时，保留它原有的 active 执行。
- 同一物理输入沿用目标并核对 role、participant；预留被实际输入采用时只用原来的一枚 token。`commit` 后，`tryRead` 才能读到精确可执行许可；读取不升级预留、不产生新许可。
- `retainInput` 保留旧许可供后续输入使用。旧执行物理结束时可回答 HeldForInput；`continue` 转移同一份容量并重定向仍保留的输入。最后取消保留时才归还旧资源，不按整个会话清理较新的等待需求。
- `enterStep` 只对非空 requestKey 复用同一个 Promise；`endStep` 和 `suppressStep` 只清对应精确物理前缀的缓存。迟到的旧执行结束不能释放新一代资源。观察到 run 与该 run 的物理身份分别记录，不用会话当前输入猜测未知 run。
- 调度策略异常保留原异常对象，使已等待和以后的请求沿现有失败路径退出；不吞错后选默认模型。普通容量不足仍可以等待。实例已处于失败状态时，清理路径保持原有行为。

固定目标通过中立 `binding.applies/read/error` 提供：外层决定哪些角色受这份记录约束、怎样读取记录及怎样向宿主措辞。只有适用角色才冷读，已有缓存直接复用；非 null scheduler 才执行原固定目标强制规则。`dropSession` 只删固定目标缓存，不等于释放会话。宿主角色弃用校验、SDK model 形状、共享实例装配和恢复策略仍在外层。

`snapshot` 供现有诊断消费当前执行、token、托管和等待的只读视图；这里不增加维持正确性的扫描器。库源码只编译 routing；隔离构建通过四份公开依赖产物运行 `tests/execution.test.mjs`，实际 npm 安装消费在 `scripts/tests/package.test.mjs` 的 ExecutionRouting 项。实际运行结果写在当前工作包，不在说明里维护通过状态。
