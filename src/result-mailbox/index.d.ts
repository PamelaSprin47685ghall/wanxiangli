export type JoinResult<T, I> =
  | { kind: 'items'; items: T[] }
  | { kind: 'empty' }
  | { kind: 'interrupted'; reason: I }

export type JoinStart<T, I> =
  | { kind: 'ready'; result: JoinResult<T, I> }
  | { kind: 'pending'; completion: Promise<JoinResult<T, I>> }

export declare class ResultMailbox<T, I> {
  constructor()
  start(): void
  publish(value: T): void
  drain(maxCount: number): T[]
  readonly hasActive: boolean
  readonly pendingCount: number
  beginJoin(maxCount: number, interrupt: Promise<I>): JoinStart<T, I>
}
