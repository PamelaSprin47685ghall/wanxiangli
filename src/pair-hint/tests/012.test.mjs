import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

test('SPEC[pair-hint-012] exact KPI enum maps requested next scope budget to deterministic factors', () => {
  const subject = PairHint()
  const cases = [
    ['not_started', 50],
    ['far_below', 75],
    ['partially_met', 90],
    ['met', 100],
    ['exceeded', 125],
    ['not_applicable', 100],
  ]
  for (const [level, expected] of cases) {
    assert.equal(subject.adjustBudgetForKpi(100, level), expected, level)
    assert.equal(subject.adjustBudgetForKpi(0, level), 0, level)
    assert.equal(subject.adjustBudgetForKpi(1, level), Math.ceil(expected / 100), 'positive tiny budget is never silently rounded down')
  }
  assert.equal(subject.adjustBudgetForKpi(7, 'partially_met'), 7, 'ceil prevents silent reduction below a fractional turn')
  assert.equal(subject.adjustBudgetForKpi(7, 'exceeded'), 9)
  assert.equal(subject.adjustBudgetForKpi(2147483647, 'exceeded'), 2147483647, 'budget integer overflow is clipped')
  assert.throws(() => subject.adjustBudgetForKpi(-1, 'met'), /negative|budget/i)
  assert.throws(() => subject.adjustBudgetForKpi(5, 'unspecified'), /kpiCompletion|Unknown/)
  assert.throws(() => subject.adjustBudgetForKpi(5, 'EXCEEDED'), /kpiCompletion|Unknown/)
})
