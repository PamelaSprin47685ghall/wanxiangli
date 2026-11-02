# 文件锁

本模块让组装方在改写共享文件前取得独占租约，工作结束后释放；它服务于总流程中的安全落盘，不认识日志提交、Git 分支或宿主。路径与父目录由调用方准备。

`acquire(path, wait)` 成功后返回只有 `release()` 的租约。锁目录、owner 文件、proper-lockfile 心跳归本模块；业务何时持锁、锁保护什么归调用方。固定使用 realpath=false、stale=5000 ms、update=1500 ms。

- Retry 把获取交给 proper-lockfile 4.1.2 的 retry 策略；所有获取错误都进入该策略，耗尽后保留它选出的原错误。
- Budget 每次尝试禁用内部重试，只重试 ELOCKED。延迟为 `min(150, round(30 * 1.1^step))` ms，step 在 0…9 循环。每次尝试前检查 Date.now 总预算；预算不取消已开始的获取或等待。耗尽抛出可由 `isAcquireTimeout` 识别的原生 Error，携带 path、attempts、waitedMs。其他错误原对象传播。
- 第一次 release 在等待底层删除前就置为已释放；并发或后续 release 立即完成，不等待首次清理，也不在首次失败后重试。首次失败仍报告给首次调用方；后续完成不表示故障已恢复。

owner.json 写入 PID 与时间；失活 PID 使观察到的 mtime 为零，EPERM 仍视为进程存在。活 PID 不强制保持新鲜，心跳过旧仍可能回收。owner 写入、读取或解析失败沿用文件时间判断。这不提供跨机器身份或 PID 防复用保证。proper-lockfile 的 compromised 行为仍为默认抛错。

fs 适配和底层释放函数不公开；不提供取消、恢复、同步锁或领域工作回调。运行依赖由 npm 安装，不依赖主程序碰巧提供的副本。
