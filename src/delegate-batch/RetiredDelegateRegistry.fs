module Wanxiangli.DelegateBatch.RetiredDelegateRegistry

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// EXEC-026: process-local staging of retired dedicated child delegate sessions.
/// Single-flight guarantee: each ownerScope has at most ONE active dedicated child delegate
/// session per role. When that child session is deleted, it is staged here until the
/// owner session's next turn cleans up the delegate's draft or the owner scope closes.
/// If a previous child was already staged (e.g. rapid consecutive recreation/deletion),
/// stage(...) replaces it and returns Some previous so the caller can immediately clean
/// up the orphaned draft.
[<AttachMembers>]
type RetiredDelegateRegistry() =
    let gate = obj ()
    let stagedByOwnerScope = Dictionary<string, string>()

    let cleanKey (key: string) : string =
        if isNull key then "" else key.Trim()

    /// Stage a deleted delegate session for the given owner scope.
    /// Returns Some previous if a session was already staged for this scope,
    /// upholding the single-flight guarantee while exposing replaced sessions for cleanup.
    member _.stage(ownerScope: string, delegateSessionId: string) : string option =
        let sKey = cleanKey ownerScope
        let dKey = cleanKey delegateSessionId
        if String.IsNullOrEmpty sKey || String.IsNullOrEmpty dKey then
            None
        else
            lock gate (fun () ->
                let previous =
                    match stagedByOwnerScope.TryGetValue sKey with
                    | true, prev -> Some prev
                    | false, _ -> None
                stagedByOwnerScope.[sKey] <- dKey
                previous)

    /// Look up the staged deleted delegate session for the scope without removing it.
    member _.tryGet(ownerScope: string) : string option =
        let sKey = cleanKey ownerScope
        if String.IsNullOrEmpty sKey then
            None
        else
            lock gate (fun () ->
                match stagedByOwnerScope.TryGetValue sKey with
                | true, sid -> Some sid
                | false, _ -> None)

    /// Atomically retrieve and remove the staged deleted delegate session for the scope.
    member _.tryTake(ownerScope: string) : string option =
        let sKey = cleanKey ownerScope
        if String.IsNullOrEmpty sKey then
            None
        else
            lock gate (fun () ->
                match stagedByOwnerScope.TryGetValue sKey with
                | true, sid ->
                    stagedByOwnerScope.Remove sKey |> ignore
                    Some sid
                | false, _ -> None)

    /// Explicitly clear the staged deleted delegate session for the scope and return it if present.
    member _.clear(ownerScope: string) : string option =
        let sKey = cleanKey ownerScope
        if String.IsNullOrEmpty sKey then
            None
        else
            lock gate (fun () ->
                match stagedByOwnerScope.TryGetValue sKey with
                | true, sid ->
                    stagedByOwnerScope.Remove sKey |> ignore
                    Some sid
                | false, _ -> None)

    /// Clear all staged deleted delegates and return the list of all retired session IDs.
    member _.clearAll() : string list =
        lock gate (fun () ->
            let all = stagedByOwnerScope.Values |> Seq.toList
            stagedByOwnerScope.Clear()
            all)

    member _.count : int =
        lock gate (fun () -> stagedByOwnerScope.Count)

    member _.snapshot() : (string * string) list =
        lock gate (fun () ->
            stagedByOwnerScope
            |> Seq.map (fun kv -> kv.Key, kv.Value)
            |> Seq.toList)

let retiredDelegateRegistry = RetiredDelegateRegistry()
