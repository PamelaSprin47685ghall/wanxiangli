# 原始文件基线

本模块为已完成案例保存相关文件原件，并在以后读取旧答案时形成 B→T 差异与下一份基线。是否刷新答案、何时提交事件和正文/基线事务仍由 Casebook 组合方负责。一个工程内包含 FileBaseline 与纯 FileDiff：前者协作物理文件与 payload 能力，后者计算同一份文本的差异、汇总和截断。纯规则使用者无需构造 FileBaseline；入口包含 Node 文件依赖。

FileBaseline 接收现有路径解析函数和只含 read/write 的 payload 能力。路径允许范围归解析方；解析异常在文件读取 catch 外，原对象拒绝。capture 去重并按 ordinal 顺序读取和保存，返回规范 JSON；compare 要求基线路径集合相等，逐项先读旧 payload，再读取目标一次，写入该次目标字节，最后用同份文字求 diff。即使没有变化也保存目标，不在准备提交时重读文件。

只有 ENOENT 是 Missing。目录、权限和非法 UTF-8 都失败；fatal UTF-8 解码保留 BOM、CRLF 和尾换行，并检查编码往返。缺 payload、坏摘要和非法旧字节不能解释为删除。payload 的 Result 失败沿现有字符串合同传播（write 加路径前缀）；回调拒绝原对象传播。

规范基线保留 Missing/Present 形状、字段别名和键序。解码只读取 kind、sha256、payloadRef，保留现行 Thoth 对根、字段及错误路径的文字；不引入 schema 迁移或宽松别名读取。编码仍以普通对象逐项赋值，沿用整数键与 __proto__ 的现行 JavaScript 行为。

目标文件之间不是全目录原子快照。失败前可能已保存部分内容寻址 payload；失败不会让组合方提交刷新，也不声称 capture 是物理原子操作。没有全局缓存、存储账本或新的文件系统框架。

FileDiff 保持零上下文统一 diff 的原始字节格式，包括 Missing/Present、新建/删除文件标记和末尾无换行说明。summarize 按给定顺序拼接，非空才返回 refresh；这只是差异事实，不负责请求刷新。截断保留头尾，不在代理对中间切开；预算不足以容纳原有截断声明时只返回声明，不改写既有文字。

案例结算冲突的认领、去重与报告属于 `wanxiangli/casebook` 的独立对象，不归文件基线。基线字节、单次目标读取与纯差异用例分别在 `tests/001.test.mjs`、`tests/diff.test.mjs`；实际包消费者在 `scripts/tests/file-baseline-package.test.mjs`。运行结果只记在对应交付记录。
