# borrowing

层：账本。容量账本、执行托管与 provider-step 借用的唯一 owner；不得 import 宿主 SDK，不调用模型、不签发许可、不排执行准入队列、不计数。npm 入口 `wanxiangli/borrowing`。

# AXIOM

1. [使用者] scheduler 看到的 `running` 必须等于真实在用的容量：一枚 token 是一次真实占位，借用只改变谁可以用它，从不凭空多出或少掉 token。
    - 理由：多算会让并发超出用户在 `wanxiangshu.mjs` 设下的上限；少算会卡死后续执行或让子会话饿死父会话。

# LEMMA

1. [本模块 AXIOM 1] 每次物理执行至多拥有一枚 token；新执行要么借用出借方的空闲 token、要么接过旧执行的 token、要么取一枚新 token；退休在途 token 只标记 Retiring，等 step 结束才真正归还。
    - 推理：按 live session 计数或“计数减一”无法区分是谁的结束；在途 provider 请求仍占着真实容量（execution-model-routing [003][012]）。
2. [本模块 AXIOM 1] 合并借用视图选中的 target 必须在只隐藏它自己 provider 的那枚 token 时仍可复现，否则不借。
    - 推理：没有一枚 token 能合法地为一个只在合并视图里成立的决定付费。
3. [本模块 AXIOM 1] provider-step 等待者按到达序号依次尝试：自己拥有的 token → 借来的 token → 策略允许时取新 token；同 requestKey 同 fence 的再次进入复用原等待或在途 step；等待有界（32）。
    - 推理：同一请求占两次、插队、无界等待都是反例（execution-model-routing [010][014]）。
4. [本模块 AXIOM 1] 所有者重新进入 transform 时从后代借用的在途 step 收回自己的 token；fence 严格前进时结束自己的旧 step。
    - 推理：后代借用不能永久扣住出借方的容量。

# SPEC

1. [LEMMA 1] 取新 token、接过旧 token、退休在途 token、精确 credit 查询。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2, 3] 借用、step 排队/复用/有界、release 取消等待者。
    - 证明：`tests/001.test.mjs`。
3. [LEMMA 4] 所有者收回与 fence 推进。
    - 证明：`tests/001.test.mjs`。
