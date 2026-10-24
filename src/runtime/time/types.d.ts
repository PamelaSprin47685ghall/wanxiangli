/// 不透明 Deadline 值：只能由 deadlineCreate 构造，经 deadlineRemainingMs /
/// deadlineIsExpired / deadlineNextWaitMs 读取。
export type Deadline = unknown

export interface IDeadlineHandle {
  readonly Delay: Promise<void>
  Cancel(): void
}

export interface ITimerPort {
  /** 返回可取消的一次性截止句柄；毫秒为非负安全整数。 */
  Delay(milliseconds: number): IDeadlineHandle
  Dispose(): void
}

export interface IClockPort {
  UtcNow(): string
}

export interface VirtualTimerPort {
  readonly port: ITimerPort
  advance(milliseconds: number): void
  nowMs(): number
}

export interface VirtualClockPort {
  readonly port: IClockPort
  advanceMs(milliseconds: number): void
  set(value: string): void
}

export const Time: {
  /** JS setTimeout 的 Int32 上限；更长的等待必须分段。 */
  readonly maxTimerWaitMs: number
  /** 以 ISO 时刻与毫秒预算构造不透明截止时间。 */
  deadlineCreate(nowIso: string, budgetMs: number): Deadline
  deadlineRemainingMs(nowIso: string, deadline: Deadline): number
  deadlineIsExpired(nowIso: string, deadline: Deadline): boolean
  deadlineNextWaitMs(nowIso: string, deadline: Deadline): number
  /** 物理定时器端口（唯一封装 setTimeout/clearTimeout 的实例）。 */
  nodeTimerPort(): ITimerPort
  /** 物理墙钟端口（唯一读取系统 UtcNow 的实例）。 */
  nodeClockPort(): IClockPort
  /** 单次延迟任务；≥1000ms unref。 */
  timerTask(milliseconds: number): Promise<void>
  /** 竞争退出任务与延迟：退出先到 true，延迟先到 false。 */
  raceExit(exitTask: Promise<unknown>, milliseconds: number): Promise<boolean>
  /** 验证专用：确定性虚拟时基。生产组合层不得注入。 */
  virtualTimerPort(): VirtualTimerPort
  /** 验证专用：确定性虚拟墙钟。 */
  virtualClockPort(): VirtualClockPort
}
