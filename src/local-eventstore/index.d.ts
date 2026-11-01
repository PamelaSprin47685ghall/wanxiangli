import type { CodecError, EventInput, EventOutput } from 'wanxiangli/events'

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

/** A rule owns one opaque slot. The store does not copy or interpret its value. */
export interface IntegrationRule<T = unknown> {
  readonly name: string
  readonly initial: T
  accepts(event: EventOutput): boolean
  faultScope(event: EventOutput): string
  integrate(current: T, event: EventOutput): Result<T>
  planCut(current: T, event: EventOutput, reason: string, afterFullReplay: boolean): Result<{ resetJson: string }>
  applyCut(current: T, resetJson: string): Result<T>
}

export interface SemanticCut {
  readonly rule: string
  readonly failedEventId: string
  readonly reason: string
  readonly cutEventId: string
}
export interface PreparedAppend {
  readonly durableEvents: EventOutput[]
  readonly cuts: SemanticCut[]
}
export interface PreparedIntegration extends PreparedAppend {
  /** Commits this candidate only while the Current reference it read remains current. */
  commit(): void
}

/** The narrow stateful protocol also permits an adapter that decorates commit. */
export interface Integrator {
  reload(directory: () => string): Result<void>
  prepare(events: readonly EventInput[]): Result<PreparedIntegration>
  isKnownEventType(eventType: string): boolean
  current(slot: string): unknown | null
  event(id: string): EventOutput | null
  payload(reference: string): Uint8Array | null
  heads(stream: string): string[]
  head(stream: string): string | null
  allHeads(): string[]
}

export interface IntegratorOptions {
  readonly rules: readonly IntegrationRule[]
  readonly isKnownEventType: (eventType: string) => boolean
  /** Optional host diagnostic formatting; it does not choose storage outcomes. */
  readonly formatStorageError?: (error: CodecError) => string
}

/** Owns Current, event/payload indexes, rule slots and optimistic candidates. */
export declare class LocalIntegrator implements Integrator {
  constructor(options: IntegratorOptions)
  reload(directory: () => string): Result<void>
  prepare(events: readonly EventInput[]): Result<PreparedIntegration>
  isKnownEventType(eventType: string): boolean
  current(slot: string): unknown | null
  event(id: string): EventOutput | null
  payload(reference: string): Uint8Array | null
  heads(stream: string): string[]
  head(stream: string): string | null
  allHeads(): string[]
}

export type AppendPhase =
  | 'GateAcquire' | 'Preparation' | 'BeforePhysicalAppend' | 'PhysicalAppend'
  | 'DurabilityOpen' | 'DurabilityBarrier' | 'DurabilityClose' | 'CurrentCommit' | 'StoreRelease'
export interface AppendFault {
  readonly phase: AppendPhase
  readonly cause: unknown
}
export type PreWriteRejection =
  | { readonly kind: 'StorageInvalid'; readonly invalid: CodecError }
  | { readonly kind: 'PreparationRejected'; readonly reason: string }
export type AppendError =
  | { readonly kind: 'StorageInvalid'; readonly invalid: CodecError }
  | { readonly kind: 'AppendFailed'; readonly reason: string }
  | {
      readonly kind: 'AppendNotAttempted'
      readonly requested: EventOutput[]
      readonly prepared: PreparedAppend | null
      readonly primary: AppendFault
      readonly cleanupFailures: AppendFault[]
      readonly priorRejection: PreWriteRejection | null
    }
  | {
      readonly kind: 'CommitUnknown'
      readonly requested: EventOutput[]
      readonly prepared: PreparedAppend
      readonly primary: AppendFault
      readonly cleanupFailures: AppendFault[]
    }
  | {
      readonly kind: 'NoNewWriteReleaseFailed'
      readonly requested: EventOutput[]
      readonly prepared: PreparedAppend | null
      readonly cause: unknown
    }
export interface AppendReceipt { readonly cuts: SemanticCut[] }
export interface LocalEventStoreOptions {
  /** Produces the event directory at each physical operation. */
  readonly directory: () => string
  /** Produces the shared cross-process lock directory. */
  readonly lockTarget: () => string
  readonly writerId: string
  readonly segmentCap: number
  readonly integrator: Integrator
}

/** Loads synchronously when constructed; the caller controls lazy construction. */
export declare class LocalEventStore {
  constructor(options: LocalEventStoreOptions)
  append(events: readonly EventInput[]): Promise<Result<AppendReceipt, AppendError>>
  writePayload(content: Uint8Array): Promise<Result<string>>
  readPayload(reference: string): Promise<Result<Uint8Array | null>>
  current(slot: string): unknown | null
  event(id: string): EventOutput | null
  heads(stream: string): string[]
  head(stream: string): string | null
  allHeads(): string[]
  reload(): Result<void>
}

import type { SegmentedWriter, SegmentedWriterOptions, StreamsReadResult, WriterPhysicalMetadata } from 'wanxiangli/segments'

export type PhysicalAppendResult =
  | { readonly ok: true; readonly completion: 'no-append' | 'durable' }
  | {
      readonly ok: false
      readonly kind: 'before-append' | 'after-append'
      readonly primary: AppendFault
      readonly cleanupFailures: AppendFault[]
    }

export interface LocalLock {
  release(): Promise<void>
}

/** Reuses this entry's process-wide physical reader. The caller supplies the retention time. */
export declare function readLocalStreams(directory: () => string, nowMs: number): StreamsReadResult
export declare function localWriterMetadata(directory: () => string): WriterPhysicalMetadata[]
export declare function localInventory(directory: () => string): string
/** The caller holds the shared store lock while reorganizing the writer's files. */
export declare function convergeLocalWriter(directory: () => string, writerId: string, segmentCap: number):
  { readonly ok: true } | { readonly ok: false; readonly reason: string }
/** Creates the lock target directory, then acquires it with the existing 30 second budget. */
export declare function acquireLocalLock(lockTarget: () => string): Promise<LocalLock>
export declare function createLocalWriter(options: SegmentedWriterOptions): SegmentedWriter
export declare function appendLocalEvents(writer: SegmentedWriter, events: readonly EventInput[]): PhysicalAppendResult
export declare function localPayloadDigest(bytes: Uint8Array): string
