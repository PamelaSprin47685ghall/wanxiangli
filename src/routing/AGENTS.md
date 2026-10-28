# routing — 模型路由协议

层：内核纯计算。独立 npm 入口 `wanxiangli/routing`。在总流程中，用户通过自己编辑的路由模块决定「哪个角色用哪个模型、并发上限多少」；本模块负责在运行前把这份模块的形状查清楚，之后每次调用都严格按协议执行并解析目标字符串。

[程序待改] 宿主配置文件名 `wanxiangshu.mjs` 写死在本核错误文案里，且文案提到的推荐模板 `resources/wanxiangshu.mjs` 并不在本核发行物中。已登记在根《例外清单》。

## 状态所有权
- 独占拥有路由协议（Protocol 2）的形状校验、调用包装与目标字符串解码；交还的策略对象是冻结副本。
- 不 import 模块、不读文件、不持有实际模型连接，不维护并发计数——模型选择与并发上限全部属于用户的路由模块。

## AXIOM
1. [使用者] 模型选择与并发限制只由用户自己编辑的路由模块决定；运行时不得把一份坏配置悄悄解释成某种策略。
    - 理由：用户靠编辑这一个文件控制花费与并发；被静默改写的含义只会在账单或卡死时才暴露。

## LEMMA
1. [AXIOM 1] 协议 2 模块必须显式声明 `routingProtocol === 2`（数字），`default` 与 `hasTheoreticalCapacity` 是函数；`markProviderFailed` 可省略，出现时必须是函数。
2. [AXIOM 1] `route(role, running, previous)` 恰好三个参数同步调用，输入为冻结副本；返回确定 target 或 null/undefined（表示等待），返回 Promise、抛错或非法 target 一律抛错。
3. [AXIOM 1] target 规范格式为 `provider/model:reasoning`，按末尾最后一个冒号解析推理档位（模型名可以含冒号）；`model` 与 `reasoning` 修剪后非空。
4. [AXIOM 1] 所有错误都是 `Error`，消息以 `execution-model-routing:` 开头，调用方按配置错误处理，不猜一个策略继续跑。

## SPEC（调用方流程）

1. **配置模块形状核查**：
   - 宿主自己载入用户路由脚本后，把模块命名空间传入 `admit(moduleNamespace)`。形状不符（缺协议版本、缺必要函数、`markProviderFailed` 不是函数）立即抛错，调用方按配置错误停止启动；通过则拿到冻结的 `{ route, hasTheoreticalCapacity, markProviderFailed }`。
2. **角色路由求解**：
   - 传入当前角色、活跃执行列表与上一次目标调用 `route`。同步返回修剪后的目标，或 null 表示等待排队；返回 Promise、抛错或目标不合法都作为配置错误抛出。
3. **理论容量核对**：
   - 调用 `hasTheoreticalCapacity(query, role)`；结果必须是布尔，返回 false 时外层不再为该角色排队。
4. **目标解码**：
   - `decodeTarget` 解码刚产生的 target；`decodeDurableTarget` 解码持久化下来的 `provider/model:reasoning` 字符串；`providerOf` 取 target 的 provider（model 第一个 `/` 之前）。解码失败都明确抛错，不返回半截目标。
