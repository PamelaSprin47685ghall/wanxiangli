# events

层：内核。不得 import 任何宿主 SDK。本包是纯函数集：无文件、SQLite、Git 访问。

# AXIOM

1. [使用者] 已经发生的事不能再改。事后能逐轮说清，靠的就是历史不被改写。
    - 理由：历史一旦可改，任何"说清"都只是重写过的故事。

# LEMMA

1. [本模块 AXIOM 1] 事实只能追加；撤销靠追加新事实。
    - 推理：可覆盖的存储里，"现在是什么"与"曾经是什么"没有区别，逐轮理由就无从复核。

2. [本模块 AXIOM 1] 同一身份只对应同一串字节；不相同的字节是致命碰撞，停下。
    - 推理：身份用来指认事实。身份撞了，同一份历史就有两种读法，系统无法判定谁对。

3. [本模块 AXIOM 1] 不同写入者的并发分叉是合法现象，全部保留，不升级成损坏。
    - 推理：分叉是物理世界真实发生的事。把它当损坏，等于为了让数据好看而删掉发生过的历史。

4. [本模块 AXIOM 1; 护栏 D-04] 本包只承载单写入者 SQLite CAS 协议所需的事实编码与校验；多写入者收敛协议（分叉的产生、合并与裁决）不在本包表达，由 eventstore 及上层组合者另行承接。
    - 推理：两种协议的失败语义不同（身份碰撞 vs 合法分叉），用前者替代后者会把合法分叉误判为损坏。

# SPEC

1. [本模块 LEMMA 1] 信封字段固定：event_id、stream_id、event_type、parents、payload、payload_refs、payloads；信封与存储不带任何版本字段。新语义只加新的事件类型名；词汇表由调用方以谓词显式给出，本包不内置。
    - 证明：`tests/002.test.mjs` 断言七个固定线格式字段、拒绝注入 version 字段、拒绝改名字段，且词汇合法性只来自显式谓词。[TODO] 运行验证由 DevOps 执行。

2. [本模块 LEMMA 2] 规范化序列化：UTF-8 无 BOM、单个 LF 结尾、对象键按码点升序、父引用与载荷引用先去重再按字符序排序；稀疏数组空洞编码为 null。解码必须重编码还原同一字节，载荷引用与内联字节构成 sha256 闭包。
    - 证明：`tests/003.test.mjs`（确定性、码点序、去重折叠、往返）与 `tests/004.test.mjs`（单 LF、无 BOM、无效 UTF-8、CRLF 拒绝）。[TODO] 运行验证由 DevOps 执行。

3. [本模块 LEMMA 2, 3; 本模块 LEMMA 3] 读取遇到未知事件类型、缺父、成环、载荷缺失或哈希失配时拒绝整份快照，不跳过；合法分叉（多个 head）不是错误。
    - 证明：`tests/007.test.mjs`（缺父、成环、fail-closed）、`tests/008.test.mjs`（合法分叉两 head、裁决事件归拢、部分裁决留 head）、`tests/012.test.mjs`（载荷闭包）、`tests/027.test.mjs`（退役词汇拒绝）。[TODO] 运行验证由 DevOps 执行。

# 边界

- 公开面见 `src/events/index.d.ts`：`CanonicalEventCodec` 的 canonicalJson、encode、tryDecode、tryDecodeUtf8Text、tryDecodeUtf8、checkIdentity、mergeByIdentity、validate 八个纯操作。
- 事件类型词汇表归业务调用方；本包只做校验路由。
- 载荷内联（base64）与 eventstore 的外置 blob 是同一闭包规则的两个承载面；本包只校验内联面。
- 旧系统的 EventStore 信封、Journal 信封、Composition 折叠三层合并为本包一层；旧的三层命名不传承。
