module Wanxiangli.Degeneration.RequestLatencyDetector

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// 先验与遗忘常量；写死不开放配置，减少接口面。
/// 先验等于「见过 5 次、每次 5 秒」：β/α = 5000ms。
[<Literal>]
let private PriorAlpha = 5.0

[<Literal>]
let private PriorBeta = 25000.0

[<Literal>]
let private Percentile = 0.99

/// 有效窗口长度：遗忘因子 γ = 1 − 1/EffectiveWindow，全部权重之和上限 Σγ^i = EffectiveWindow。
[<Literal>]
let private EffectiveWindow = 50.0

let private Decay = 1.0 - 1.0 / EffectiveWindow

/// 会话级后验的只读视图；每次调用构造新对象，外部修改不回流。
/// Observations / CompletedCount / CensoredCount / WindowMs 都是按 γ 衰减后的有效量（可为小数）。
type LatencySnapshot =
    { SessionId: string
      Observations: float
      CompletedCount: float
      CensoredCount: float
      WindowMs: float
      Alpha: float
      Beta: float
      MeanMs: float
      ThresholdMs: float
      Percentile: float }

/// Gamma–Exponential（含右删失）的充分统计量：衰减完整样本数 k、衰减删失样本数 m、衰减总时长 S。
/// 每个 session 固定三个数，O(1) 内存，不保存任何原始样本。
type private SufficientStats =
    { mutable Completed: float
      mutable Censored: float
      mutable TotalMs: float }

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

/// λ̂ = α/β：Gamma 后验均值速率。Cdf(t) = 1 − exp(−λ̂·t)。
let private meanRate (alpha: float) (beta: float) = alpha / beta

/// 阈值 = (β/α)·ln(1/(1−Percentile))；无地板，不做兜底。
let private thresholdOf (alpha: float) (beta: float) =
    (beta / alpha) * Math.Log (1.0 / (1.0 - Percentile))

/// 按 session 的请求耗时指数分布 + 右删失贝叶斯估计。
/// 每个 session 只存充分统计量 (k, m, S)，每次观测先整体乘 γ 再累加新观测（指数遗忘）；
/// α = PriorAlpha + k，β = PriorBeta + S。库内不读时钟。
[<AttachMembers>]
type RequestLatencyDetector() =
    let sessions = Dictionary<string, SufficientStats>()

    let statsOf (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, stats -> stats
        | false, _ ->
            let stats = { Completed = 0.0; Censored = 0.0; TotalMs = 0.0 }
            sessions.Add(sessionId, stats)
            stats

    let posterior (stats: SufficientStats) =
        (PriorAlpha + stats.Completed, PriorBeta + stats.TotalMs)

    let snapshotOf (sessionId: string) (stats: SufficientStats) =
        let alpha, beta = posterior stats

        { SessionId = sessionId
          Observations = stats.Completed + stats.Censored
          CompletedCount = stats.Completed
          CensoredCount = stats.Censored
          WindowMs = stats.TotalMs
          Alpha = alpha
          Beta = beta
          MeanMs = beta / alpha
          ThresholdMs = thresholdOf alpha beta
          Percentile = Percentile }

    let empty () = { Completed = 0.0; Censored = 0.0; TotalMs = 0.0 }

    let observe (sessionId: string) (durationMs: float) (completed: bool) =
        let stats = statsOf sessionId
        stats.Completed <- Decay * stats.Completed + (if completed then 1.0 else 0.0)
        stats.Censored <- Decay * stats.Censored + (if completed then 0.0 else 1.0)
        stats.TotalMs <- Decay * stats.TotalMs + durationMs
        snapshotOf sessionId stats

    let posteriorOf (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, stats -> posterior stats
        | false, _ -> (PriorAlpha, PriorBeta)

    member _.ThresholdMs(sessionId: string) : float =
        validateSessionId sessionId
        let alpha, beta = posteriorOf sessionId
        thresholdOf alpha beta

    member _.Cdf(sessionId: string, elapsedMs: float) : float =
        validateSessionId sessionId
        validateElapsed elapsedMs
        let alpha, beta = posteriorOf sessionId
        1.0 - exp (-meanRate alpha beta * elapsedMs)

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
        match sessions.TryGetValue sessionId with
        | true, stats -> snapshotOf sessionId stats
        | false, _ -> snapshotOf sessionId (empty ())

    member _.Forget(sessionId: string) : unit =
        validateSessionId sessionId
        sessions.Remove(sessionId) |> ignore

    member _.Clear() : unit = sessions.Clear()

let requestLatencyDetector = RequestLatencyDetector()

let createRequestLatencyDetector () = RequestLatencyDetector()
