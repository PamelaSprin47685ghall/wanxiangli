module Wanxiangli.Degeneration.RequestLatencyDetector

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// 无先验：阈值只来自本 session 自己的观测。
/// p99 至少要见过 100 条观测才有意义，此前是新手保护期，不打断（阈值 = +∞）。
[<Literal>]
let private ProtectionObservations = 100

[<Literal>]
let private Percentile = 0.99

/// 有效窗口长度：遗忘因子 γ = 1 − 1/EffectiveWindow，全部权重之和上限 Σγ^i = EffectiveWindow。
[<Literal>]
let private EffectiveWindow = 50.0

let private Decay = 1.0 - 1.0 / EffectiveWindow

/// 会话级估计的只读视图（Alpha = k，Beta = S，无先验）；每次调用构造新对象，外部修改不回流。
/// Observations / CompletedCount / CensoredCount / WindowMs 都是按 γ 衰减后的有效量（可为小数）。
type LatencySnapshot =
    { SessionId: string
      Observations: float
      /// 未衰减的原始观测条数（完整 + 删失），只用于新手保护期判定。
      Seen: int
      CompletedCount: float
      CensoredCount: float
      WindowMs: float
      Alpha: float
      Beta: float
      MeanMs: float
      ThresholdMs: float
      Percentile: float }

/// 指数分布（含右删失）的充分统计量：衰减完整样本数 k、衰减删失样本数 m、衰减总时长 S，
/// 外加原始观测条数 n（新手保护期）。O(1) 内存，不保存任何原始样本。
type private SufficientStats =
    { mutable Completed: float
      mutable Censored: float
      mutable TotalMs: float
      mutable Seen: int }

[<Emit("Number.isFinite($0)")>]
let private isFinite (value: float) : bool = jsNative

let private validateSessionId (sessionId: string) =
    if String.IsNullOrWhiteSpace sessionId then
        failwith "sessionId must be a non-empty string"

let private validateDuration (name: string) (value: float) =
    if not (isFinite value) || value <= 0.0 then
        failwith (name + " must be a finite number greater than zero")

let private validateElapsed (value: float) =
    if not (isFinite value) || value < 0.0 then
        failwith "elapsedMs must be a finite non-negative number"

/// λ̂ = k/S：含右删失的指数分布最大似然速率（k 只数完整样本，S 计入删失时长）。
/// 保护期内或尚无完整样本时没有估计：速率 0，阈值 +∞（不打断）。
let private estimated (stats: SufficientStats) =
    stats.Seen >= ProtectionObservations && stats.Completed > 0.0 && stats.TotalMs > 0.0

let private meanRate (stats: SufficientStats) =
    if estimated stats then stats.Completed / stats.TotalMs else 0.0

/// 阈值 = (S/k)·ln(1/(1−Percentile))；无先验、无地板。保护期内为 +∞。
let private thresholdOf (stats: SufficientStats) =
    if estimated stats then
        (stats.TotalMs / stats.Completed) * Math.Log(1.0 / (1.0 - Percentile))
    else
        Double.PositiveInfinity

/// 按 session 的请求耗时指数分布 + 右删失最大似然估计。
/// 每个 session 只存充分统计量 (k, m, S) 与原始条数 n，每次观测先把 k/m/S 整体乘 γ 再累加（指数遗忘）；
/// 前 100 条观测是新手保护期。库内不读时钟。
[<AttachMembers>]
type RequestLatencyDetector() =
    let sessions = Dictionary<string, SufficientStats>()

    let statsOf (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, stats -> stats
        | false, _ ->
            let stats =
                { Completed = 0.0
                  Censored = 0.0
                  TotalMs = 0.0
                  Seen = 0 }

            sessions.Add(sessionId, stats)
            stats

    let empty () =
        { Completed = 0.0
          Censored = 0.0
          TotalMs = 0.0
          Seen = 0 }

    let snapshotOf (sessionId: string) (stats: SufficientStats) =
        let rate = meanRate stats

        { SessionId = sessionId
          Observations = stats.Completed + stats.Censored
          Seen = stats.Seen
          CompletedCount = stats.Completed
          CensoredCount = stats.Censored
          WindowMs = stats.TotalMs
          Alpha = stats.Completed
          Beta = stats.TotalMs
          MeanMs = (if rate > 0.0 then 1.0 / rate else Double.PositiveInfinity)
          ThresholdMs = thresholdOf stats
          Percentile = Percentile }

    let observe (sessionId: string) (durationMs: float) (completed: bool) =
        let stats = statsOf sessionId
        stats.Completed <- Decay * stats.Completed + (if completed then 1.0 else 0.0)
        stats.Censored <- Decay * stats.Censored + (if completed then 0.0 else 1.0)
        stats.TotalMs <- Decay * stats.TotalMs + durationMs
        stats.Seen <- stats.Seen + 1
        snapshotOf sessionId stats

    let current (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, stats -> stats
        | false, _ -> empty ()

    member _.ThresholdMs(sessionId: string) : float =
        validateSessionId sessionId
        thresholdOf (current sessionId)

    member _.Cdf(sessionId: string, elapsedMs: float) : float =
        validateSessionId sessionId
        validateElapsed elapsedMs
        1.0 - exp (-meanRate (current sessionId) * elapsedMs)

    member _.ObserveCompleted(sessionId: string, durationMs: float) : LatencySnapshot =
        validateSessionId sessionId
        validateDuration "durationMs" durationMs
        observe sessionId durationMs true

    member _.ObserveCensored(sessionId: string, censoredMs: float) : LatencySnapshot =
        validateSessionId sessionId
        validateDuration "censoredMs" censoredMs
        observe sessionId censoredMs false

    member _.Snapshot(sessionId: string) : LatencySnapshot =
        validateSessionId sessionId
        snapshotOf sessionId (current sessionId)

    member _.Forget(sessionId: string) : unit =
        validateSessionId sessionId
        sessions.Remove(sessionId) |> ignore

    member _.Clear() : unit = sessions.Clear()

let requestLatencyDetector = RequestLatencyDetector()

let createRequestLatencyDetector () = RequestLatencyDetector()
