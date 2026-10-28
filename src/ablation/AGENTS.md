# ablation — 消融 DAG 定律与运行时门禁状态

层：内核。入口 `wanxiangli/ablation`，导出工厂 `Ablation()` 及运行时状态单例 `ablationToolMapStore`、`ablationFactMapStore`、`ablationGateStore`。不依赖本仓其他模块，不直接读物理文件、不直接读环境变量。

承接主仓 `Ablation` 的 DAG 定律、工具/事实映射缓存及门禁裁决状态（Wave-2 Package-19）。
清单与配置集物理文件的加载由宿主/组合者执行并将条目传入，环境变量由调用方传入解析。
本模块自治拥有进程内注册表槽位引用、映射内存缓存及所有门禁裁决规则。

## AXIOM

1. [使用者] 关掉一项能力时，不能悄悄留下依赖它的下游能力继续以完整语义运行。
2. [开发者] 消融节点是产品清单，不是开关矩阵；本模块判断清单自洽性并根据激活状态裁决工具/事实/代理的放行。

## LEMMA

1. [AXIOM 2] 每个包恰有一个同名 `package` 主节点；`slice` 子节点必须声明同包主节点为父。
2. [AXIOM 1] `station-order` 与 `borrow` 两类边共同构成的图不得有环。
3. [AXIOM 1] `station-order`：下游 `active` 时上游至少 `borrowed`；`borrow`：目标至少 `borrowed` 时前提至少 `borrowed`。未给出的节点按 `ablated`。
4. [AXIOM 2] 违约只报第一处，原因文字与主仓原实现逐字一致，便于审计对照；输入先完整校验再判断，accessor 字段与稀疏数组被拒绝。
5. [AXIOM 1] 工具/事实映射缓存由自治 Store 拥有，支持惰性 loader 与按需清理，保持调用方无内部可变状态。
6. [AXIOM 1] Gate 决策根据节点模式精准裁决：工具/事实未映射时默认放行；映射到节点时按 `nodeDenied` 判定；工具 schema 仅在 `active` 或 `borrowed` 时放行；Primary Agent 严格按工作节点激活态绑定。

## SPEC

1. [LEMMA 1] 主节点缺失/重复、子节点父链错误分别报 `InvalidManifest`。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2, 3] 两类边上的环报 `DagViolation`；三态 3×3 全组合逐一核对两类边。
    - 证明：`tests/002.test.mjs`。
3. [LEMMA 4] 非法输入在判断前被拒绝；调用方事后改动输入不影响已返回结果；违约对象冻结。
    - 证明：`tests/003.test.mjs`；与主仓原实现的双算见主仓 CUT-37 证据。
4. [LEMMA 5, 6] 注册表槽位隔离、惰性缓存、重置及门禁裁决反例。
    - 证明：`tests/004.test.mjs`。
