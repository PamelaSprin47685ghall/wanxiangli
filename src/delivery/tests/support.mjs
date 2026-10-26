import assert from 'node:assert/strict'
import { Delivery, JsDeliveredValues, jsDeliveredValues } from '../../../dist/delivery/Delivery.js'

export { Delivery, JsDeliveredValues, jsDeliveredValues }
export const fence = (providerRun = 'run-1', toolCallId = 'call-1') => ({ providerRun, toolCallId })
export const piece = (key, text = `text of ${key}`) => ({ key, text })
export const keys = pieces => pieces.map(value => value.key)

/** claim 成功时取出凭据；失败时把确切原因交给断言。 */
export function claimed(delivery, sessionId, request) {
  const outcome = delivery.claim(sessionId, request)
  assert.equal(outcome.ok, true, `expected a claim, got ${outcome.reason}`)
  return outcome.ticket
}

/** claim 失败时返回确切原因。 */
export function refusal(delivery, sessionId, request) {
  const outcome = delivery.claim(sessionId, request)
  assert.equal(outcome.ok, false, 'expected the claim to be refused')
  return outcome.reason
}
