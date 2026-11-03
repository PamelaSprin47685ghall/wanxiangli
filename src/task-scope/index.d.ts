export type DrainResult = { ok: true } | { ok: false; error: unknown }

export declare class TaskScope {
  constructor()
  run(work: () => Promise<void>): Promise<void>
  background(work: () => Promise<void>): Promise<void>
  waitIdle(): Promise<DrainResult>
  close(): Promise<DrainResult>
}
