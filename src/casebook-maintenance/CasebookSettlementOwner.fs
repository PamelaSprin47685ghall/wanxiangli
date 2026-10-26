module Wanxiangli.CasebookMaintenance.CasebookSettlementOwner

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// Owner of the Casebook settlement outcomes (Package-09).
///
/// Conflicts that affect cases make them unavailable and are reported once.
/// Safe reporting: exceptions in onConflict are swallowed without affecting outcomes.
/// Redeliver checks ReferenceEquals to ensure incidents are from the original settled owner.
[<AttachMembers>]
type CasebookSettlementOwner(onConflict: obj -> unit) as this =
    let gate = obj ()
    let conflicts = Dictionary<string, obj>()

    do
        if isNull (box onConflict) then
            nullArg "onConflict"
        this?observe <- (fun e k i -> this.Observe(e, k, i))
        this?redeliver <- (fun e i -> this.Redeliver(e, i))

    let claim (eventId: string) (incident: obj) : obj * bool =
        lock gate (fun () ->
            match conflicts.TryGetValue eventId with
            | true, existing -> existing, false
            | false, _ ->
                conflicts.Add(eventId, incident)
                incident, true)

    let report (incident: obj) : unit =
        try
            onConflict incident
        with _ ->
            ()

    let settleStorageInvalid (eventId: string) (incident: obj) : string =
        let claimed, firstDelivery = claim eventId incident
        if firstDelivery then
            report claimed
        "LogScopeFailure"

    let settleSemanticCut (eventId: string) (incident: obj) : string =
        let _, firstDelivery = claim eventId incident
        if firstDelivery then
            report incident
            "CaseUnavailable"
        else
            "CaseUnavailableKnown"

    member _.Observe(eventId: string, kind: string, incident: obj) : string =
        match kind with
        | "Unscoped" -> "Unscoped"
        | "StorageInvalid" -> settleStorageInvalid eventId incident
        | _ -> settleSemanticCut eventId incident

    member _.Redeliver(eventId: string, incident: obj) : string =
        let owned =
            lock gate (fun () ->
                match conflicts.TryGetValue eventId with
                | true, existing -> obj.ReferenceEquals(existing, incident)
                | false, _ -> false)

        if not owned then
            invalidArg "incident" "A Casebook incident must come from its original settled owner"

        "CaseUnavailableKnown"

    member _.SnapshotCount : int =
        lock gate (fun () -> conflicts.Count)
