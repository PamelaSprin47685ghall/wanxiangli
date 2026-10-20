import { Delivery } from '../../../dist/delivery/Delivery.js'

export { Delivery }
export const fence = (providerRun = 'run-1', toolCallId = 'call-1') => ({ providerRun, toolCallId })
export const piece = (key, text = `text of ${key}`) => ({ key, text })
export const keys = pieces => pieces.map(value => value.key)
