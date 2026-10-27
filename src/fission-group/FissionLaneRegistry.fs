module Wanxiangli.FissionGroup.FissionLaneRegistry

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<CLIMutable>]
[<AttachMembers>]
type FissionLaneRecord =
    { GroupId: string
      OwnerSessionId: string
      LaneIndex: int
      LaneCount: int }

[<CLIMutable>]
[<AttachMembers>]
type FissionOwnerCleanupResult =
    { RemovedLanes: string array
      RemovedGroupIds: string array }

/// Fission 分道执行绑定注册表（单向映射 + 按 owner 线性扫描，不造假想结构）。
/// 独占并维护私有可变字典 lanes: Dictionary<laneSessionId, FissionLaneRecord>，
/// 承担弥合宿主物理会话分配与全组原子落盘的时序承重职责。
[<AttachMembers>]
type FissionLaneRegistry() =
    let gate = obj ()
    // laneSessionId -> FissionLaneRecord
    let lanes = Dictionary<string, FissionLaneRecord>()
    let mutable durableLaneEvidence: (string -> FissionLaneRecord option) option = None

    member _.bindLane(groupId: string, ownerSessionId: string, laneIndex: int, laneCount: int, laneSessionId: string) : unit =
        if not (String.IsNullOrEmpty laneSessionId) then
            let record =
                { GroupId = groupId
                  OwnerSessionId = ownerSessionId
                  LaneIndex = laneIndex
                  LaneCount = laneCount }
            lock gate (fun () -> lanes.[laneSessionId] <- record)

    member _.unbindLane(laneSessionId: string) : bool =
        if String.IsNullOrEmpty laneSessionId then
            false
        else
            lock gate (fun () -> lanes.Remove laneSessionId)

    member _.tryLane(laneSessionId: string) : FissionLaneRecord option =
        if String.IsNullOrEmpty laneSessionId then
            None
        else
            lock gate (fun () ->
                match lanes.TryGetValue laneSessionId with
                | true, record -> Some record
                | false, _ ->
                    match durableLaneEvidence with
                    | Some resolve -> resolve laneSessionId
                    | None -> None)

    member this.tryOwner(laneSessionId: string) : string option =
        this.tryLane laneSessionId |> Option.map (fun r -> r.OwnerSessionId)

    member this.logicalOwner(sessionId: string) : string =
        if String.IsNullOrEmpty sessionId then
            sessionId
        else
            this.tryOwner sessionId |> Option.defaultValue sessionId

    member _.clearOwner(ownerSessionId: string) : FissionOwnerCleanupResult =
        if String.IsNullOrEmpty ownerSessionId then
            { RemovedLanes = [||]; RemovedGroupIds = [||] }
        else
            lock gate (fun () ->
                let matchingLanes = ResizeArray<string>()
                let groupSet = HashSet<string>()
                for KeyValue(laneSessionId, record) in lanes do
                    if record.OwnerSessionId = ownerSessionId then
                        matchingLanes.Add laneSessionId
                        if not (String.IsNullOrEmpty record.GroupId) then
                            groupSet.Add record.GroupId |> ignore
                for laneSessionId in matchingLanes do
                    lanes.Remove laneSessionId |> ignore
                { RemovedLanes = matchingLanes.ToArray()
                  RemovedGroupIds = Seq.toArray groupSet })

    member this.clearOwnerLanes(ownerSessionId: string) : string array =
        this.clearOwner(ownerSessionId).RemovedLanes

    member _.hydrateFromDurable(resolve: string -> FissionLaneRecord option) : unit =
        lock gate (fun () -> durableLaneEvidence <- Some resolve)

    member _.clearAll() : unit =
        lock gate (fun () ->
            lanes.Clear()
            durableLaneEvidence <- None)

    member _.getLaneCount() : int =
        lock gate (fun () -> lanes.Count)

/// 全局默认 Fission 分道注册表单例。
let fissionLaneRegistry = FissionLaneRegistry()
