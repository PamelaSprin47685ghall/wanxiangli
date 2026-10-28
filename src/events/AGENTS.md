# events — 规范事件编解码与无损闭包

层：内核纯函数。独立 npm 入口 `wanxiangli/events`。在总流程中，本模块规定追加式事件事实的规范编解码：同一事件编码出唯一确定的规范字节，同一身份必须对应同一串字节，载荷引用与内联字节构成 SHA-256 闭包。

## 状态所有权
- **CanonicalEventCodec** 纯函数集，无任何内部可变状态。
- 不访问文件系统、SQLite 或 Git，不内置业务事件类型词汇表。

## AXIOM
1. [使用者] 已经发生的事不能再改。事后能逐轮说清，靠的就是历史不被改写。
    - 理由：历史一旦可改，任何“说清”都只是重写过的故事。

## LEMMA
1. [AXIOM 1] 事实只能追加，撤销依靠追加新事实。
2. [AXIOM 1] 同一身份必须严格对应同一串字节；身份撞了且内容不一致报 `IdentityCollision`，不继续。
3. [AXIOM 1] 并发分叉是物理世界的合法现象，全部保留，不视为损坏；信封与存储不带任何版本字段。
4. [AXIOM 1] 规范化字节要求：UTF-8 无 BOM、以单个 LF 结尾、键按码点升序排列、引用集合去重排序；载荷引用与内联字节构成 SHA-256 闭包。

## SPEC（调用方流程）

1. **规范事件序列化与解码**：
   - 调用 `encode` 将事件对象序列化为唯一确定的规范 JSON 文本；调用 `tryDecode` 反序列化并要求重新编码得到相同字节，遇破损格式或缺失必要字段返回错误结果（`NonCanonical` / `MalformedEnvelope`）。
2. **载荷完整性核对 (checkClosure)**：
   - 写入前或读取后调用 `checkClosure`。逐条核对：每个 payloadRef 都要有内联字节且其 SHA-256 正好等于该引用（`PayloadDigestMismatch`），每份内联字节都要被某个引用点到（`UnreferencedPayload`）。
3. **身份碰撞检测**：
   - 多个流合流时调用 `checkIdentity`。若存在相同 event_id 但字节不同的事件，返回 `IdentityCollision`，由调用方拒绝合流。
