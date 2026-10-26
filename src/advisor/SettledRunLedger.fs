module Wanxiangli.Advisor.SettledRunLedger

open System.Collections.Generic
open Fable.Core

/// 顾问已结算运行（settledRuns）单调账本。
/// 追踪顾问子会话 ID 到最近成功结算的 ProviderRunIdentity 字符串标识。
/// 用于识别并拒绝旧运行的回放（Completed），防止跨代际误结算。
[<AttachMembers>]
type SettledRunLedger() =
    let gate = obj ()
    let settledRuns = Dictionary<string, string>()

    /// 记录某子会话最新结算的运行标识
    member _.recordSettled(childSessionId: string, providerRun: string) : unit =
        if not (isNull childSessionId) && not (isNull providerRun) then
            lock gate (fun () -> settledRuns.[childSessionId] <- providerRun)

    /// 查询某子会话前次结算的运行标识（Option 形式）
    member _.tryPriorRun(childSessionId: string) : string option =
        if isNull childSessionId then
            None
        else
            lock gate (fun () ->
                match settledRuns.TryGetValue childSessionId with
                | true, run -> Some run
                | false, _ -> None)

    /// 查询某子会话前次结算的运行标识（字符串形式，未结算返回空字符串）
    member this.priorRun(childSessionId: string) : string =
        match this.tryPriorRun childSessionId with
        | Some run -> run
        | None -> ""

    /// 判断某子会话是否已有已结算运行记录
    member _.hasSettledRun(childSessionId: string) : bool =
        if isNull childSessionId then
            false
        else
            lock gate (fun () -> settledRuns.ContainsKey childSessionId)

    /// 核心判定：候选运行是否属于陈旧运行（即与已结算运行相同）
    member this.isStale(childSessionId: string, candidateRun: string) : bool =
        if isNull childSessionId || isNull candidateRun then
            false
        else
            match this.tryPriorRun childSessionId with
            | Some prior -> prior = candidateRun
            | None -> false

    /// 会话删除时清理指定会话的已结算记录（幂等）
    member _.clearSession(childSessionId: string) : unit =
        if not (isNull childSessionId) then
            lock gate (fun () -> settledRuns.Remove childSessionId |> ignore)

    /// 清空所有已结算运行记录（幂等）
    member _.clearAll() : unit =
        lock gate (fun () -> settledRuns.Clear())

    /// 诊断快照
    member _.snapshot() : obj =
        lock gate (fun () -> box {| count = settledRuns.Count |})

/// 全局单例
let settledRunLedger = SettledRunLedger()
