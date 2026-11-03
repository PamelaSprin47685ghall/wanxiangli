import assert from 'node:assert/strict'
import test from 'node:test'
import { CasebookState, CasebookIndexLaw, normalizeObservations, sameObservations } from 'wanxiangli/casebook'

const read = (path, contentHash) => ({ kind: 'file-read', path, contentHash })
const item = (identity, fields = {}) => ({
  identity, sourceTrace: `trace:${identity}`, q: `question ${identity}`, a: `answer ${identity}`,
  relatedPaths: ['original.txt'], completionFileState: 'completion', maintenanceFileState: 'maintenance',
  accessOrder: 9223372036854775807n, observations: [read('original.txt', 'hash')], ...fields,
})
const capture = (state, value) => state.apply({ kind: 'captured', case: value })
const refresh = (identity, fields = {}) => ({
  kind: 'refreshed', identity, q: '', a: '', maintenanceFileState: '', relatedPaths: [], observations: [], ...fields,
})
const all = state => state.visible(0).cases
const law = new CasebookIndexLaw()

test('capture creates independent immutable states and replaces a logical case at the next access order', () => {
  const empty = new CasebookState()
  const first = capture(empty, item('one'))
  const branch = capture(empty, item('branch'))
  const replaced = capture(first, item('one', { q: 'replacement', sourceTrace: 'new source' }))
  assert.deepEqual(all(empty), [])
  assert.equal(all(first)[0].q, 'question one')
  assert.equal(all(first)[0].accessOrder, 0n)
  assert.equal(all(branch)[0].accessOrder, 0n)
  assert.equal(all(replaced).length, 1)
  assert.equal(all(replaced)[0].q, 'replacement')
  assert.equal(all(replaced)[0].sourceTrace, 'new source')
  assert.equal(all(replaced)[0].accessOrder, 1n)
})

test('refresh accepts empty answers, preserves empty maintenance and paths, and clears empty observations', () => {
  const original = capture(new CasebookState(), item('one'))
  const empty = original.apply(refresh('one'))
  assert.deepEqual(all(empty)[0], item('one', {
    q: '', a: '', accessOrder: 1n, observations: [],
  }))
  const nullMaintenance = empty.apply(refresh('one', { maintenanceFileState: null }))
  assert.equal(all(nullMaintenance)[0].maintenanceFileState, 'maintenance')
  const updated = nullMaintenance.apply(refresh('one', {
    q: 'new Q', a: 'new A', maintenanceFileState: 'new maintenance', relatedPaths: ['new.txt'],
    observations: [read('z', '2'), read('a', '1'), read('a', '1')],
  }))
  assert.deepEqual(all(updated)[0], item('one', {
    q: 'new Q', a: 'new A', maintenanceFileState: 'new maintenance', relatedPaths: ['new.txt'],
    accessOrder: 3n, observations: [read('a', '1'), read('z', '2')],
  }))
  assert.equal(all(original)[0].q, 'question one')
})

test('only capture and an existing refresh or access consume the access sequence', () => {
  const empty = new CasebookState()
  assert.equal(empty.apply(refresh('missing')), empty)
  assert.equal(empty.apply({ kind: 'accessed', identity: 'missing' }), empty)
  const first = capture(empty.apply({ kind: 'evicted', identity: 'missing' }), item('one'))
  const touched = first.apply({ kind: 'accessed', identity: 'one' })
  assert.deepEqual(all(touched)[0], { ...all(first)[0], accessOrder: 1n })
  const removed = touched.apply({ kind: 'evicted', identity: 'one' })
  assert.deepEqual(all(removed), [])
  const next = capture(removed.apply(refresh('missing')), item('two'))
  assert.equal(all(next)[0].accessOrder, 2n)
  assert.equal(all(first)[0].accessOrder, 0n)
})

test('visibility keeps Map key order, returns LRU victims, and does not mutate the projection', () => {
  const ids = ['ä', 'b', '😀', 'a', 'A']
  let state = new CasebookState()
  for (const identity of ids) state = capture(state, item(identity))
  assert.deepEqual(all(state).map(value => value.identity), [...ids].sort())
  for (const capacity of [-1, 0, 5, 9]) {
    assert.deepEqual(state.visible(capacity).victims, [])
    assert.equal(state.visible(capacity).cases.length, 5)
  }
  const visible = state.visible(2)
  assert.deepEqual(visible.victims, ['ä', 'b', '😀'])
  assert.deepEqual(visible.cases.map(value => value.identity), ['A', 'a'])
  assert.equal(all(state).length, 5)
  const touched = state.apply({ kind: 'accessed', identity: 'ä' })
  assert.deepEqual(touched.visible(2).victims, ['b', '😀', 'a'])
  assert.deepEqual(touched.visible(2).cases.map(value => value.identity), ['A', 'ä'])
})

