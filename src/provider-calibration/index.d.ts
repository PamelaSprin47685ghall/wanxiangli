/** Provider 观测状态由库维护；写入值来自真实宿主观测。 */
export interface CalibrationMessages {
  recordUsage(sessionId: string, cached: number, uncached: number): void
  recordLimit(sessionId: string, contextTokens: number): void
  usage(sessionId: string): { cached: number; uncached: number } | null
  limit(sessionId: string): number | null
  clearSession(sessionId: string): void
  clearAll(): void
}

export const ProviderCalibration: CalibrationMessages
