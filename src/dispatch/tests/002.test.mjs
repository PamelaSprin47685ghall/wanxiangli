import test from 'node:test'
import assert from 'node:assert/strict'

import { Dispatch } from 'wanxiangli/dispatch'

const law = new Dispatch()

// Independent oracle written from dispatch-protocol [002][003][007][009].
const oracle = {
  AdmittedWithReceipt: { ledger: 'Submit', definitelyNotSent: false, detached: 'OwnedSettled' },
  AdmittedWithPhysicalMessage: { ledger: 'SubmitThenAccept', definitelyNotSent: false, detached: 'OwnedSettled' },
  Retryable: { ledger: 'Abandon', definitelyNotSent: true, detached: 'Refused' },
  Fatal: { ledger: 'Abandon', definitelyNotSent: true, detached: 'Refused' },
  AcceptanceUnknown: { ledger: 'KeepPending', definitelyNotSent: false, detached: 'OutcomeUnknown' },
}

test('SPEC[dispatch-6] a Host send answer decides exactly one ledger action and only a definite refusal is not-sent', () => {
  for (const [answer, expected] of Object.entries(oracle)) {
    const verdict = law.answer(answer)
    assert.deepEqual({ ...verdict }, expected, answer)
    assert.ok(Object.isFrozen(verdict))
  }
  for (const bad of ['accepted', 'Unknown', '', null, undefined, 3, {}]) assert.throws(() => law.answer(bad), /malformed send answer/)
})
