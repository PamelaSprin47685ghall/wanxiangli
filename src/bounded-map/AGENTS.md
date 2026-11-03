# bounded-map

公开入口 `wanxiangli/bounded-map` 的 `mapBounded` 负责一次有界异步映射。它在调用时快照输入数组成员，结果按输入顺序返回；每次调用有自己的许可和等待队列。限额必须是正的安全整数。不会深拷贝工作项对象，不拥有搜索、provider 或领域预算。

action 收到调用方给定的同一个原生 AbortSignal；省略时创建本次调用共用的未取消 signal。入队前检查取消，取得许可后在 action 前再检查。排队期间取消仍须等到许可；已运行 action 自行响应 signal。成功、同步抛错、异步拒绝和取得许可后的取消都归还许可。

首个拒绝按 Promise.all 语义提前返回，其他已启动和排队任务仍可能继续。返回错误不说明所有外部效果已经结束；本模块不重试、不自动取消兄弟任务，也不强杀外部进程。错误和取消 reason 保留原身份。空输入在限额校验后返回空数组，不运行 action。

自身行为见 `tests/001.test.mjs`；现有隔离构建夹具只带本模块源码，实际包消费者见 `scripts/tests/bounded-map-package.test.mjs`。构建用 `node scripts/build.mjs bounded-map`。
