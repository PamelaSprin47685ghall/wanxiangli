# grounding — 需求发现与材料溯源

层：物理能力库。入口 `wanxiangli/grounding`。承接主仓 CUT-26 抽出的需求发现与材料溯源算法：requirements 包发现（WHAT.md 清单）、APPLIES-TO gitignore wildmatch 规则解析与匹配、包根 Markdown 物化、内容身份 Digest 计算，以及工作区相对路径解析。glob 内核与 `wanxiangli/fs`（CUT-24）共用同一 `Filesystem` wildmatch 实现；摘要用 `node:crypto`。不导入 Work、Journal 或宿主。

## AXIOM

1. [使用者] 规范包身份由工作区目录事实决定：`requirements/` 下直接子目录含 `WHAT.md` 即合法包，不得硬编码包名或数量。
   - 理由：发现规则写死包名，新增规范就要改库代码。
2. [使用者] 快照 digest 由材料内容决定：同一批路径与字节有相同 digest，内容变更必不同。
   - 理由：溯源要回答“当时看到的是哪一份内容”。
3. [开发者] 本能力脱离主仓与宿主单独成立；主仓只通过 npm 消费。
   - 理由：发现、匹配、物化、摘要是纯物理算法；投影状态机绑定主仓类型词汇，留在主仓。

## LEMMA

1. [AXIOM 1] `discover` 只扫 `requirements/` 一层子目录；APPLIES-TO 逐行解析（空行与 `#` 忽略，`!` 前缀为排除规则），声明包自覆盖是配置错误，直接抛错；结果按包名升序。
2. [AXIOM 1, 3] 路径匹配：包自身目录天然覆盖；外部路径按规则声明顺序求值（include 起步 false，命中即取该规则 include）；`resolve` 返回全部命中包名升序。工作区外路径解析为无命中。
3. [AXIOM 2] `materialize` 只注入包根直接存在的 `*.md`（文件名升序），tests 与 APPLIES-TO 不进入材料；digest = SHA-256(每材料 `path + NUL + resultBytes + NUL` 串联)；未知包名抛错。`snapshotsForPaths` 对命中包去重后按包名升序物化。
4. [AXIOM 3] JS 边界形状：`{name, root, rules: [{include, pattern}]}`、`{workspace, packageName, digest, materials: [{path, resultBytes}]}`，全部 JS 原生值；非法 pattern 抛错，不静默 false。
5. [根 SPEC 2] glob 语义与 `wanxiangli/fs` 的 GlobMatch 内核同源共用（同一 `Filesystem` 实例的 `matchesPathPattern`），与主仓 GlobMatch 桥接层行为一致。

## SPEC

1. [LEMMA 1] `tests/001.test.mjs`：包发现、无 requirements、APPLIES-TO 规则解析、自覆盖拒绝。
2. [LEMMA 2] `tests/002.test.mjs`：自目录覆盖、include/exclude 顺序、多包重叠升序、工作区外路径。
3. [LEMMA 3, 4] `tests/003.test.mjs`：根 Markdown 物化、内容锚定 digest、未知包抛错、已知 SHA-256 向量、snapshotsForPaths 去重排序。

## 边界

- 不含投影折叠状态机（主仓 `RequirementGroundingProjection` 绑定 ToolCallId、TranscriptGap 与 Occurrence 词汇，留主仓消费 Model 类型）。
- 不含权限判定、宿主协议、持久化与注入编排（主仓 Runtime/Gate 职责）。
- 主仓 `GroundingCatalog` 是本库的 F# 桥接层（同 CUT-24 GlobMatch 模式）；改 JS 字段名或错误词表须两仓同步。
