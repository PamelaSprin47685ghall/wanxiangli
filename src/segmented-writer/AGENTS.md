# 分段 writer

本模块为一个 writer 定位追加目标、滚段并完成 append/fsync/close，服务于总流程的本地落盘。调用方提供完整文本与目录能力，继续负责事件编码、产品路径政策、锁和业务提交结算。库不认识事件或产品目录，也不自动重试未知追加。

构造先检查 cap，再检查 writerId，不调用 directory。CurrentFile 初始为 0000；filePath 每次重新调用目录能力。非空 append 在原取路径位置调用该能力，不把第一次路径永久缓存。空文本直接 no-append，不查询或创建目录。

缓存文件存在就继续用它，不无条件跳到目录最高段；缓存缺失才按公开 segments 规则重新选最高段，无段时选旧式文件或 0000。旧式文件原地续写，不在这里整理。非空段追加后会超 cap 才滚动，恰好上限不滚，空段接受超大 batch。9999 后拒绝；滚动已经改变 CurrentFile 时，后续失败不回滚。

目录准备、目标选择和滚段失败属于 before-append。appendFileSync 即使已经写下部分或全部字节后才抛错，也属于 after-append；open/fsync/close 失败同属该类，cause 保持原对象。fsync 失败仍尝试 close；双失败保留 fsync 为 primary、close 为有序 cleanupFailures。durable 只在追加、barrier 和 close 均完成时返回，不替代业务提交。

不提供全局排队、幂等或跨进程协调，不扫描读取历史内容，不接管保留、整理或导入。末项文件自身的符号链接沿用现行 fs 行为；目录允许范围仍由调用方能力负责。
