import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Trace } from 'wanxiangli/trace'

export const bytes = text => new TextEncoder().encode(text)
export const user = (messageId = 'user-1') => ({ type: 'MessageObserved', messageId, role: 'user', origin: 'human', runId: null })
export const part = (messageId, data, index = 0, partId = `part-${index}`, kind = 'text') => ({ type: 'PartConfirmed', messageId, partId, index, kind, bytes: typeof data === 'string' ? bytes(data) : data })
export const finish = (messageId, partCount = 1) => ({ type: 'MessageFinished', messageId, partCount })
export const started = (runId = 'run-1') => ({ type: 'RunStarted', runId })
export const assistant = (messageId = 'assistant-1', runId = 'run-1') => ({ type: 'MessageObserved', messageId, role: 'assistant', origin: 'provider', runId })
export const terminal = (runId = 'run-1', outcome = 'Completed') => ({ type: 'RunFinished', runId, outcome })
export function fresh(id = 'trace-a') { return new Trace(id) }
export function whole(trace) { return trace.materialize(trace.cut(0), trace.head()) }
export function message(trace, metadata, data) {
  trace.capture(metadata)
  trace.capture(part(metadata.messageId, data))
  trace.capture(finish(metadata.messageId))
}
export function unchanged(trace, action, expected) {
  const before = trace.records()
  const state = trace.inspect()
  assert.throws(action, expected)
  assert.deepEqual(trace.records(), before)
  assert.deepEqual(trace.inspect(), state)
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
// 测试按公开格式重算摘要，确保恢复不只查哈希，也查领域顺序。
export function resign(frames) {
  const hash = value => createHash('sha256').update(value).digest('hex')
  let previous = hash(JSON.stringify(['trace-origin-v1', frames[0].traceId]))
  return frames.map((frame, index) => {
    const value = { traceId: frame.traceId, cursor: index + 1, previous, observation: frame.observation }
    previous = hash(canonical(value))
    return canonical({ ...value, digest: previous })
  })
}
export function capturedUser() {
  const trace = fresh()
  trace.capture({ type: 'Opening', bytes: bytes('开场\u0000') })
  message(trace, user(), '用户原文\r\n🧭 e\u0301')
  return trace
}
