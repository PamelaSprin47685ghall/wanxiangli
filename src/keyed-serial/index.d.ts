/**
 * Per-instance, in-process FIFO for calls with the same opaque key.
 * Enqueueing is synchronous; actions always start asynchronously. Different keys
 * and instances remain independent. Settled actions release successors even on
 * failure; results and rejection reasons retain their identity.
 * An action may enqueue a same-key successor, but must not await it before ending.
 */
export declare class KeyedSerial {
  constructor()
  run<T>(key: string, action: () => Promise<T>): Promise<T>
}
