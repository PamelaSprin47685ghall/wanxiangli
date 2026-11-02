# llm-text

`wanxiangli/llm-text` 负责面向 LLM 的文本表示：文档分区与组合、结构化值编码、TOML 生成与 UTF-8 字节计量。调用方决定哪些材料是指令、哪些是参考，模块不根据内容猜测。没有 I/O、宿主 SDK 或持久状态。

`LlmText` 通过私有 WeakMap 拥有不透明值。输入数组转换为私有不可变值；文档操作返回新值。值只在创建它的实例中使用，不能把原始字符串冒充数据块。

保持现有表示语义：指令注释在前，根部裸字段先于表，字符串保留原始换行，int64 保留 bigint 精度。`structuredValue` 与 `rootStructuredValue` 的根部规则不同。混合数组中 null／对象沿用原内联 `false` 行为，不宣称任意 JSON 无损转换。ReturnedMaterial 的存储协议、业务字段选择、压缩和 provider 调用不属于本模块。

行为测试就近放在 `tests/`；隔离构建与真实包消费分别沿用 `scripts/tests/build.test.mjs` 和 `scripts/tests/llm-text-package.test.mjs`。
