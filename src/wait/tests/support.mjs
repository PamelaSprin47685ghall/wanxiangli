import { Wait } from '../../../dist/wait/Wait.js'

export const owner = (kind, identity) => Wait.owner(kind, identity)
export const workflowProducer = ownerValue => Wait.workflowProducer(ownerValue)
export const externalProducer = (kind, identity) => Wait.externalProducer(kind, identity)
export const escape = (kind, value) => Wait.escape(kind, value)

export function describe({ waitKind = 'join', ownerKind = 'engineer', ownerId = 'a', producer, subject = { topic: 'test' }, escapes = [], source = 'test' } = {}) {
  return {
    waitKind,
    owner: owner(ownerKind, { id: ownerId }),
    subject,
    producer: producer ?? workflowProducer(owner('engineer', { id: 'producer-of-' + ownerId })),
    escapes,
    source,
  }
}

export const registry = () => Wait.createRegistry(null)

// 本模块自有的确定性虚拟定时器夹具：到期由 advance 显式推进，取消后不再触发。
// 取消计数留在夹具内部，等待模块只看见 { Delay, Cancel() }。
export function virtualTimer() {
  let nowMs = 0
  let nextId = 0
  const entries = new Map()

  const advance = (milliseconds) => {
    nowMs += Math.max(0, milliseconds)
    for (const [id, entry] of [...entries.entries()]) {
      if (!entry.cancelled && entry.fireAt <= nowMs) {
        entry.cancelled = true
        entries.delete(id)
        entry.resolve()
      }
    }
  }

  const delay = (milliseconds) => {
    const id = nextId
    nextId += 1
    let resolve
    const promise = new Promise((resolveValue) => { resolve = resolveValue })
    const entry = { fireAt: nowMs + Math.max(0, milliseconds), resolve, cancelled: false }
    entries.set(id, entry)
    let cancels = 0
    return {
      Delay: promise,
      Cancel: () => {
        cancels += 1
        if (!entry.cancelled) {
          entry.cancelled = true
          entries.delete(id)
        }
      },
      get cancels() { return cancels },
    }
  }

  return { delay, advance }
}
