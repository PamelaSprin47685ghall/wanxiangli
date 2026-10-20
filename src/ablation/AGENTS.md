# ablation — 消融 DAG 定律

层：内核。入口 `wanxiangli/ablation`，导出工厂 `Ablation()`。不依赖本仓其他模块，不读文件、不读环境变量、不持有状态。

承接主仓 `Ablation/Manifest` 的 DAG 定律（CUT-37 抽取子范围）。清单与配置集的读取、解码、指纹、环境变量覆盖、注册表组装，以及工具/事实/代理门禁投影都留在主仓组合者。

## AXIOM

1. [使用者] 关掉一项能力时，不能悄悄留下依赖它的下游能力继续以完整语义运行。
2. [开发者] 消融节点是产品清单，不是开关矩阵；本模块只判断一份清单与一组三态是否自洽。

## LEMMA

1. [AXIOM 2] 每个包恰有一个同名 `package` 主节点；`slice` 子节点必须声明同包主节点为父。
2. [AXIOM 1] `station-order` 与 `borrow` 两类边共同构成的图不得有环。
3. [AXIOM 1] `station-order`：下游 `active` 时上游至少 `borrowed`；`borrow`：目标至少 `borrowed` 时前提至少 `borrowed`。未给出的节点按 `ablated`。
4. [AXIOM 2] 违约只报第一处，原因文字与主仓原实现逐字一致，便于审计对照；输入先完整校验再判断，accessor 字段与稀疏数组被拒绝。

## SPEC

1. [LEMMA 1] 主节点缺失/重复、子节点父链错误分别报 `InvalidManifest`。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2, 3] 两类边上的环报 `DagViolation`；三态 3×3 全组合逐一核对两类边。
    - 证明：`tests/002.test.mjs`。
3. [LEMMA 4] 非法输入在判断前被拒绝；调用方事后改动输入不影响已返回结果；违约对象冻结。
    - 证明：`tests/003.test.mjs`；与主仓原实现的双算见主仓 CUT-37 证据。
