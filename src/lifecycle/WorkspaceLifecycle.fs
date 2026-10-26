module Wanxiangli.Lifecycle.WorkspaceLifecycle

open System
open System.Collections.Generic
open Fable.Core

// ----------------------------------------------------------------------------
// 1. RootWorkspaceCell: process-lifetime first-bind cell
// ----------------------------------------------------------------------------

module private RootWorkspaceCellHelpers =
    let cleanCandidate (candidate: string option) =
        match candidate with
        | Some path when not (String.IsNullOrWhiteSpace path) -> Some path
        | _ -> None

    let applyBind (cell: string option ref) (candidate: string option) =
        match !cell, cleanCandidate candidate with
        | None, Some path ->
            cell := Some path
            true
        | _ -> false

[<AttachMembers>]
type RootWorkspaceCell() =
    let gate = obj ()
    let bound = ref None

    member _.TryBind(candidate: string): bool =
        lock gate (fun () -> RootWorkspaceCellHelpers.applyBind bound (Option.ofObj candidate))

    member this.tryBind(candidate: string): bool =
        this.TryBind(candidate)

    member _.TryRead(): string option =
        lock gate (fun () -> !bound)

    member this.tryRead(): obj =
        match this.TryRead() with
        | Some path -> box path
        | None -> null

    member _.Clear(): unit =
        lock gate (fun () -> bound := None)

    member this.clear(): unit =
        this.Clear()

// ----------------------------------------------------------------------------
// 2. SharedEventStorePool: shared workspace event store refcount registry
// ----------------------------------------------------------------------------

type SharedStoreEntry =
    { Store: obj
      mutable RefCount: int }

module private SharedEventStorePoolHelpers =
    let acquireEntry (entries: Dictionary<string, SharedStoreEntry>) (commonDir: string) (createStore: string -> obj) =
        match entries.TryGetValue(commonDir) with
        | true, entry ->
            entry.RefCount <- entry.RefCount + 1
            entry.Store
        | false, _ ->
            let store = createStore commonDir
            entries.[commonDir] <- { Store = store; RefCount = 1 }
            store

    let releaseEntry (entries: Dictionary<string, SharedStoreEntry>) (commonDir: string) =
        match entries.TryGetValue(commonDir) with
        | true, entry when entry.RefCount - 1 <= 0 ->
            entries.Remove(commonDir) |> ignore
            true
        | true, entry ->
            entry.RefCount <- entry.RefCount - 1
            false
        | false, _ ->
            false

    let tryCurrentEntry (entries: Dictionary<string, SharedStoreEntry>) (commonDir: string) =
        match entries.TryGetValue(commonDir) with
        | true, entry -> Some entry.Store
        | false, _ -> None

    let countEntry (entries: Dictionary<string, SharedStoreEntry>) (commonDir: string) =
        match entries.TryGetValue(commonDir) with
        | true, entry -> entry.RefCount
        | false, _ -> 0

[<AttachMembers>]
type SharedEventStorePool() =
    let gate = obj ()
    let entries = Dictionary<string, SharedStoreEntry>()

    member _.Acquire(commonDir: string, createStore: string -> obj): obj =
        match String.IsNullOrWhiteSpace commonDir with
        | true -> invalidOp "commonDir is empty"
        | false -> lock gate (fun () -> SharedEventStorePoolHelpers.acquireEntry entries commonDir createStore)

    member _.TryCurrent(commonDir: string): obj option =
        match String.IsNullOrWhiteSpace commonDir with
        | true -> None
        | false -> lock gate (fun () -> SharedEventStorePoolHelpers.tryCurrentEntry entries commonDir)

    member _.Release(commonDir: string): bool =
        match String.IsNullOrWhiteSpace commonDir with
        | true -> false
        | false -> lock gate (fun () -> SharedEventStorePoolHelpers.releaseEntry entries commonDir)

    member _.SnapshotCount(commonDir: string): int =
        lock gate (fun () -> SharedEventStorePoolHelpers.countEntry entries commonDir)

    member _.Clear(): unit =
        lock gate (fun () -> entries.Clear())

