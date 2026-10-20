# run-witness

层：账本。一个 Host 进程里 provider run 精确观察的唯一 owner；不得 import 宿主 SDK，不选模型、不持有容量、不判定失败。npm 入口 `wanxiangli/run-witness`。

# AXIOM

1. [使用者] 一次确认的 provider 失败只能作用于产生它的那一次 run 所用的 target，且只作用一次；迟到、重复或别的会话的回调不能借它再换 target 或再重试。
    - 理由：provider-attempt-recovery-021 的原样重试与判死 provider 都以这一次 run 的见证为凭据。
2. [使用者] 工具边界只能按 Host 自己观察到的 run id 找到精确的（会话，物理用户消息），不得用会话当前执行代替。
    - 理由：陈旧的工具调用不得结束更新执行的 provider step。

# LEMMA

1. [AXIOM 1] 每个会话至多一个活见证（最新 run）；记新 run 即退休旧见证；见证一次性取走。
2. [AXIOM 1] 保留重试只在见证属于该会话时绑定；别的会话的见证被消耗但不授予任何东西；重试绑定一次性消费。
3. [AXIOM 2] run → 物理执行的关系只由显式记录产生；查询未知 run 得 null。
4. [AXIOM 1, 2] 会话退休忘掉其见证、重试绑定和全部 run 关系；物理终结只忘掉该精确物理执行的 run 关系。

# SPEC

1. [LEMMA 1–4] 证明：`tests/001.test.mjs`。
