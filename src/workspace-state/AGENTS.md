# 工作区与状态目录

本模块帮助组装方找到共享工作区，再检查或初始化宿主选定的状态目录，让一次委托的读取与落盘回到同一位置。宿主提供 `.Herdchestra` 等产品布局；模块不猜旧数据位置、不迁数据、不打开日志。

`primaryDirectory` 与 `primaryDirectorySync` 对现存 workspace 使用规范路径并要求目录；若输入不存在，只接受现存直接父目录作查询 anchor，不继续向祖先猜。缺失输入必须经父目录成功查询 Git；父目录明确非 Git 也拒绝，不能据此另选状态位置。broken symlink 不当作缺失目录。Git 主、linked 与 nested 工作树返回主工作树；只有现存输入、明确的 128 退出及英文 not-a-git-repository 诊断才回退自身。bare、无法识别的输出和其他查询错误均失败，原生错误原对象传播。

查询私有使用 execFile／execFileSync，固定 argv、LC_ALL=C、GIT_OPTIONAL_LOCKS=0；不使用 shell、ProcessRunner、应用 spool 或通用执行端口。Git 输出仅交 `wanxiangli/git-porcelain` 的公开解析器。现存 workspace 的异步缓存仍由该入口现有 runtimePathStore 独占；失败 Promise 会驱逐。缺失输入重新查询父 Git，不读写这个缓存，避免复用目录尚存时的非 Git 回退。同步即时查询、不建第二缓存。成功缓存是进程内快照，拓扑改变后的刷新由已有缓存失效消息处理，不承诺同步与旧快照永远相同。

宿主将主目录与自身状态目录名组合后，调用 `checkStateDirectory`。它检查末项不是文件或符号链接，并检查实际父目录和目标不在 `.git` 中；缺失目标的直接父目录必须存在。查询和检查都不创建目录。

只有写入者调用 `initializeStateDirectory`：先检查，再创建目录和内容为 `*\n` 的普通 `.gitignore`。已有忽略文件须为普通文件且 trim 后为 `*`，不覆盖它；符号链接与其他内容失败。不编辑项目 Git 配置或 info/exclude。

workspace 与已有 stateRoot 是不同输入，不提供“先当 workspace、失败再当 stateRoot”的入口。定位失败不能转成别处的新状态目录，也不能据此合并已有数据。
