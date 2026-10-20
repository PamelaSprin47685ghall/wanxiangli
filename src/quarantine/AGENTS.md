# quarantine

层：内核。纯计算，不得 import 宿主 SDK 或其它 wanxiangli 模块；不持有 Current、不读写事件、不做重放。npm 入口 `wanxiangli/quarantine`。

# AXIOM

1. [使用者] 业务规则在某个事件上失败时，不中止重放：只隔离该规则在失败事件 FaultScope 内的尾部，Current 停在最后一次成功；其它规则、其它 scope 照常推进。
    - 理由：durable-events-013/019/021（语义失败只截该规则的尾，不毒化整条历史）。
2. [使用者] 隔离只能由按时间线出现的持久 `ProjectionCutTail` 事实解除；截尾载荷携带规则名、失败事件、原因和规则自己的 reset 补丁。
    - 理由：冷重放必须得到与在线相同的 Current，解除不能只存在于进程内存。

# LEMMA

1. [AXIOM 1] 隔离账以 (rule, scope) 为键，持久不可变：`quarantine`/`release` 返回新账、旧账不变（调用方的乐观提交依赖旧快照不被改写）。同键再次登记覆盖。
2. [AXIOM 1] 隔离中的 (rule, scope) 对后续事件一律跳过（`isQuarantined`）。
3. [AXIOM 2] 截尾载荷线上键序固定为 `rule, failed_event_id, reason, reset_json`，四者都是字符串。`decodeCut` 只在事件类型恰为 `ProjectionCutTail`、载荷为对象且四字段皆字符串时成立；畸形截尾为 null（调用方按普通事件处理，不清隔离）。
4. [AXIOM 2] 截尾只在规则仍在程序中、且它点名的失败事件已被整合时生效（`cutVerdict`）；解除的键是 (cut.rule, 失败事件自己的 scope)。reset 补丁由规则应用，应用失败则隔离保留——这一步归调用方，本模块不判断补丁内容。
    - 注：解除不比对账上记录的 failedEventId 与截尾点名的是否相同（与 vibe-fs 旧实现逐位一致）。

# SPEC

1. [LEMMA 1, 2] 证明：`tests/019.test.mjs`。
2. [LEMMA 3] 证明：`tests/019.test.mjs`；与 vibe-fs 旧 Thoth 编解码逐项对照见 vibe-fs `evidence/CUT-19/shadow-quarantine.mjs`。
3. [LEMMA 4] 证明：`tests/019.test.mjs`。
