import { Degeneration } from '../../../dist/degeneration/Degeneration.js'

export { Degeneration }
export const envelope = (overrides = {}) => ({
  vocabularySize: 100,
  lambda: 0.5,
  normalWeightedDistinctCount: 1.5,
  minimumWeightedDistinctCount: 1.2,
  maximumWeightedDistinctCount: 1.9,
  ...overrides,
})
