# casebook-access

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不读文件、不持有会话状态、不写事件。npm 入口 `wanxiangli/casebook-access`。

# AXIOM

1. [使用者] Case 的 relatedPaths 只来自实际执行层的实质访问：成功读取关联整个文件；成功创建、修改、删除关联该路径，移动关联新旧两端；失败或未提交的修改不计，但此前的真实读取仍计。
    - 理由：knowledge-reuse-003。多计会让 fetch 为无关文件触发维护；少计会让真实依赖的变化漏检。
2. [使用者] 模式检索、候选发现、目录列表、符号导航与文本里提到的路径不构成实质访问。
    - 理由：knowledge-reuse-003。

# LEMMA

1. [本模块 AXIOM 1, 2] `accessPaths` 按访问种类给路径；`mutation` 只在 committed 时计；检索类恒为空；空白路径不计。
2. [本模块 AXIOM 1] `toolPaths`：已提交的 create/rewrite/delete 取参数 `path|filePath|file` 中第一个出现的键（其值不是文本即无路径），move 取 source 与 destination（缺一不计）；其它工具名为空。
3. [knowledge-reuse-010] `relatedPaths` 去空白、去重、码元序升序；Fission 裂变前与各 lane 的访问取并集也用它。
4. [本模块 AXIOM 1] `execRead`：cat/head/tail/sed 的单文件读取。含 `$(` 或反引号的命令整条不计（目标不可静态得知）；head/tail 的 `-n`、`-c` 带一个值，值不是文件。
    - 推理：主仓旧实现只拒绝“反斜杠+反引号”，`cat \`ls\`` 被记成读取文件 `` `ls` ``；`tail -c 100 f` 被记成读取文件 `100`。两者都是凭空捏造的关联路径。

# SPEC

1. [LEMMA 1] 证明：`tests/003.test.mjs`。
2. [LEMMA 2] 证明：`tests/003.test.mjs`。
3. [LEMMA 3] 证明：`tests/003.test.mjs`。
4. [LEMMA 4] 证明：`tests/003.test.mjs`；与主仓旧实现的逐项差异由 vibe-fs `evidence/CUT-27/shadow-access.mjs` 记录。
