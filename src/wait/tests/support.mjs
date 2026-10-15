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
