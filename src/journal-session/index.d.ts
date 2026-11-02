export interface SemanticCut {
  readonly rule: string
  readonly failedEventId: string
  readonly reason: string
  readonly cutEventId: string
  readonly original?: unknown
}

/** The original failure stays opaque; callers retain their own error representation. */
export type WriterFailure =
  | { readonly kind: 'CommitUnknown' | 'NoNewWriteReleaseFailed' | 'StorageInvalid' | 'AppendNotAttempted'; readonly original: unknown }
  | { readonly kind: 'AppendFailed'; readonly reason: string; readonly original: unknown }
  | { readonly kind: 'SemanticCut'; readonly cut: SemanticCut; readonly original: unknown }

export type WriterUnavailable =
  | { readonly kind: 'WriterDisposed' | 'WriterClosing' }
  | { readonly kind: 'WriterRefused'; readonly reason: string }
  | { readonly kind: 'WriterPoisoned'; readonly failedEventId: string; readonly error: WriterFailure }

export interface JournalCommitted {
  readonly kind: 'Committed'
  readonly eventId: string
  readonly sequence: bigint
  readonly envelope: unknown
}

export type JournalFailureOutcome<Failure = unknown, Unavailable = unknown> =
  | { readonly kind: 'Rejected'; readonly eventId: string; readonly reason: string }
  | { readonly kind: 'CommitUnknown'; readonly eventId: string; readonly error: Failure }
  | { readonly kind: 'NoNewWriteReleaseFailed'; readonly eventId: string; readonly error: Failure }
  | { readonly kind: 'NotAttempted'; readonly eventId: string; readonly unavailable: Unavailable }

export type JournalOutcome<Failure = unknown, Unavailable = unknown> =
  | JournalCommitted
  | JournalFailureOutcome<Failure, Unavailable>

export interface EnvelopeInput {
  readonly eventId: string
  readonly sequence: bigint
  readonly observedAt: unknown
  readonly request: unknown
}

export type InitializationSettlement =
  | { readonly kind: 'initialization-cut'; readonly cut: SemanticCut }
  | { readonly kind: 'initialization-error'; readonly error: WriterFailure }

export interface JournalWriterOptions {
  readonly initialization: { readonly eventId: string; readonly envelope: unknown }
  readonly newEventId: () => string
  readonly now: () => unknown
  readonly makeEnvelope: (input: EnvelopeInput) => unknown
  readonly commitEnvelope: (envelope: unknown) => Promise<
    { readonly ok: true; readonly value: { readonly cuts: readonly SemanticCut[] } }
    | { readonly ok: false; readonly error: WriterFailure }
  >
  readonly onSettlement?: (notice: InitializationSettlement) => void
}

/** Assigns sequences and drains the accepted append prefix when closed. */
export declare class JournalWriter {
  constructor(options: JournalWriterOptions)
  append(request: unknown): Promise<JournalOutcome<WriterFailure, WriterUnavailable>>
  localSeq(): bigint
  lastCommittedLocalSeq(): bigint
  isPoisoned(): boolean
  release(): void
  releaseAsync(): Promise<void>
}

export interface SessionWriter {
  append(request: unknown): Promise<JournalOutcome>
  isPoisoned(): boolean
  release(): void
  releaseAsync(): Promise<void>
}

export interface JournalChange {
  readonly revision: bigint
  readonly envelope: unknown
}

export interface JournalSessionOptions<Current = unknown> {
  readonly writer: SessionWriter
  readonly initialRevision: bigint
  readonly readCurrent: () => Current
  readonly refreshCurrent: () => unknown
  readonly onSettlement?: (outcome: JournalFailureOutcome) => void
}

export type SessionOutcome<Current = unknown> =
  | (JournalCommitted & { readonly current: Current })
  | JournalFailureOutcome

/** Owns local change notifications and recovery generations, not the caller's Current. */
export declare class JournalSession<Current = unknown> {
  constructor(options: JournalSessionOptions<Current>)
  append(request: unknown): Promise<SessionOutcome<Current>>
  snapshot(): Current
  revision(): bigint
  snapshotWithRevision(): { readonly current: Current; readonly revision: bigint }
  refreshCurrent(): unknown
  isPoisoned(): boolean
  awaitChange(fromRevision: bigint, registerCancel?: ((cancel: () => void) => (() => void)) | null): Promise<JournalChange | null>
  enqueueRecovery(start: () => Promise<void>): void
  runOrAwaitRecovery(): Promise<void>
  release(): void
  releaseAsync(): Promise<void>
}