test('resolve uses the same visible cases while shelfmark sorting differs from identity sorting', () => {
  let state = capture(new CasebookState(), item('a', { q: 'Zebra' }))
  state = capture(state, item('z', { q: 'Apple' }))
  const zebra = law.shelfmarkFor('a', 'Zebra')
  const apple = law.shelfmarkFor('z', 'Apple')
  assert.equal(state.resolve(0, zebra).identity, 'a')
  assert.equal(state.resolve(0, apple).identity, 'z')
  assert.equal(state.resolve(1, zebra), null)
  assert.equal(state.resolve(1, apple).identity, 'z')
  assert.equal(state.resolve(0, 'unknown'), null)
})

test('observation normalization keeps the first duplicate and its original nested ordering', () => {
  const glob = { kind: 'glob-result', pattern: '*', paths: ['z', 'a'] }
  const grep = { kind: 'grep-result', pattern: 'x', matches: [['z', 2, 'second'], ['a', 1, 'first']] }
  const observations = [read('z', '2'), grep, glob,
    { ...glob, paths: ['a', 'z'] }, { ...grep, matches: [...grep.matches].reverse() }, read('a', '1')]
  assert.deepEqual(normalizeObservations(observations), [glob, grep, read('a', '1'), read('z', '2')])
  const state = capture(new CasebookState(), item('one', { observations }))
  assert.deepEqual(all(state)[0].observations, [glob, grep, read('a', '1'), read('z', '2')])
  assert.equal(sameObservations(observations, [...observations].reverse()), true)
  assert.equal(sameObservations(observations, observations.slice(1)), false)
  assert.equal(sameObservations([], []), true)
})

test('observation identity retains the original delimiter collisions and duplicate set semantics', () => {
  const first = read('a:b', 'c')
  const second = read('a', 'b:c')
  assert.deepEqual(normalizeObservations([first, second]), [first])
  assert.equal(sameObservations([first, first], [second]), true)
  assert.equal(sameObservations(
    [{ kind: 'glob-result', pattern: '*', paths: ['a,b'] }],
    [{ kind: 'glob-result', pattern: '*', paths: ['a', 'b'] }]), true)
})

test('input and output arrays cannot change a captured state, later refresh, or normalized observations', () => {
  const glob = { kind: 'glob-result', pattern: '*', paths: ['z', 'a'] }
  const grep = { kind: 'grep-result', pattern: 'x', matches: [['file', 2, 'text']] }
  const source = item('one', { observations: [glob, grep] })
  const expected = structuredClone(source)
  expected.accessOrder = 0n
  const state = capture(new CasebookState(), source)
  source.relatedPaths.push('outside')
  glob.paths[0] = 'outside'
  grep.matches[0][2] = 'outside'
  source.observations.length = 0
  assert.deepEqual(all(state), [expected])
  const result = state.visible(0)
  result.cases[0].relatedPaths.length = 0
  result.cases[0].observations[0].paths.push('outside')
  result.cases[0].observations[1].matches[0][0] = 'outside'
  result.cases.length = 0
  const resolved = state.resolve(0, law.shelfmarkFor('one', expected.q))
  resolved.observations[1].matches.length = 0
  assert.deepEqual(all(state), [expected])
  const event = refresh('one', { relatedPaths: ['next'], observations: [read('next', 'hash')] })
  const updated = state.apply(event)
  event.relatedPaths.push('outside')
  event.observations[0].contentHash = 'outside'
  assert.deepEqual(all(updated)[0].relatedPaths, ['next'])
  assert.deepEqual(all(updated)[0].observations, [read('next', 'hash')])
  const observations = [{ kind: 'grep-result', pattern: 'x', matches: [['file', 2, 'text']] }]
  const normalized = normalizeObservations(observations)
  normalized[0].matches[0][2] = 'outside'
  assert.equal(observations[0].matches[0][2], 'text')
})