// ----------------------------------------------------------------------------
// 3. SharedAsyncJournalPool: asynchronous opening, identity settlement,
//    fail-closed pruning, and instance refcount release
// ----------------------------------------------------------------------------

type SharedJournalEntry =
    { Ready: obj
      mutable Instance: obj option
      mutable RefCount: int }

module private SharedAsyncJournalPoolHelpers =
    let acquireOrStartEntry (entries: Dictionary<string, SharedJournalEntry>) (directory: string) (startReady: unit -> obj) =
        match entries.TryGetValue(directory) with
        | true, entry ->
            entry.RefCount <- entry.RefCount + 1
            entry.Ready, false
        | false, _ ->
            let readyTask = startReady ()
            entries.[directory] <- { Ready = readyTask; Instance = None; RefCount = 1 }
            readyTask, true

    let settleSuccessEntry (entries: Dictionary<string, SharedJournalEntry>) (directory: string) (readyTask: obj) (instance: obj) =
        match entries.TryGetValue(directory) with
        | true, entry when obj.ReferenceEquals(entry.Ready, readyTask) ->
            entry.Instance <- Some instance
        | _ -> ()

    let settleFailureEntry (entries: Dictionary<string, SharedJournalEntry>) (directory: string) (readyTask: obj) =
        match entries.TryGetValue(directory) with
        | true, entry when obj.ReferenceEquals(entry.Ready, readyTask) ->
            entries.Remove(directory) |> ignore
        | _ -> ()

    let matchTarget (target: obj) (KeyValue(directory, entry: SharedJournalEntry)) =
        match entry.Instance with
        | Some inst when obj.ReferenceEquals(inst, target) -> Some(directory, entry, inst)
        | _ -> None

    let releaseTargetEntry (entries: Dictionary<string, SharedJournalEntry>) (target: obj) =
        let found = entries |> Seq.tryPick (matchTarget target)
        match found with
        | Some(directory, entry, inst) when entry.RefCount - 1 <= 0 ->
            entries.Remove(directory) |> ignore
            Some inst
        | Some(_, entry, _) ->
            entry.RefCount <- entry.RefCount - 1
            None
        | None ->
            None

    let countEntry (entries: Dictionary<string, SharedJournalEntry>) (directory: string) =
        match entries.TryGetValue(directory) with
        | true, entry -> entry.RefCount
        | false, _ -> 0

[<AttachMembers>]
type SharedAsyncJournalPool() =
    let gate = obj ()
    let entries = Dictionary<string, SharedJournalEntry>()

    member _.AcquireOrStart(directory: string, startReady: unit -> obj): obj * bool =
        match String.IsNullOrWhiteSpace directory with
        | true -> invalidOp "directory is empty"
        | false -> lock gate (fun () -> SharedAsyncJournalPoolHelpers.acquireOrStartEntry entries directory startReady)

    member _.SettleSuccess(directory: string, readyTask: obj, instance: obj): unit =
        lock gate (fun () -> SharedAsyncJournalPoolHelpers.settleSuccessEntry entries directory readyTask instance)

    member _.SettleFailure(directory: string, readyTask: obj): unit =
        lock gate (fun () -> SharedAsyncJournalPoolHelpers.settleFailureEntry entries directory readyTask)

    member _.ReleaseTarget(target: obj): obj option =
        lock gate (fun () -> SharedAsyncJournalPoolHelpers.releaseTargetEntry entries target)

    member _.SnapshotCount(directory: string): int =
        lock gate (fun () -> SharedAsyncJournalPoolHelpers.countEntry entries directory)

    member _.Clear(): unit =
        lock gate (fun () -> entries.Clear())

// ----------------------------------------------------------------------------
// Process-wide singletons
// ----------------------------------------------------------------------------

let rootWorkspaceCell = RootWorkspaceCell()
let sharedEventStorePool = SharedEventStorePool()
let sharedAsyncJournalPool = SharedAsyncJournalPool()
