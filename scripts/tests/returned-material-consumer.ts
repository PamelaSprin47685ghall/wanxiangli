import * as material from 'wanxiangli/returned-material'
import { CompletionRecord, type CompletionRecordResult, type MaterializedCompletion } from 'wanxiangli/handle-lifecycle'

const reports: readonly string[] = ['report']
const materials: readonly string[] = ['artifact']
const encoded: string = material.encode(reports, materials)
const body: string[] = material.body(encoded)
const carry: string[] = material.carry(encoded)
const error: string | null = material.validationError(encoded)
const entries: { text: string }[] = material.entries(encoded)
const fullText: string = material.fullText(encoded)
body.push('local')
carry.push('local')
entries[0].text = 'local'
void error
void fullText
// @ts-expect-error 原块必须是字符串。
material.encode([42], [])
// @ts-expect-error 编码输入是字符串，不接收已经解析的对象。
material.body({ body: [], carry: [] })
// @ts-expect-error 测试输入转换不属于存储协议入口。
material.ofEntries([])
// @ts-expect-error 呈现由独立模块承担。
material.render(encoded)

const records = new CompletionRecord()
const completion = records.encode({ kind: 'completed', runId: '', view: encoded, childSessionId: null })
const decoded = records.decode(completion)
if (decoded.kind === 'current') {
  const restored: MaterializedCompletion = records.materialize('agent', decoded.payload)
  const matches: boolean = records.belongsToWork({ childSessionId: 'child', authorityRoot: 'root' }, decoded.payload)
  void restored
  void matches
}
const restored: CompletionRecordResult<MaterializedCompletion> = records.decodeForWork(null, 'agent', completion)
const loaded = await records.read({ ref: 'blob', digest: 'digest' }, async () => ({ ok: true, value: completion }), () => 'digest')
if (loaded.ok && loaded.value) {
  const raw: string = loaded.value.body
  void raw
}
void restored
// @ts-expect-error 完成材料仍是规范字符串，不是已经解析的对象。
records.encode({ kind: 'completed', runId: 'run', view: { body: [], carry: [] } })
// @ts-expect-error 历史 abort 不能直接作为完成输入。
records.encode({ kind: 'aborted', runId: 'run' })
// @ts-expect-error 读取回调明确区分存储失败与正文。
records.read({ ref: 'blob', digest: 'digest' }, async () => 'body', () => 'digest')
