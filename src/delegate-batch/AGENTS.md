# delegate-batch

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不持有 pending/active 缓冲、不完成任何 Task、不观察宿主事件。npm 入口 `wanxiangli/delegate-batch`。

# AXIOM

1. [使用者] 一个专属 delegate（owner scope × role）同时至多一个已准入批次；新调用在已有批次时被拒，不排队、不另建重复工作。
    - 理由：EXEC-026；busy 时另建重复工作。
2. [使用者] 语义批次只由 ProviderRun 与 provider 的工具调用次序定义，不由调度时序定义；批次齐了才整批准入，按 provider 次序。
    - 理由：EXEC-031；按到达时序拼批会把两次 provider 运行混成一批。

# LEMMA

1. [AXIOM 1] admit：active → ActiveBatch；无批次身份且有 pending → BatchPending，否则 single。
2. [AXIOM 2] 有批次身份：callOrder 为空、有重复或不含 currentCall → InvalidBatch；pending 存在但 providerRun 或 callOrder 不同 → OtherRunPending；currentCall 已收到 → DuplicateCall；否则收下，齐（收到数 = callOrder 长度）→ ready（order = callOrder），不齐 → wait；无 pending 时 open = true。
3. [AXIOM 2] observedBatch：同 role 的宿主观察调用按宿主次序，含 currentCall 才成批，否则 null。

# SPEC

1. [LEMMA 1, 2, 3] 证明：`tests/001.test.mjs`；与 vibe-fs 旧 `SyncDelegateStoreOps` 逐项对照见 vibe-fs `evidence/CUT-13/`。
