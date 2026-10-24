module Wanxiangli.ProviderCalibration.ProviderCalibration

open System.Collections.Generic
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type CalibrationMessages =
    abstract recordUsage: sessionId: string * cached: int * uncached: int -> unit
    abstract recordLimit: sessionId: string * contextTokens: int -> unit
    abstract usage: sessionId: string -> obj
    abstract limit: sessionId: string -> obj
    abstract clearSession: sessionId: string -> unit
    abstract clearAll: unit -> unit

type private Usage = { Cached: int; Uncached: int }

/// 真实 provider 观测的进程内 owner。调用方不能直接修改内部状态。
let ProviderCalibration: CalibrationMessages =
    let usageBySession = Dictionary<string, Usage>()
    let limitBySession = Dictionary<string, int>()

    { new CalibrationMessages with
        member _.recordUsage(sessionId, cached, uncached) =
            usageBySession[sessionId] <- { Cached = cached; Uncached = uncached }

        member _.recordLimit(sessionId, contextTokens) =
            limitBySession[sessionId] <- contextTokens

        member _.usage(sessionId) =
            match usageBySession.TryGetValue sessionId with
            | true, usage ->
                createObj [ "cached" ==> usage.Cached; "uncached" ==> usage.Uncached ]
            | false, _ -> null

        member _.limit(sessionId) =
            match limitBySession.TryGetValue sessionId with
            | true, contextTokens -> box contextTokens
            | false, _ -> null

        member _.clearSession(sessionId) =
            usageBySession.Remove sessionId |> ignore
            limitBySession.Remove sessionId |> ignore

        member _.clearAll() =
            usageBySession.Clear()
            limitBySession.Clear() }
