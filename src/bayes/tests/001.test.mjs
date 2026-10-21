import test from 'node:test'
import assert from 'node:assert/strict'

import { BayesLaw } from 'wanxiangli/bayes'

const law = new BayesLaw()
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`)
const H = (...pairs) => pairs.map(([key, prior]) => ({ key, prior }))
const two = () => H(['h1', 0.5], ['h2', 0.5])
const F = (likelihoods, observationId = 'o1', dependencyKey = 'dep-1', qualified = true) => ({ observationId, dependencyKey, likelihoods, qualified })
const fault = (result) => { assert.equal(result.ok, false); return result.fault }
const post = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.posterior }

test('SPEC[bayes-1] every contract defect is a typed fault', () => {
  assert.deepEqual(fault(law.infer(H(['h1', 1]), [F({ h1: 1 })])), { kind: 'TooFewHypotheses', count: 1 })
  assert.deepEqual(fault(law.infer(H([' ', 1], ['h2', 1]), [F({ h2: 1 })])), { kind: 'BlankHypothesisKey' })
  // the fault names the key that is actually repeated (the old in-repo law named the first key)
  assert.deepEqual(fault(law.infer(H(['a', 1], ['b', 1], ['b', 1]), [])), { kind: 'DuplicateHypothesisKey', key: 'b' })
  for (const bad of [-1, NaN, Infinity]) assert.deepEqual(fault(law.infer(H(['h1', bad], ['h2', 1]), [F({ h1: 1, h2: 1 })])), { kind: 'InvalidPrior', key: 'h1' })
  assert.deepEqual(fault(law.infer(H(['h1', 0], ['h2', 0]), [F({ h1: 1, h2: 1 })])), { kind: 'ZeroPriorMass' })
  assert.deepEqual(fault(law.infer(two(), [])), { kind: 'NoQualifiedFactor' })
  assert.deepEqual(fault(law.infer(two(), [F({ h1: 1, h2: 1 }, 'o1', 'dep', false)])), { kind: 'NoQualifiedFactor' })
  assert.deepEqual(fault(law.infer(two(), [F({ h1: 1, h2: 1 }, 'o1', '  ')])), { kind: 'BlankDependencyKey', semanticKey: '  ' })
  assert.deepEqual(fault(law.infer(two(), [F({ h1: 1, h2: 1, h3: 1 })])), { kind: 'UnknownHypothesisKey', semanticKey: 'o1', key: 'h3' })
  assert.deepEqual(fault(law.infer(two(), [F({ h1: 1 })])), { kind: 'IncompleteLikelihood', semanticKey: 'o1', missingKey: 'h2' })
  for (const bad of [1.5, -0.1, NaN]) assert.deepEqual(fault(law.infer(two(), [F({ h1: bad, h2: 1 })])), { kind: 'InvalidLikelihood', semanticKey: 'o1', key: 'h1' })
  assert.deepEqual(fault(law.infer(two(), [F({ h1: 0, h2: 0 })])), { kind: 'NonPositivePartition' })
  // structurally malformed input throws instead of being guessed
  assert.throws(() => law.infer('h1', []), /malformed hypotheses/)
  assert.throws(() => law.infer([{ key: 1, prior: 1 }, { key: 'b', prior: 1 }], []), /malformed hypothesis.key/)
  assert.throws(() => law.infer(two(), [{ observationId: 'o', dependencyKey: 'd', likelihoods: { h1: '1' }, qualified: true }]), /malformed factor.likelihoods.h1/)
})

test('SPEC[bayes-2] one observation id is one observation; a second id in the group is dropped and reported', () => {
  const once = post(law.infer(two(), [F({ h1: 0.8, h2: 0.4 })]))
  const twice = post(law.infer(two(), [F({ h1: 0.8, h2: 0.4 }), F({ h1: 0.8, h2: 0.4 })]))
  assert.deepEqual(twice, once)
  assert.deepEqual(once.usedObservations, ['o1'])
  const grouped = post(law.infer(two(), [F({ h1: 0.8, h2: 0.4 }, 'o1'), F({ h1: 0.1, h2: 0.9 }, 'o2')]))
  assert.deepEqual(grouped.usedObservations, ['o1'])
  assert.deepEqual(grouped.dropped, [['o2', 'conservative-rule: joint factor not declared']])
  // different groups both count
  const both = post(law.infer(two(), [F({ h1: 0.8, h2: 0.4 }, 'o1', 'g1'), F({ h1: 0.5, h2: 0.25 }, 'o2', 'g2')]))
  assert.deepEqual(both.usedObservations, ['o1', 'o2'])
  close(both.probabilities.h1, 0.8)
})

test('SPEC[bayes-3] the posterior is the normalized log-space product and does not underflow', () => {
  const p = post(law.infer(two(), [F({ h1: 0.8, h2: 0.4 })]))
  close(p.probabilities.h1, 2 / 3); close(p.probabilities.h2, 1 / 3)
  close(p.logPartition, Math.log(0.5 * 0.8 + 0.5 * 0.4))
  const tiny = post(law.infer(two(), [F({ h1: 2e-300, h2: 1e-300 }, 'a', 'g1'), F({ h1: 2e-300, h2: 1e-300 }, 'b', 'g2')]))
  close(tiny.probabilities.h1, 0.8)
  // counterexample: the naive product underflows to 0/0
  assert.ok(Number.isNaN((2e-300 * 2e-300) / (2e-300 * 2e-300 + 1e-300 * 1e-300)))
  const zero = post(law.infer(H(['h1', 0], ['h2', 1], ['h3', 1]), [F({ h1: 1, h2: 0.5, h3: 0.25 })]))
  assert.equal(zero.probabilities.h1, 0)
  close(zero.probabilities.h2 + zero.probabilities.h3, 1)
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.probabilities))
})

test('SPEC[bayes-4] a prior-only run is the normalized prior, uses no observation, and keeps the hypothesis contract', () => {
  const p = post(law.priorOnly(H(['h1', 1], ['h2', 3])))
  assert.deepEqual(p, { probabilities: { h1: 0.25, h2: 0.75 }, logPartition: 0, usedObservations: [], dropped: [] })
  assert.deepEqual(fault(law.priorOnly(H(['h1', 1]))), { kind: 'TooFewHypotheses', count: 1 })
  assert.deepEqual(fault(law.priorOnly(H(['h1', 1], ['h1', 1]))), { kind: 'DuplicateHypothesisKey', key: 'h1' })
  assert.deepEqual(fault(law.priorOnly(H(['h1', 0], ['h2', 0]))), { kind: 'ZeroPriorMass' })
  assert.equal(law.contractVersion, 1)
})
