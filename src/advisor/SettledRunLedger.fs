module Wanxiangli.Advisor.SettledRunLedger

open System.Collections.Generic
open Fable.Core

[<AttachMembers>]
type SettledEntry =
    { mutable LastRun: string
      SettledHistory: HashSet<string>
      mutable IsRetired: bool }

/// 顾问已结算运行（settledRuns）单调账本。
/// 追踪顾问子会话 ID 到最近成功结算的 ProviderRunIdentity 字符串标识与历史墓碑集合。
/// 用于识别并拒绝旧运行的回放（Completed），防止跨代际误结算。
/// 清理时走 retire 语义保留已结算运行墓碑，确保删除/解绑后迟到的 Completed 不会被误当作新结算。
[<AttachMembers>]
type SettledRunLedger() =
    let gate = obj ()
    let entries = Dictionary<string, SettledEntry>()

    /// 记录某子会话最新结算的运行标识
    member _.recordSettled(childSessionId: string, providerRun: string) : unit =
        if not (isNull childSessionId) && not (isNull providerRun) then
            lock gate (fun () ->
                match entries.TryGetValue childSessionId with
                | true, entry ->
                    entry.LastRun <- providerRun
                    entry.SettledHistory.Add providerRun |> ignore
                    entry.IsRetired <- false
                | false, _ ->
                    let history = HashSet<string>()
                    history.Add providerRun |> ignore
                    entries.[childSessionId] <-
                        { LastRun = providerRun
                          SettledHistory = history
                          IsRetired = false })

    /// 查询某子会话前次结算的运行标识（Option 形式）
    member _.tryPriorRun(childSessionId: string) : string option =
        if isNull childSessionId then
            None
        else
            lock gate (fun () ->
                match entries.TryGetValue childSessionId with
                | true, entry -> Some entry.LastRun
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
            lock gate (fun () -> entries.ContainsKey childSessionId)

    /// 查询某子会话当前是否处于退役墓碑态
    member _.isRetired(childSessionId: string) : bool =
        if isNull childSessionId then
            false
        else
            lock gate (fun () ->
                match entries.TryGetValue childSessionId with
                | true, entry -> entry.IsRetired
                | false, _ -> false)

    /// 核心判定：候选运行是否属于陈旧运行（与最新运行或任何历史已结算运行匹配均判定为陈旧）
    member _.isStale(childSessionId: string, candidateRun: string) : bool =
        if isNull childSessionId || isNull candidateRun then
            false
        else
            lock gate (fun () ->
                match entries.TryGetValue childSessionId with
                | true, entry ->
                    entry.LastRun = candidateRun || entry.SettledHistory.Contains candidateRun
                | false, _ -> false)

    /// 标记退役某子会话：保留历史结算运行墓碑，防止迟到事件被新会话误接纳
    member _.retire(childSessionId: string) : unit =
        if not (isNull childSessionId) then
            lock gate (fun () ->
                match entries.TryGetValue childSessionId with
                | true, entry -> entry.IsRetired <- true
                | false, _ -> ())

    /// 会话删除时清理指定子会话：语义等同于 retire，保留墓碑以抵御晚到 Completed 重放
    member this.clearSession(childSessionId: string) : unit =
        this.retire childSessionId

    /// 清空所有已结算运行记录与墓碑（测试与停机时使用，幂等）
    member _.clearAll() : unit =
        lock gate (fun () -> entries.Clear())

    /// 诊断快照
    member _.snapshot() : obj =
        lock gate (fun () ->
            let mutable retired = 0
            for kv in entries do
                if kv.Value.IsRetired then retired <- retired + 1
            box {| count = entries.Count; retiredCount = retired |})

/// 全局单例
let settledRunLedger = SettledRunLedger()
