module Wanxiangli.Ownership.ParentAbortRegistry

open System.Collections.Generic
open Fable.Core

[<AttachMembers>]
type ParentAbortRegistry() =
    let lockObj = obj ()
    let parentAborters = Dictionary<string, Dictionary<int, unit -> unit>>()
    let mutable nextAbortToken = 0

    let getOrCreateParentMap (parentId: string) =
        match parentAborters.TryGetValue parentId with
        | true, map -> map
        | false, _ ->
            let map = Dictionary<int, unit -> unit>()
            parentAborters.[parentId] <- map
            map

    let cleanupParentIfEmpty (parentId: string) (map: Dictionary<int, unit -> unit>) =
        if map.Count = 0 then
            parentAborters.Remove parentId |> ignore

    let removeCallback (parentId: string) (token: int) =
        match parentAborters.TryGetValue parentId with
        | true, map ->
            map.Remove token |> ignore
            cleanupParentIfEmpty parentId map
        | false, _ -> ()

    let snapshotCallbacks (parentId: string) =
        lock lockObj (fun () ->
            match parentAborters.TryGetValue parentId with
            | true, map -> map.Values |> Seq.toList
            | false, _ -> []
        )

    let invokeSafely (cb: unit -> unit) =
        try
            cb ()
        with _ ->
            ()

    member _.register(parentId: string, abort: unit -> unit) : int =
        lock lockObj (fun () ->
            nextAbortToken <- nextAbortToken + 1
            let token = nextAbortToken
            let map = getOrCreateParentMap parentId
            map.[token] <- abort
            token
        )

    member this.Register(parentId: string, abort: unit -> unit) : int =
        this.register(parentId, abort)

    member _.unregister(parentId: string, token: int) : unit =
        lock lockObj (fun () ->
            removeCallback parentId token
        )

    member this.Unregister(parentId: string, token: int) : unit =
        this.unregister(parentId, token)

    member _.abortParent(parentId: string) : unit =
        let callbacks = snapshotCallbacks parentId
        callbacks |> List.iter invokeSafely

    member this.AbortParent(parentId: string) : unit =
        this.abortParent parentId

    member _.hasParent(parentId: string) : bool =
        lock lockObj (fun () -> parentAborters.ContainsKey parentId)

    member this.HasParent(parentId: string) : bool =
        this.hasParent parentId

    member _.clear() : unit =
        lock lockObj (fun () ->
            parentAborters.Clear()
            nextAbortToken <- 0
        )

    member this.Clear() : unit =
        this.clear()

let parentAbortRegistry = ParentAbortRegistry()
