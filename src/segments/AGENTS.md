# 分段日志

`wanxiangli/segments` 为总流程的本地记录提供分段格式、读取与物理写入。一个工程内保留三个对象：WriterSegments 只计算格式，SegmentedWriter 独占自己的追加目标，SegmentedReader 拥有读取缓存与读取期间的文件描述符。纯规则使用者无需构造 reader 或 writer；入口同时加载 Node 文件依赖，支持 Node/Bun。没有宿主 SDK、产品目录或共享全局写入状态。

## 格式与读取规则

WriterSegments 在调用方给出的名字和字节上计算，不读目录、不写文件、不加锁。逐行规范解码使用 `wanxiangli/events`；事件编码与整理的执行由调用方负责。

- 段名为 `<writerId>-dddd.ndjson`，段号只能是四位 ASCII 数字、范围 0..9999。越界或非整数拒绝，不能写出五位名字并把同一逻辑流拆开。
- 分组只把从 0000 连续的段系列归入前缀 writer；断续段按完整 stem 作为旧式 writer。旧式文件与段系列可以同组，由字节规则解释共存。
- 新 writerId 非空、不含路径分隔符，不是 `.`/`..`，也不以 `-dddd` 结尾。命名函数仍允许降级的旧式 stem 为自己命名新段，避免整理到一半才拒绝既有记录。
- 空文本是空流；非空流必须以 LF 结束，内行不为空，逐行解码遇首个错误即停。
- 旧式与段系列的字节前缀关系保留较长者；完整流且 ID 不相交时可以续接旧行。续接中断后仅接受逐字节相同的已复制前缀，并返回已复制行数；剩余 ID 不得与段流重复。异字节、半行、身份碰撞不被跳过。

这些纯规则既供读取/整理使用，也由物理 writer 在工程内部直接使用，不复制另一份命名算法。

## 物理读取

SegmentedReader 组合本工程的格式规则、`wanxiangli/events` 的严格解码与 `wanxiangli/retention` 的活动/整条保留规则。Writer 不依赖 Reader。调用方提供目录能力和截止时间，负责产品路径政策、锁、领域重放及结果转换；构造 Reader 不读目录。

读取先清理消失路径的缓存，再观察所有 writer 的活动时间，筛选保留的 writer，最后解码。过期 writer 不进入完整解码。返回按 writer 分组的库事件，不负责跨流历史判定，也不修复或删除文件。

缓存属于 Reader 实例，按完整路径索引；调用方需要进程共享缓存时共用一个实例。精确 stat identity 命中复用；同 dev/ino 增长只解码后缀；截断、替换和同长改写重新全读。解码失败不更新缓存。缓存不是持久状态。

目录能力在扫描时调用一次、每个物理文件取路径时再次调用；保留的逻辑文件读取再次调用，共存字节判定额外调用一次。不能永久缓存第一次目录结果。inventory 也在扫描及每个物理文件取路径时调用目录能力。

活动时间从文件末尾惰性倒读，跨段寻找 Journal 的 ObservedAt；连续 ProjectionCutTail 可越过，其他尾行停止。空文件、半行、坏 UTF-8 或读取失败停止供行；未取得持久活动时才使用最大 rounded mtime。已打开的描述符在 finally 中关闭。原有 open/stat/close 异常仍抛出；完整/增量解码错误返回事件错误，增量读盘失败返回 NonCanonical。inventory 捕获观察异常并返回 `inventory-unavailable`。没有公开 tail 游标或单行读取入口。

读取行为在 `tests/reader.test.mjs`，安装消费者与格式/写入共用现有 segments 包检查；隔离构建使用 events 与 retention 的公开产物，不带入其源码。

## 物理写入

调用方提供完整文本和目录能力，负责事件编码、产品路径政策、锁和业务提交结算。SegmentedWriter 不自动重试未知追加，不提供全局排队、幂等或跨进程协调，也不接管保留、整理或导入。

构造先检查 cap，再检查 writerId，不调用 directory。CurrentFile 初始为 0000；filePath 每次重新调用目录能力。非空 append 在原取路径位置调用该能力，不永久缓存第一次目录。空文本直接返回 no-append，不查询或创建目录。

缓存文件存在就继续用它；缓存缺失才依格式规则选最高段，无段时选旧式文件或 0000。旧式文件原地续写，不在这里整理。非空段追加后会超 cap 才滚动，恰好上限不滚，空段接受超大 batch。9999 后拒绝；滚动已经改变 CurrentFile 时，后续失败不回滚。

目录准备、目标选择和滚段失败属于 before-append。appendFileSync 即使已经写下部分或全部字节后才抛错，也属于 after-append；open/fsync/close 失败同属该类，cause 保持原对象。fsync 失败仍尝试 close；双失败保留 fsync 为 primary、close 为有序 cleanupFailures。durable 只在追加、barrier 和 close 均完成时返回，不替代业务提交。

末项文件自身的符号链接沿用现行 fs 行为；目录允许范围由调用方能力负责。

格式和共存用例在 `tests/005*.test.mjs`、`tests/014.test.mjs`；物理行为在 `tests/writer.test.mjs`。安装消费者共用 `scripts/tests/segments-package.test.mjs`，分别使用纯规则与物理 writer。具体运行结果记在对应交付记录，不在这里重复维护。
