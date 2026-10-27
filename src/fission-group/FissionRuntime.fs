module Wanxiangli.FissionGroup.FissionRuntime

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.FissionGroup.FissionLaneRegistry

let private deliveryKey groupId completionId (laneIndex: int) =
    groupId + "\u001f" + completionId + "\u001f" + string laneIndex

let private disposeSafely (resource: obj) =
    if not (isNull resource) then
        try
            emitJsStatement resource """
            if (typeof $0.Dispose === 'function') {
                $0.Dispose();
            } else if (typeof $0.dispose === 'function') {
                $0.dispose();
            }
            """
        with _ ->
            ()

/// Fission 进程内运行时状态与单飞认领自治对象。
/// 独占维护 silentInterrupts、groupResources、deliveryClaims、takeoverClaims 与 closedGroups，
/// 并组合 FissionLaneRegistry 协调原子清理、单飞认领与资源闭环释放。
[<AttachMembers>]
type FissionRuntime(?laneRegistry: FissionLaneRegistry) =
    let registry = defaultArg laneRegistry fissionLaneRegistry
    let gate = obj ()

    // ownerSessionId -> bool
    let silentInterrupts = HashSet<string>()
    // groupId -> ResizeArray<obj>
    let groupResources = Dictionary<string, ResizeArray<obj>>()
    // deliveryKey -> bool
    let deliveryClaims = HashSet<string>()
    // groupId -> bool
    let takeoverClaims = HashSet<string>()
    // 已关闭终态组集合：杜绝已终结组再次认领 takeover，并将迟到/重入资源即时释放防泄露
    let closedGroups = HashSet<string>()

    member _.LaneRegistry = registry

    member _.bindLane(groupId: string, ownerSessionId: string, laneIndex: int, laneCount: int, laneSessionId: string) : unit =
        registry.bindLane(groupId, ownerSessionId, laneIndex, laneCount, laneSessionId)

    member _.unbindLane(laneSessionId: string) : bool =
        registry.unbindLane laneSessionId

    member _.tryLane(laneSessionId: string) : FissionLaneRecord option =
        registry.tryLane laneSessionId

    member _.tryOwner(laneSessionId: string) : string option =
        registry.tryOwner laneSessionId

    member _.logicalOwner(sessionId: string) : string =
        registry.logicalOwner sessionId

    member _.installDurableLaneEvidence(resolve: string -> FissionLaneRecord option) : unit =
        registry.hydrateFromDurable resolve

    member _.markSilentInterrupt(ownerSessionId: string) : unit =
        if not (String.IsNullOrEmpty ownerSessionId) then
            lock gate (fun () -> silentInterrupts.Add ownerSessionId |> ignore)

    member _.clearSilentInterrupt(ownerSessionId: string) : unit =
        if not (String.IsNullOrEmpty ownerSessionId) then
            lock gate (fun () -> silentInterrupts.Remove ownerSessionId |> ignore)

    member _.isSilentInterrupt(ownerSessionId: string) : bool =
        if String.IsNullOrEmpty ownerSessionId then
            false
        else
            lock gate (fun () -> silentInterrupts.Contains ownerSessionId)

    member this.tryConsumeSilentInterrupt(ownerSessionId: string) : bool =
        this.isSilentInterrupt ownerSessionId

    member _.trackGroupResource(groupId: string, resource: obj) : unit =
        if not (String.IsNullOrEmpty groupId) && not (isNull resource) then
            let isClosed =
                lock gate (fun () ->
                    if closedGroups.Contains groupId then
                        true
                    else
                        let resources =
                            match groupResources.TryGetValue groupId with
                            | true, current -> current
                            | false, _ ->
                                let created = ResizeArray<obj>()
                                groupResources[groupId] <- created
                                created
                        resources.Add resource
                        false)
            if isClosed then
                // 已关闭组的迟到或重入登记，立即就地安全释放，严禁创建无主新条目造成泄露
                disposeSafely resource

    member _.disposeGroupResources(groupId: string) : unit =
        if not (String.IsNullOrEmpty groupId) then
            let toDispose =
                lock gate (fun () ->
                    closedGroups.Add groupId |> ignore
                    match groupResources.TryGetValue groupId with
                    | true, current ->
                        groupResources.Remove groupId |> ignore
                        current.ToArray()
                    | false, _ -> [||])
            for resource in toDispose do
                disposeSafely resource

    member _.isGroupClosed(groupId: string) : bool =
        if String.IsNullOrEmpty groupId then
            false
        else
            lock gate (fun () -> closedGroups.Contains groupId)

    member _.tryBeginDelivery(groupId: string, completionId: string, laneIndex: int) : bool =
        let key = deliveryKey groupId completionId laneIndex
        lock gate (fun () -> deliveryClaims.Add key)

    member _.endDelivery(groupId: string, completionId: string, laneIndex: int) : unit =
        let key = deliveryKey groupId completionId laneIndex
        lock gate (fun () -> deliveryClaims.Remove key |> ignore)

    member _.hasDeliveryClaim(groupId: string, completionId: string, laneIndex: int) : bool =
        let key = deliveryKey groupId completionId laneIndex
        lock gate (fun () -> deliveryClaims.Contains key)

    member _.tryBeginTakeover(groupId: string) : bool =
        if String.IsNullOrEmpty groupId then
            false
        else
            lock gate (fun () ->
                if closedGroups.Contains groupId then
                    // 终态门禁：已终结或已关闭组严禁再次认领接管
                    false
                else
                    takeoverClaims.Add groupId)

    member _.endTakeover(groupId: string) : unit =
        if not (String.IsNullOrEmpty groupId) then
            lock gate (fun () -> takeoverClaims.Remove groupId |> ignore)

    member _.hasTakeoverClaim(groupId: string) : bool =
        if String.IsNullOrEmpty groupId then
            false
        else
            lock gate (fun () ->
                if closedGroups.Contains groupId then
                    false
                else
                    takeoverClaims.Contains groupId)

    member this.clearOwner(ownerSessionId: string) : FissionOwnerCleanupResult =
        let cleanup = registry.clearOwner ownerSessionId
        if not (String.IsNullOrEmpty ownerSessionId) then
            let groupIds = cleanup.RemovedGroupIds
            lock gate (fun () ->
                silentInterrupts.Remove ownerSessionId |> ignore
                for groupId in groupIds do
                    closedGroups.Add groupId |> ignore
                    takeoverClaims.Remove groupId |> ignore)
            for groupId in groupIds do
                this.disposeGroupResources groupId
        cleanup

    member this.clearAll() : unit =
        registry.clearAll()
        let allGroupIds =
            lock gate (fun () ->
                silentInterrupts.Clear()
                deliveryClaims.Clear()
                takeoverClaims.Clear()
                closedGroups.Clear()
                let groups = Seq.toArray groupResources.Keys
                groups)
        for groupId in allGroupIds do
            this.disposeGroupResources groupId

let fissionRuntime = FissionRuntime()
