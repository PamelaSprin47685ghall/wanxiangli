# response-text

`wanxiangli/response-text` 的 `classify` 只报告文本形状：`Empty`、`ToolMarkup`、`Text`。输入是字符串或 null，返回原生 JS 字符串。它不判断内容质量、意图、回答是否成立，也不决定续轮、失败或完成。

本次沿用主程序 TerminalValidity 的 `String.IsNullOrWhiteSpace` 与原 Regex 字面量及 `Compiled | IgnoreCase` 选项。当前两仓 Fable 的空白 helper 都使用 JS `/^\s*$/`；因此 FEFF 是空白，0085、180E、200B 不是。Regex 使用原来的包含匹配，破损标签、缺右尖括号和正文中夹带标签仍命中；不把它改成整个 XML 文档匹配。JS 的词边界保持原行为：`call_x` 不命中，`call-x`、`callé` 命中。

Regex 的实际 IsMatch helper 每次将 lastIndex 置零，重复调用不受上一次匹配影响。正文含工具标记是否应拒绝仍是主体未决策略（GAP-105），本模块迁移不解决此问题。

自身用例在 `tests/001.test.mjs`；隔离构建沿用 `scripts/tests/build.test.mjs`，实际包消费者在 `scripts/tests/response-text-package.test.mjs`。构建使用 `node scripts/build.mjs response-text`，没有 I/O、宿主 SDK 或兄弟模块依赖。
