# routing

层：协议。纯校验与调用，不得 import 宿主 SDK，不读文件、不 import 用户模块、不持有容量。npm 入口 `wanxiangli/routing`。

# AXIOM

1. [使用者] 模型选择与并发限制只由用户的 `wanxiangshu.mjs` 决定；运行时不得把一份坏配置悄悄解释成某种策略。
    - 理由：用户靠编辑这一个文件控制花费与并发；被静默改写的含义只会在账单或卡死时才暴露。

# LEMMA

1. [本模块 AXIOM 1] 协议 2 的模块形状是 `routingProtocol === 2`（数字）、default 是 `route` 函数、`hasTheoreticalCapacity` 是函数；`markProviderFailed` 可省略，出现时必须是函数。任何不符都给出可操作的错误，不默认补齐。
    - 推理：版本是格式版本而不是开关，三参数函数会默默忽略多余参数，只有显式标记能证明升级；缺理论容量查询若当作“永远有”，失去候选的 demand 会等一个不存在的容量生产者（execution-model-routing [013]）。

2. [本模块 AXIOM 1] `route` 恰好收到 `(role, running, previous)`：role 修剪且非空，running 保留重复项，running 与 previous 是冻结副本；结果必须同步。Promise、抛错、非法 target 都是配置错误；null / undefined 是“等待”。
    - 推理：running 是调用方账本的投影，调度器改动它就改了别人的事实；异步结果无法在准入点给出确定答案。

3. [本模块 AXIOM 1] 理论容量查询恰好收到 `(role)`，只认布尔结果。
    - 推理：Promise 与字符串 `"false"` 都是真值；按真值解释会让 async 查询永远“有容量”。

4. [本模块 AXIOM 1] target 是修剪后的完整 `provider/model` 与非空 reasoning；持久道路的 `provider/model:reasoning` 以最后一个 ':' 分隔并走同一字段规则。
    - 推理：模型名可以含 ':'（如 `ollama-cloud/gemma4:31b`），reasoning 不含；按第一个 ':' 切会把模型名截断、把剩余部分当 reasoning。

# SPEC

1. [LEMMA 1] 合法形状交还冻结策略；缺 default、版本缺失/非数字/非 2、缺或非函数的理论容量查询、非函数 markProviderFailed 都抛错。
    - 证明：`tests/002.test.mjs`。
2. [LEMMA 2] 三参数、重复项保留、副本冻结不可改、Promise/thenable/抛错/非法 target 抛错、undefined 等同 null。
    - 证明：`tests/002.test.mjs`。
3. [LEMMA 3] async、字符串、数字、undefined 结果抛错；单参数按角色回答。
    - 证明：`tests/002.test.mjs`。
4. [LEMMA 4] 道路 target 按最后一个 ':' 解码；空、缺 reasoning、缺 provider 抛错；providerOf 取第一个 '/' 之前。
    - 证明：`tests/002.test.mjs`。
