# convergence

层：内核。纯计算，不得 import 宿主 SDK，不读写文件、不加锁、不访问 Git。npm 入口 `wanxiangli/convergence`。

# AXIOM

1. [使用者] 多个 writer 各自追加的事实，合在一起后一条都不能丢，也不能因为谁先到、谁的时钟快而换一种读法。
    - 理由：合法分叉是真实发生的历史；丢一支或挑一个赢家，事后的“说清”就是编出来的。

# LEMMA

1. [本模块 AXIOM 1] 合并是集合并集：同 id 同字节只留一份，异字节是身份碰撞，停下。身份字节规则只归 `wanxiangli/events`，本包只请它裁决。
    - 推理：同一规则两处实现必然漂移；碰撞判断错了，要么吞掉事实，要么把合法重复当损坏。

2. [本模块 AXIOM 1] 结果序列只由事件集合与因果边决定：每个 writer 内追加顺序不变，parent 先于 child，当前就绪的 head 之间按 EventId 文本序，与枚举顺序、进程和机器无关。
    - 推理：顺序若依赖输入排列，同一历史在两台机器上折叠出不同 Current。

3. [本模块 AXIOM 1] 一个 writerId 只代表一条完整逻辑流。同名出现两次说明调用方没有先聚合段，静默取其一会丢掉另一支，必须拒绝。
    - 推理：旧实现以 Map 折叠同名流，后来者整条覆盖前者；这正是“两个 writer 的合法分叉丢一支”。

4. [本模块 AXIOM 1] retention 只能整条移除 writer。保留集合内完全不存在的 parent 视为窗口外边界；集合内存在的依赖照常参与排序与成环检测。哪些 writer 被保留由调用方决定，本包不读时间。
    - 推理：把窗口外 parent 当损坏会让每次过期都变成全局故障；把窗口内缺失当窗口外则会掩盖真正的缺父。

# SPEC

1. [LEMMA 1, 2] `merge` 产出确定性的因果序列，并对 writer 置换、精确副本 writer 不变。
    - 证明：`tests/002.test.mjs`（跨 writer 父先于子、逆字典序因果边、固定种子 400 组置换与精确副本、独立流结合律）。

2. [LEMMA 1] 同 id 异字节是 IdentityCollision；合法分叉保留全部 head。
    - 证明：`tests/001.test.mjs`。

3. [LEMMA 3] 同名 writer 流被拒绝为 NonCanonical，不静默丢弃任一支。
    - 证明：`tests/003.test.mjs`。

4. [LEMMA 4] 严格模式缺父报 MissingParent，成环报 NonCanonical；retained 模式放行集合外 parent，集合内成环仍拒绝。
    - 证明：`tests/011.test.mjs`。

# 边界

- 段文件读取、聚合、锁、retention 截止时刻的计算与业务折叠（Integrator）不在本包；由主仓 EventStore 组合者持有。
- 结果按引用交还调用方的事件对象；本包不复制、不规范化事件。规范化与字节校验在 `wanxiangli/events`。
- `readyComparisons` 只是成本观测，不进入任何持久事实。
