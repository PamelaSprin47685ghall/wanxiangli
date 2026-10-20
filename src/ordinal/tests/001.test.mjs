import test from 'node:test'
import assert from 'node:assert/strict'

import { OrdinalLaw } from 'wanxiangli/ordinal'

const law = new OrdinalLaw()
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`)
const sigmoid = (x) => 1 / (1 + Math.exp(-x))

test('SPEC[ordinal-1] log-space primitives stay finite where the naive form produces log(0)', () => {
  assert.equal(law.logSigmoid(0), -Math.LN2)
  close(law.logSigmoid(1000), 0)
  assert.equal(law.logSigmoid(-1000), -1000)
  for (const x of [-30, -2.5, -0.1, 0.3, 4, 25]) close(law.logSigmoid(x), Math.log(sigmoid(x)), 1e-12)
  close(law.logSumExp(1000, 1000), 1000 + Math.LN2)
  close(law.logSumExp(-1000, 0), 0)
  for (const [a, b] of [[1, 2], [-3, 0.5], [7, 7]]) close(law.logSumExp(a, b), Math.log(Math.exp(a) + Math.exp(b)), 1e-12)
  // counterexample: the naive form underflows to -Infinity
  assert.equal(Math.log(sigmoid(-1000)), -Infinity)
})

test('SPEC[ordinal-2] directional BTL likelihood and its gradient', () => {
  close(law.directionalLogLikelihood(0.9, 0.2, 0.5, 1), Math.log(sigmoid(0.9 - 0.2 + 0.5)))
  close(law.directionalLogLikelihood(0.9, 0.2, 0.5, -1), Math.log(sigmoid(0.9 - 0.2 - 0.5)))
  const [gw, gl, gb] = law.directionalGradient(0.3, 0.1, 0.5, 1)
  const r = sigmoid(0.3 - 0.1 + 0.5) - 1
  close(gw, r); close(gl, -r); close(gb, r)
  assert.ok(Array.isArray(law.directionalGradient(0, 0, 0, 0)))
  // numerical derivative agrees
  const h = 1e-6, f = (t) => law.directionalLogLikelihood(t, 0.1, 0.5, 1)
  close((f(0.3 + h) - f(0.3 - h)) / (2 * h), -gw, 1e-6)
})

test('SPEC[ordinal-3] tie-aware likelihood is a proper three-way softmax that reduces to BTL as kappa -> -inf', () => {
  for (const [tl, tr, beta, pos, kappa] of [[0.7, 0.2, 0, 0, -0.5], [-1, 2, 0.3, 1, 1.2], [0, 0, 0, 0, 0]]) {
    const win = law.tieAwareLogLikelihood(tl, tr, beta, pos, kappa, false)
    const tie = law.tieAwareLogLikelihood(tl, tr, beta, pos, kappa, true)
    const lose = law.tieAwareLogLikelihood(tr, tl, beta, -pos, kappa, false)
    close(Math.exp(win) + Math.exp(tie) + Math.exp(lose), 1, 1e-12)
  }
  close(law.tieAwareLogLikelihood(0.7, 0.2, 0, 0, -1000, false), law.logSigmoid(0.5), 1e-12)
  // counterexample: a tie is not a half win — its probability is driven by kappa
  assert.ok(law.tieAwareLogLikelihood(0, 0, 0, 0, 3, true) > law.tieAwareLogLikelihood(0, 0, 0, 0, -3, true))
})

test('SPEC[ordinal-4] ranking likelihoods: Plackett–Luce needs a complete strict order, MaxDiff a known set', () => {
  const theta = { a: 1, b: 0, c: -1 }
  const z = Math.exp(1) + 1 + Math.exp(-1)
  close(law.plackettLuceLogProbability(theta, ['a', 'b', 'c']), 1 - Math.log(z) + (0 - Math.log(1 + Math.exp(-1))))
  assert.equal(law.plackettLuceLogProbability({ a: 1, b: 0 }, ['a', 'b', 'c']), null)
  const pairs = [[1, 2], [2, 1], [-1, 1], [1, -1], [-2, -1], [-1, -2]].map(([x]) => x)
  void pairs
  const all = []
  for (const i of ['a', 'b', 'c']) for (const j of ['a', 'b', 'c']) if (i !== j) all.push(Math.exp(theta[i] - theta[j]))
  close(law.maxDiffLogProbability(theta, ['a', 'b', 'c'], 'a', 'c'), Math.log(Math.exp(2) / all.reduce((s, v) => s + v, 0)))
  assert.equal(law.maxDiffLogProbability({ a: 1 }, ['a', 'b'], 'a', 'b'), null)
})

test('SPEC[ordinal-5] composite pairs keep ranked order; Borda is a descriptive mean of points', () => {
  assert.deepEqual(law.compositePairs(['a', 'b', 'c']), [['a', 'b'], ['a', 'c'], ['b', 'c']])
  assert.deepEqual(law.compositePairs(['a']), [])
  assert.deepEqual({ ...law.bordaCounts([['a', 'b', 'c'], ['b', 'a', 'c']], ['a', 'b', 'c', 'z']) }, { a: 2.5, b: 2.5, c: 1, z: 0 })
  assert.throws(() => law.compositePairs('abc'), /malformed order/)
  assert.throws(() => law.logSigmoid(Number.NaN), /malformed x/)
})
