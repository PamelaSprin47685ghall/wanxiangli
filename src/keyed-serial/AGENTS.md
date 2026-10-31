# keyed-serial

`wanxiangli/keyed-serial` 的一个 `KeyedSerial` 实例拥有按 key 串行排队的私有尾表。`run(key, action)` 同步登记队尾，异步启动 action；同 key 按调用顺序执行，不同 key、不同实例互不阻塞。key 按原字符串使用，不归一化，不合并或去重工作。

队尾是独立、始终成功完成的放行信号，不是 action 的结果 Promise。成功、同步抛错或异步拒绝都会放行后继，本次结果与错误原身份返回；放行不等待前一调用者消费结果。完成时仅删除仍指向本次信号的尾项，不能删掉后继的尾项。

action 可以排同 key 的后继，但不能在自己结束前 await 该后继，否则自等待。模块不检测或绕开这种用法。一直未结清的工作继续阻塞同 key，其他 key 可正常推进。没有取消、重置、drain、超时、重试、计数或可变队列出口。

这是进程内调度，不是跨进程锁或持久恢复协议。捕获规则、会话身份、Journal、Trace 与错误转为领域结果仍归调用方。内部使用弱键关联实例私有尾表，不依赖任何兄弟模块或宿主 SDK。

自身行为见 `tests/001.test.mjs`，隔离构建沿用 `scripts/tests/build.test.mjs`，实际安装包消费者为 `scripts/tests/keyed-serial-package.test.mjs`。构建使用 `node scripts/build.mjs keyed-serial`。
