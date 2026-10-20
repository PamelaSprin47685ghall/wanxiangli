import test from 'node:test'
import assert from 'node:assert/strict'

import { CasebookIndexLaw } from 'wanxiangli/casebook'

const law = new CasebookIndexLaw()
// Reference: CASE-008 as the host wrote it — stable sort by access order, take the oldest overflow.
const reference = (capacity, cases) => {
  if (capacity <= 0 || cases.length <= capacity) return []
  return cases
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.accessOrder < b.item.accessOrder ? -1 : a.item.accessOrder > b.item.accessOrder ? 1 : a.index - b.index))
    .slice(0, cases.length - capacity)
    .map(entry => entry.item.sessionId)
}

test('SPEC[casebook-4] LRU eviction equals the reference on seeded random inputs', () => {
  let seed = 27
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let round = 0; round < 1000; round += 1) {
    const count = Math.floor(random() * 12)
    const big = random() < 0.5
    const cases = Array.from({ length: count }, (_, i) => {
      const order = Math.floor(random() * 6)
      return { sessionId: `s${String(i).padStart(2, '0')}`, accessOrder: big ? BigInt(order) : order }
    })
    const capacity = Math.floor(random() * 14) - 2
    assert.deepEqual(law.evictionVictims(capacity, cases), reference(capacity, cases), JSON.stringify({ capacity, round }))
  }
})

test('SPEC[casebook-4] boundary capacities evict nothing and malformed input refuses', () => {
  const cases = [{ sessionId: 'a', accessOrder: 2n }, { sessionId: 'b', accessOrder: 1n }]
  assert.deepEqual(law.evictionVictims(0, cases), [])
  assert.deepEqual(law.evictionVictims(2, cases), [])
  assert.deepEqual(law.evictionVictims(1, cases), ['b'])
  assert.throws(() => law.evictionVictims(1.5, cases))
  assert.throws(() => law.evictionVictims(1, [{ sessionId: 'a', accessOrder: NaN }]))
  assert.throws(() => law.evictionVictims(1, [{ sessionId: 'a' }]))
})
