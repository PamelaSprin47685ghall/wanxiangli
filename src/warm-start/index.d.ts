/**
 * wanxiangli/warm-start — repository warm-start selection and budget law (CUT-29 ①).
 *
 * Which keyword lines are searched, which hits become hints, how hints of all keywords are
 * merged, de-duplicated and capped, and how many whole hints fit the byte budget. Pure: the
 * caller runs the searches, renders the document and measures its bytes. Never truncates an
 * entry; never searches when there is no keyword.
 */

export interface RankedHit<H> {
  readonly keywordOrdinal: number
  readonly localRank: number
  readonly hit: H
}

export interface HintIdentity {
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly content: string
}

export interface Search<T extends HintIdentity> {
  readonly ordinal: number
  readonly hints: readonly T[]
}

export interface Selection<S, T> {
  /** Searches in keyword-ordinal order (stable), by reference. */
  readonly searches: readonly S[]
  /** Stable de-duplicated hints in that order, at most maxHintsTotal, by reference. */
  readonly hints: readonly T[]
  /** Original hints that did not survive (duplicates and cap). */
  readonly omitted: number
}

export declare class WarmStartLaw {
  constructor()
  readonly contractVersion: 1
  /** 8 */
  readonly maxKeywords: number
  /** 4 */
  readonly topKPerKeyword: number
  /** 24 */
  readonly maxHintsTotal: number
  /** 65536 */
  readonly maxWarmStartBytes: number
  /** Canonical role labels 'engineer' and 'devops' only (repository-investigation-008). */
  isDirectConsumer(role: string): boolean
  /** CRLF/CR → LF, trim, drop blanks, case-sensitive first-wins de-duplication, at most maxKeywords. null → []. */
  normalizeKeywords(raw: string | null | undefined): string[]
  /** The first topKPerKeyword hits in search order, ranked 1..k; hits by reference. */
  rankHits<H>(ordinal: number, hits: readonly H[]): RankedHit<H>[]
  select<T extends HintIdentity, S extends Search<T>>(searches: readonly S[]): Selection<S, T>
  /**
   * Longest prefix of `count` hints whose document fits `budget` (default maxWarmStartBytes) as measured
   * by `measure(kept, omitted)`; each dropped hint adds one to omitted. null when zero hints do not fit.
   */
  fit(
    count: number,
    initialOmitted: number,
    measure: (kept: number, omitted: number) => number,
    budget?: number,
  ): { readonly kept: number; readonly omitted: number } | null
}
