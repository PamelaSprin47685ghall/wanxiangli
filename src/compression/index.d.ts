export type Carry = readonly (number | string)[]

export interface AnchorView {
  /** Exclusive position in visible history: preserve its first N entries. Not an anchor ID. */
  readonly prefixUntil: number
  /** Render in order after the preserved prefix; numbers reference anchors and strings are literals. */
  readonly carry: Carry
}

export type ParsedView =
  | { readonly ok: true; readonly view: AnchorView }
  | { readonly ok: false; readonly reason: string }

export type ParsedCarry =
  | { readonly ok: true; readonly carry: Carry }
  | { readonly ok: false; readonly reason: string }

export interface CheckpointCall {
  readonly session: string
  readonly callId: string
}

export interface CheckpointTerminal extends CheckpointCall {
  readonly status: 'completed' | 'error'
}

export type CheckpointAppendOutcome =
  | 'committed'
  | 'WriterUnavailable'
  | 'WriteUnknown'
  | 'NoNewWriteReleaseFailed'
  | 'FactRejected'

export interface CheckpointSettlementMessages {
  observe(terminal: CheckpointTerminal): 'append' | 'join' | 'skip'
  settle(call: CheckpointCall, outcome: CheckpointAppendOutcome): 'settled' | 'released' | 'failed'
}

export interface CompressionMessages {
  /** Validates shape; the Host must additionally reject prefixUntil greater than its visible history length. */
  parseView(value: unknown): ParsedView
  parseCarry(value: unknown): ParsedCarry
  checkpoints(): CheckpointSettlementMessages
}

export function Compression(): CompressionMessages
