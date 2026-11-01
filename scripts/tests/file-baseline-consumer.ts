import { FileBaseline, FileDiff, type MaintenanceSummary, type TruncatedDiff } from 'wanxiangli/file-baseline'
import { CasebookSettlementOwner, type SettlementOutcomeTag } from 'wanxiangli/casebook'

const diff = new FileDiff()
const summary: MaintenanceSummary = diff.summarize([diff.fileDiff('file', null, 'text')])
const truncated: TruncatedDiff = diff.truncate(summary.diffSummary, 200)
void truncated
const owner = new CasebookSettlementOwner<{ message: string }>(incident => { void incident.message })
const incident = { message: 'case conflict' }
const settled: SettlementOutcomeTag = owner.Observe('event', 'SemanticCut', incident)
const redelivered: 'CaseUnavailableKnown' = owner.Redeliver('event', incident)
void settled; void redelivered
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
