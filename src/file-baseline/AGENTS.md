# 原始文件基线

本模块为已完成案例保存相关文件原件，并在以后读取旧答案时形成 B→T 差异与下一份基线。是否刷新答案、何时提交事件和正文/基线事务仍由 Casebook 组合方负责；库只协作物理文件、payload 能力与公开 casebook-maintenance 纯规则。

FileBaseline 接收现有路径解析函数和只含 read/write 的 payload 能力。路径允许范围归解析方；解析异常在文件读取 catch 外，原对象拒绝。capture 去重并按 ordinal 顺序读取和保存，返回规范 JSON；compare 要求基线路径集合相等，逐项先读旧 payload，再读取目标一次，写入该次目标字节，最后用同份文字求 diff。即使没有变化也保存目标，不在准备提交时重读文件。

只有 ENOENT 是 Missing。目录、权限和非法 UTF-8 都失败；fatal UTF-8 解码保留 BOM、CRLF 和尾换行，并检查编码往返。缺 payload、坏摘要和非法旧字节不能解释为删除。payload 的 Result 失败沿现有字符串合同传播（write 加路径前缀）；回调拒绝原对象传播。

规范基线保留 Missing/Present 形状、字段别名和键序。解码只读取 kind、sha256、payloadRef，保留现行 Thoth 对根、字段及错误路径的文字；不引入 schema 迁移或宽松别名读取。编码仍以普通对象逐项赋值，沿用整数键与 __proto__ 的现行 JavaScript 行为。

目标文件之间不是全目录原子快照。失败前可能已保存部分内容寻址 payload；失败不会让组合方提交刷新，也不声称 capture 是物理原子操作。没有全局缓存、存储账本或新的文件系统框架。
