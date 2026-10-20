# chat-execution

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不持有证据、不持有投影、不写日志。npm 入口 `wanxiangli/chat-execution`。

# AXIOM

1. [使用者] 一次受管 chat 执行由精确键（session, physical user message）唯一标识，依次经过 Accepted → ProviderStarted → Terminal；Terminal 只赋值一次。
    - 理由：managed-chat-execution（exact key 与 Terminal 单赋值）；重复启动或第二个终态会把一次执行记成两次。
2. [使用者] 从未到达 provider 的执行不可能 Completed。
    - 理由：完成需要 provider 真的跑过；把未开始的执行记成完成会伪造结果。

# LEMMA

1. [AXIOM 1] 证据由调用方按值比较，本模块只接收两条相等事实：`sameAccepted`（事实的承接证据等于执行已确立的承接证据）、`sameStarted`（执行已有启动证据且与事实的启动证据相等）。
2. [AXIOM 1] 折叠（`fold`）：同一事实的精确重放是 `keep`；冲突、越级、终态之后再启动一律 `reject` 并给出原因；`schemaRejection` 先于任何证据判断。
3. [AXIOM 1] 启动决策（`decideStart`）：Accepted 追加；同一 provider run 的重放返回既有；另一 run 冲突；终态之后不得启动。
4. [AXIOM 1, 2] 终态决策（`decideTerminal`、`settlePreProvider`）：每次执行只有一个终态；精确重放幂等；不同 disposition 冲突并报告既有值；未启动不得走 after-provider 终态，已启动不得走 pre-provider 结算，pre-provider 不得 Completed。

# SPEC

1. [LEMMA 1, 2] 证明：`tests/001.test.mjs`。与 vibe-fs 旧 ChatExecutionFactFold 逐项对照见 vibe-fs `evidence/CUT-12/`。
2. [LEMMA 3, 4] 证明：`tests/001.test.mjs`。
