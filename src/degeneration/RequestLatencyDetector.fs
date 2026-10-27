module Wanxiangli.Degeneration.RequestLatencyDetector

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// 先验与窗口常量；写死不开放配置，减少接口面。
/// 先验等于「见过 5 次、每次 5 秒」：β/α = 5000ms。
[<Literal>]
let private PriorAlpha = 5.0

[<Literal>]
let private PriorBeta = 25000.0

[<Literal>]
let private Percentile = 0.99

[<Literal>]
let private WindowSize = 50

/// 会话级后验与窗口的只读视图；每次调用构造新对象，外部修改不回流。
type LatencySnapshot =
    { SessionId: string
      Observations: int
      CompletedCount: int
      CensoredCount: int
      WindowMs: float
      Alpha: float
      Beta: float
      MeanMs: float
      ThresholdMs: float
      Percentile: float }

/// 一条耗时观测：完整样本（Completed = true）或右删失样本（只知道下界 c）。
type private Observation =
    { Completed: bool
      DurationMs: float }

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
/// 每个 session 只保留最近 WindowSize 条观测，每次更新从先验重算 α 与 β；库内不读时钟。
[<AttachMembers>]
type RequestLatencyDetector() =
    let sessions = Dictionary<string, ResizeArray<Observation>>()

    let windowOf (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, window -> window
        | false, _ ->
            let window = ResizeArray<Observation>()
            sessions.Add(sessionId, window)
            window

    let posterior (window: ResizeArray<Observation>) =
        let mutable completed = 0
        let mutable windowMs = 0.0

        for observation in window do
            if observation.Completed then completed <- completed + 1
            windowMs <- windowMs + observation.DurationMs

        (PriorAlpha + float completed, PriorBeta + windowMs, completed, window.Count - completed, windowMs)

    let snapshotOf (sessionId: string) (window: ResizeArray<Observation>) =
        let alpha, beta, completed, censored, windowMs = posterior window

        { SessionId = sessionId
          Observations = window.Count
          CompletedCount = completed
          CensoredCount = censored
          WindowMs = windowMs
          Alpha = alpha
          Beta = beta
          MeanMs = beta / alpha
          ThresholdMs = thresholdOf alpha beta
          Percentile = Percentile }

    let observe (sessionId: string) (durationMs: float) (completed: bool) =
        let window = windowOf sessionId
        window.Add { Completed = completed; DurationMs = durationMs }

        if window.Count > WindowSize then
            window.RemoveAt(0)

        snapshotOf sessionId window

    let posteriorOf (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, window -> posterior window
        | false, _ -> (PriorAlpha, PriorBeta, 0, 0, 0.0)

    member _.ThresholdMs(sessionId: string) : float =
        validateSessionId sessionId
        let alpha, beta, _, _, _ = posteriorOf sessionId
        thresholdOf alpha beta

    member _.Cdf(sessionId: string, elapsedMs: float) : float =
        validateSessionId sessionId
        validateElapsed elapsedMs
        let alpha, beta, _, _, _ = posteriorOf sessionId
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
        | true, window -> snapshotOf sessionId window
        | false, _ -> snapshotOf sessionId (ResizeArray<Observation>())

    member _.Forget(sessionId: string) : unit =
        validateSessionId sessionId
        sessions.Remove(sessionId) |> ignore

    member _.Clear() : unit = sessions.Clear()

let requestLatencyDetector = RequestLatencyDetector()

let createRequestLatencyDetector () = RequestLatencyDetector()
