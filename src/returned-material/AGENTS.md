# returned-material

`wanxiangli/returned-material` 保存交回报告与材料的表示协议。调用方将明确分好的 body、carry 字符串数组交给 `encode`，得到 body 键在前的规范 JSON；之后可分别取回两组原块、carry 的 `{text}` 视图或连接后的原文。空串、重复、顺序、Unicode 和原始换行都保留，不从内容推断分类。

分部读取与完整校验的承诺不同。`body`、`carry` 只检查被读取字段，显式 null 返回空数组，缺字段 undefined 或非字符串数组抛错；另一字段无效不妨碍当前字段读取。`validationError` 对完整编码重编码并逐字节比较：规范值返回 null，其余返回原两类协议错误文字。body:null 可被分部读取，但不是规范字节；carry:null 在完整校验时属于错误形状。

`entries` 保留 carry 的原序和重复；`fullText` 只将 body 后接 carry，以两个 LF 连接，不渲染 TOML。各次读取返回新原生数组，没有长期状态、缓存或 I/O。交付格、围栏和去重归 delivery；模型可见呈现归 llm-text；本模块不依赖这两个兄弟职责，也不拥有 ofEntries 测试输入转换。

公开接口见 `index.d.ts`，行为在 `tests/001.test.mjs`；独立构建沿用 `scripts/tests/build.test.mjs`，实际安装包消费在 `scripts/tests/returned-material-package.test.mjs`。构建使用 `node scripts/build.mjs returned-material`。
