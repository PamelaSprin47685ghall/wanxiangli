/**
 * Maps a snapshot of the input members, with a separate limit for each call.
 * Results keep input order. A first rejection returns early; other work can continue.
 * Cancellation is checked before queueing and after acquiring a permit. Queued work
 * waits for its permit before observing a later abort. Running actions own their response
 * to cancellation. The exact supplied signal reaches every action; omission creates one.
 */
export declare function mapBounded<T, U>(
  maxConcurrency: number,
  action: (item: T, signal: AbortSignal) => Promise<U>,
  items: readonly T[],
  signal?: AbortSignal,
): Promise<U[]>
