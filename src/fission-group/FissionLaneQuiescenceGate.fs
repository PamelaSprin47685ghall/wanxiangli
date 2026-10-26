module Wanxiangli.FissionGroup.FissionLaneQuiescenceGate

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// Fission 组内各并发执行分道（Lane）的静默状态与整体收敛门禁。
/// 独占并维护私有可变字典 groups: Dictionary<groupId, Dictionary<laneId, bool>>，
/// 严格保证：
/// 1. 只有当一个组中所有分道均进入静默状态（且有效分道数 >= 2）时，才判定整体收敛（Quiescent）；
/// 2. 单个分道进入静默绝不判定整体收敛；
/// 3. 分道重复进入静默保持幂等；
/// 4. 任意分道脱离静默（markActive / leaveQuiescent）立即打破整体静默；
/// 5. 支持按分道（clearLane）与按组（clearGroup）清理，清理后计数与收敛判定重置。
[<AttachMembers>]
type FissionLaneQuiescenceGate() =
    let gate = obj ()
    // groupId -> (laneId -> isQuiescent: bool)
    let groups = Dictionary<string, Dictionary<string, bool>>()

    let getOrCreateGroup (groupId: string) : Dictionary<string, bool> =
        match groups.TryGetValue groupId with
        | true, existing -> existing
        | false, _ ->
            let created = Dictionary<string, bool>()
            groups.[groupId] <- created
            created

    /// 标记特定组下的某个分道进入静默状态。
    /// 若状态从非静默变为静默，返回 true；若此前已处于静默状态，返回 false（幂等）。
    member _.enterQuiescent(groupId: string, laneId: string) : bool =
        if String.IsNullOrEmpty groupId || String.IsNullOrEmpty laneId then
            false
        else
            lock gate (fun () ->
                let laneMap = getOrCreateGroup groupId
                match laneMap.TryGetValue laneId with
                | true, true -> false
                | _ ->
                    laneMap.[laneId] <- true
                    true)

    /// enterQuiescent 的同义别名。
    member this.markQuiescent(groupId: string, laneId: string) : bool =
        this.enterQuiescent(groupId, laneId)

    /// 标记特定组下的某个分道脱离静默状态（重新变为活跃）。
    /// 若状态从静默变为活跃，返回 true；若此前已非静默或不存在，返回 false。
    member _.leaveQuiescent(groupId: string, laneId: string) : bool =
        if String.IsNullOrEmpty groupId || String.IsNullOrEmpty laneId then
            false
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | true, laneMap ->
                    match laneMap.TryGetValue laneId with
                    | true, true ->
                        laneMap.[laneId] <- false
                        true
                    | _ -> false
                | false, _ -> false)

    /// leaveQuiescent 的同义别名。
    member this.markActive(groupId: string, laneId: string) : bool =
        this.leaveQuiescent(groupId, laneId)

    /// 查询特定分道是否处于静默状态。
    member _.isLaneQuiescent(groupId: string, laneId: string) : bool =
        if String.IsNullOrEmpty groupId || String.IsNullOrEmpty laneId then
            false
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | true, laneMap ->
                    match laneMap.TryGetValue laneId with
                    | true, isQuiescent -> isQuiescent
                    | false, _ -> false
                | false, _ -> false)

    /// 查询整个组是否已整体达到静默收敛状态。
    /// 规则：
    /// 1. 组必须存在；
    /// 2. 分道数量必须 >= 2（Fission 至少两条分道）；
    /// 3. 若传入 expectedLaneCount，当前登记分道数必须等于 expectedLaneCount；
    /// 4. 所有登记的分道必须全部处于 isQuiescent = true 状态。
    member _.isGroupQuiescent(groupId: string, ?expectedLaneCount: int) : bool =
        if String.IsNullOrEmpty groupId then
            false
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | false, _ -> false
                | true, laneMap ->
                    let count = laneMap.Count
                    if count < 2 then
                        false
                    else
                        match expectedLaneCount with
                        | Some expected when expected <> count -> false
                        | _ ->
                            let mutable allQuiescent = true
                            for KeyValue(_, isQ) in laneMap do
                                if not isQ then
                                    allQuiescent <- false
                            allQuiescent)

    /// 批量检查指定的一组分道是否全部处于静默状态。
    /// 若分道数 < 2 或任意分道非静默/未登记，返回 false。
    member _.areLanesQuiescent(groupId: string, laneIds: string array) : bool =
        if String.IsNullOrEmpty groupId || isNull laneIds || laneIds.Length < 2 then
            false
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | false, _ -> false
                | true, laneMap ->
                    let mutable allQ = true
                    for laneId in laneIds do
                        if String.IsNullOrEmpty laneId then
                            allQ <- false
                        else
                            match laneMap.TryGetValue laneId with
                            | true, true -> ()
                            | _ -> allQ <- false
                    allQ)

    /// 获取特定组下当前处于静默状态的分道 ID 列表。
    member _.getQuiescentLanes(groupId: string) : string array =
        if String.IsNullOrEmpty groupId then
            [||]
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | false, _ -> [||]
                | true, laneMap ->
                    let quiescent = ResizeArray<string>()
                    for KeyValue(laneId, isQ) in laneMap do
                        if isQ then quiescent.Add laneId
                    quiescent.ToArray())

    /// 获取特定组下已登记的总分道数。
    member _.getLaneCount(groupId: string) : int =
        if String.IsNullOrEmpty groupId then
            0
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | false, _ -> 0
                | true, laneMap -> laneMap.Count)

    /// 清理特定组下的某个分道记录。若清理前存在该分道，返回 true。
    member _.clearLane(groupId: string, laneId: string) : bool =
        if String.IsNullOrEmpty groupId || String.IsNullOrEmpty laneId then
            false
        else
            lock gate (fun () ->
                match groups.TryGetValue groupId with
                | true, laneMap -> laneMap.Remove laneId
                | false, _ -> false)

    /// 清理特定组的全部状态记录。若清理前存在该组，返回 true。
    member _.clearGroup(groupId: string) : bool =
        if String.IsNullOrEmpty groupId then
            false
        else
            lock gate (fun () -> groups.Remove groupId)

    /// 清空所有组与分道状态。
    member _.clearAll() : unit =
        lock gate (fun () -> groups.Clear())

/// 全局默认 Fission 分道静默门禁单例。
let fissionLaneQuiescenceGate = FissionLaneQuiescenceGate()
