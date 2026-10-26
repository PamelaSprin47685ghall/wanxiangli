# casebook-maintenance

层：内核。纯计算与进程内结算状态自治对象，不得 import 宿主 SDK 或其它 wanxiangli 模块；不读文件、不读写 payload、不调 Bookkeeper、不写事件。npm 入口 `wanxiangli/casebook-maintenance`。

# AXIOM

1. [使用者] fetch 只在关联文件真的从维护基线 B 变到目标状态 T 时请求 CaseRefresh，并且交给 Bookkeeper 的 diff 恰好描述 B→T 的变化。
    - 理由：knowledge-reuse-005/015。无变化时请求维护是浪费并可能改坏正文；diff 不忠实，维护就基于错误的变化。
2. [使用者] 读取故障不得冒充 Missing（knowledge-reuse-016）。
    - 理由：把“读不了”当成“已删除”，会给 Bookkeeper 伪造一个删除差异并推进基线。
3. [使用者] 冲突认领单次送达且不可越界认领（Package-09 / knowledge-reuse-013）。
    - 理由：一个 case 的语义冲突使该 case 不可用，且回调只通知一次；StorageInvalid 保持 LogScopeFailure 语义；Redeliver 严格由原 owner 凭借引用同一性认领。

# LEMMA

1. [本模块 AXIOM 1] `fileDiff` 是零上下文统一 diff：`diff --git a/p b/p`，Missing→Present 加 `new file`、Present→Missing 加 `deleted file`，`---`/`+++` 用 `/dev/null` 表示缺失侧；hunk 由 Myers 双向中点二分得到，逐行冻结主仓旧算法与渲染（含 `\ No newline at end of file`）。B 与 T 相同（含同为 Missing）为空串。
    - 推理：同一对 B/T 必须给出旧实现给出的同一份文本，已有 Case 的维护才可比对。
2. [本模块 AXIOM 1] `summarize` 按给出次序拼接；`refresh` 当且仅当拼接非空。
3. [本模块 AXIOM 2] `readFailure`：只有 `ENOENT` 是 `missing`，其它（含无 code）都是 `fault`。
4. [knowledge-reuse-014] `truncate`：未超预算原样；超出时保留头尾各约一半与截断声明，结果不超过预算（预算小于声明长度时只给声明），截断点不落在代理对中间。
5. [本模块 AXIOM 3] `CasebookSettlementOwner` 拥有私有 `conflicts` 字典；`Observe` 按 eventId 幂等去重认领并安全触发 `onConflict` 回调（吞异常）；`Redeliver` 校验 `ReferenceEquals` 归属。

# SPEC

1. [LEMMA 1, 2] 400 组冻结向量（主仓 master 1c43198b5 构建的 `computeMaintenanceDiff`）逐字相等；每个 diff 经独立写成的应用器从 B 还原出 T。
    - 证明：`tests/005.test.mjs`。
2. [LEMMA 3] 只有 ENOENT 是 missing。
    - 证明：`tests/005.test.mjs`。
3. [LEMMA 4] 预算、头尾与良构。
    - 证明：`tests/005.test.mjs`。
4. [LEMMA 5] 冲突认领去重、异常吞噬、Redeliver 引用同一性与多实例隔离。
    - 证明：`tests/002.test.mjs`。
