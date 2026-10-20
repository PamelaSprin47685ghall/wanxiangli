/**
 * wanxiangli/routing — 模型调度器协议 owner（CUT-10）。
 *
 * 只管 ABI：MJS 模块的导出形状与协议版本、同步调用 route(role, running, previous)、
 * target 的严格解码、理论容量查询的结果类型。不读文件、不 import 模块、不持有容量账本；
 * 模型选择与并发上限全部属于用户 MJS（execution-model-routing [005]）。
 * 所有错误都是 `Error`，消息以 `execution-model-routing:` 开头，调用方按配置错误 fail closed。
 */

/** 调度目标：`model` 是修剪后的完整 `provider/model`，`reasoning` 是修剪后的非空字符串。 */
export interface ModelTarget {
  readonly model: string
  readonly reasoning: string
}

/** 已校验的调度策略（冻结）。 */
export interface SchedulerPolicy {
  readonly route: (role: string, running: readonly ModelTarget[], previous: ModelTarget | null) => unknown
  readonly hasTheoreticalCapacity: (role: string) => unknown
  /** 未导出时为 null。 */
  readonly markProviderFailed: ((provider: string) => unknown) | null
}

export declare class RoutingProtocol {
  /** 协议版本：2。 */
  readonly version: 2
  /**
   * 校验 MJS 模块命名空间：default 是函数，`routingProtocol === 2`（数字），
   * `hasTheoreticalCapacity` 是函数；`markProviderFailed` 可省略，出现时必须是函数。
   */
  admit(moduleNamespace: unknown): SchedulerPolicy
  /**
   * 以恰好三个参数调用 route。role 修剪且非空；running 与 previous 逐项严格解码并以冻结副本交出。
   * 返回 Promise、抛错或非法 target 一律抛错；null / undefined 表示“等待”，交还 null。
   */
  route(route: unknown, role: string, running: readonly ModelTarget[], previous: ModelTarget | null): ModelTarget | null
  /** 以恰好一个参数调用理论容量查询；结果必须是布尔，Promise 或其它值抛错。 */
  hasTheoreticalCapacity(query: unknown, role: string): boolean
  /** 严格解码 target，交还修剪后的冻结副本；null、空字段、非 provider/model 抛错。 */
  decodeTarget(value: unknown): ModelTarget
  /** 解码持久道路的 `provider/model:reasoning`（最后一个 ':' 分隔：模型名可以含 ':'）；规则同 decodeTarget。 */
  decodeDurableTarget(value: string): ModelTarget
  /** target 的 provider（model 中第一个 '/' 之前）；target 先严格解码。 */
  providerOf(target: ModelTarget): string
}
