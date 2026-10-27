module Wanxiangli.Lifecycle.PlanAskGate

open System
open System.Collections.Generic
open Fable.Core

// ----------------------------------------------------------------------------
// PlanAskGate: process-local single-flight gate for ask delegations
// ----------------------------------------------------------------------------

module private PlanAskGateHelpers =
    let cleanWorkId (workId: string) : string option =
        match workId with
        | null -> None
        | s when String.IsNullOrWhiteSpace s -> None
        | s -> Some s

    let tryBeginWork (pending: HashSet<string>) (workId: string) : bool =
        match cleanWorkId workId with
        | None -> false
        | Some id -> pending.Add id

    let clearWork (pending: HashSet<string>) (workId: string) : unit =
        match cleanWorkId workId with
        | None -> ()
        | Some id -> pending.Remove id |> ignore

    let isWorkPending (pending: HashSet<string>) (workId: string) : bool =
        match cleanWorkId workId with
        | None -> false
        | Some id -> pending.Contains id

    let snapshotWorks (pending: HashSet<string>) : string array =
        pending
        |> Seq.toArray
        |> Array.sort

[<AttachMembers>]
type PlanAskGate() =
    let gate = obj ()
    let pendingWorks = HashSet<string>()

    member _.tryBegin(workId: string): bool =
        lock gate (fun () -> PlanAskGateHelpers.tryBeginWork pendingWorks workId)

    member _.clear(workId: string): unit =
        lock gate (fun () -> PlanAskGateHelpers.clearWork pendingWorks workId)

    member _.isPending(workId: string): bool =
        lock gate (fun () -> PlanAskGateHelpers.isWorkPending pendingWorks workId)

    member _.clearAll(): unit =
        lock gate (fun () -> pendingWorks.Clear())

    member _.snapshot(): string array =
        lock gate (fun () -> PlanAskGateHelpers.snapshotWorks pendingWorks)

// ----------------------------------------------------------------------------
// Process-wide singleton
// ----------------------------------------------------------------------------

let planAskGate = PlanAskGate()
