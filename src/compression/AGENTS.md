# compression — 上下文声明与检查点准入

层：内核。npm 入口 `wanxiangli/compression`，导出工厂 `Compression()`。本对象只校验声明的形状，不认识 Host、消息、锚点编号台账或存储。可见区间与请求边界由宿主提供并校验；token 计量与 TOML 呈现也由宿主负责。

# AXIOM

1. [使用者] 保留什么由模型明确声明。整数引用锚点，字符串就是字面内容，数组顺序就是携带顺序。
   - 理由：模型负责内容取舍，系统只执行形式合规的选择，不判断摘要质量或重复语义。
2. [使用者] 压缩额外指定原样保留的前缀长度；父子传递与子父传递没有前缀。
   - 理由：前缀用于本会话保留已有字节，传递只需给出实际携带的材料。
3. [使用者] 一次成功调用至多追加一个检查点；结局未知不能重写。
   - 理由：重复或伪造的检查点不能成为已发生的压缩事实。

# LEMMA

1. [AXIOM 1, 2] `parseCarry` 只接受 `(number|string)[]`。数字必须是有效的非负整数编号；空字符串与空白字符串合法，重复与重排合法。`parseView` 只接受 `{ prefixUntil, carry }`，两字段必填，`prefixUntil` 为非负整数（保留所有锚点编号严格小于它的历史区间）。
2. [AXIOM 1] 只读数组自己的数据元素，拒绝稀疏数组与 accessor。解析结果必须是新的冻结数组，不运行 iterator 或 `toJSON`。
   - 推理：验证过的选择不能在稍后交付时被调用方修改或序列化钩子替换。
3. [AXIOM 2] 本对象不接收区间历史、替换映射或当前回合。宿主按请求快照解析锚点并按 prefixUntil 截取前缀，再建立实际布局。
   - 推理：只有宿主拥有准确可见历史与请求边界，纯形状对象不能猜测它们。
4. [AXIOM 3] 检查点按 `(session, callId)` 精确键准入。首个 completed 返回 `append`，未结局的重复调用返回 `join`，已提交或 error 返回 `skip`。只有确认未尝试的 `WriterUnavailable` 允许释放重试。

# SPEC

1. [LEMMA 1] 合法声明保持顺序；缺字段、旧映射、额外字段、非法前缀拒绝，accessor 不运行。
   - 证明：`tests/001.test.mjs`。
2. [LEMMA 1, 3] 空数组、重复编号、重排、数字字符串、空白与 Unicode 字面值均保留；任一非法元素使整个数组失败，传递不接受前缀包装对象。
   - 证明：`tests/002.test.mjs`。
3. [LEMMA 2] 拒绝稀疏与 getter 元素；外部修改、iterator 与 `toJSON` 不能改变解析结果。
   - 证明：`tests/003.test.mjs`。
4. [LEMMA 4] 提交一次、重复会合、失败封口、键不别名、未尝试可重试、输入非法不留痕与实例独立。
   - 证明：`tests/004.test.mjs`。

宿主的完整行为合同见 `requirements/context-compression/WHAT.md` [031]、[032]。旧 `thenMap`、`prefixUntil`、`live`、`plan`、`project` 覆盖模型已移除，没有兼容路径。源码与测试完成后须分别记录编译和实际验证结果；本文件的测试路径不代替运行回执。
