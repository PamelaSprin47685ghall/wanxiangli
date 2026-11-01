import { FileBaseline, FileDiff, type MaintenanceSummary, type TruncatedDiff } from 'wanxiangli/file-baseline'
import {
  CasebookSettlementOwner, BookkeeperStaging, CasebookState, normalizeObservations, sameObservations,
  type CasebookEdit, type CasebookEditFailure, type SettlementOutcomeTag,
  type CasebookCase, type CasebookFact, type CasebookObservation, type CasebookVisible,
} from 'wanxiangli/casebook'

const diff = new FileDiff()
const summary: MaintenanceSummary = diff.summarize([diff.fileDiff('file', null, 'text')])
const truncated: TruncatedDiff = diff.truncate(summary.diffSummary, 200)
void truncated
const owner = new CasebookSettlementOwner<{ message: string }>(incident => { void incident.message })
const incident = { message: 'case conflict' }
const settled: SettlementOutcomeTag = owner.Observe('event', 'SemanticCut', incident)
const redelivered: 'CaseUnavailableKnown' = owner.Redeliver('event', incident)
void settled; void redelivered
const staging = new BookkeeperStaging()
staging.beginTransaction('edit', 'question', 'answer')
const created = staging.edit('edit', (key: CasebookEditFailure): string => key)
if (created.tag === 0) {
  const edit: CasebookEdit = created.fields[0]
  const original: string = edit.api.bookkeeper.question()
  const runtime: string = edit.runtimeBaseClass
  edit.api.bookkeeper.setQuestion(original)
  edit.api.bookkeeper.setAnswer(null)
  const result = edit.commit()
  if (result.tag === 1) { const error: string = result.fields[0]; void error }
  void runtime
  // @ts-expect-error 补丁缓冲由编辑自己持有。
  edit.questionPatch = 'outside'
}
// @ts-expect-error 错误文案按失败键懒取，不能传预先求值的字符串。
staging.edit('edit', 'error text')
const observations: readonly CasebookObservation[] = [
  { kind: 'grep-result', pattern: 'text', matches: [['file', 1, 'text']] },
]
const record: CasebookCase = {
  identity: 'one', sourceTrace: 'trace', q: 'question', a: 'answer', relatedPaths: ['file'],
  completionFileState: 'completion', maintenanceFileState: 'maintenance', accessOrder: 0n, observations,
}
const fact: CasebookFact = { kind: 'captured', case: record }
const empty = new CasebookState()
const current: CasebookState = empty.apply(fact)
const visible: CasebookVisible = current.visible(1)
const resolved: CasebookCase | null = current.resolve(1, 'shelfmark')
const normalized: CasebookObservation[] = normalizeObservations(observations)
const same: boolean = sameObservations(observations, normalized)
void visible; void resolved; void same
// @ts-expect-error 从空状态开始，不提供计数器或状态快照注入。
void new CasebookState(99n)
// @ts-expect-error 案例表是私有状态。
void current.Cases
// @ts-expect-error 访问序是 bigint，不经过 number。
void current.apply({ kind: 'captured', case: { ...record, accessOrder: 1 } })
// @ts-expect-error 文件状态只接受字符串或 null。
void diff.fileDiff('file', undefined, 'text')
// @ts-expect-error 结算消息形状由实例固定。
void owner.Observe('event', 'SemanticCut', { code: 1 })

const service = new FileBaseline({
  resolvePath: (path: string): string => path,
  payloads: {
    read: async (_reference: string) => ({ ok: true as const, value: new Uint8Array([65]) as Uint8Array | null }),
    write: async (_bytes: Uint8Array) => ({ ok: true as const, value: 'payload-reference' }),
  },
})
void service.capture(['file']).then(result => {
  if (result.ok) { const baseline: string = result.value; return baseline }
  const failure: string = result.error
  return failure
})
void service.compare(['file'], '{}').then(result => {
  if (result.ok) {
    const summary: string = result.value.diffSummary
    const refresh: boolean = result.value.refresh
    const state: string = result.value.targetState
    void summary; void refresh; return state
  }
  return result.error
})
const rawFailure = 'payload owner failure'
void new FileBaseline({ resolvePath: path => path, payloads: {
  read: async () => ({ ok: false as const, error: rawFailure }),
  write: async () => ({ ok: false as const, error: rawFailure }),
} })
// @ts-expect-error 路径策略由调用方明确给出。
void new FileBaseline({ payloads: { read: async () => ({ ok: true, value: null }), write: async () => ({ ok: true, value: 'ref' }) } })
// @ts-expect-error capture 接收路径数组。
void service.capture('file')
// @ts-expect-error compare 必须给出原始基线。
void service.compare(['file'])
// @ts-expect-error payload read 不能把文本当作原始字节。
void new FileBaseline({ resolvePath: path => path, payloads: { read: async () => ({ ok: true, value: 'text' }), write: async () => ({ ok: true, value: 'ref' }) } })
