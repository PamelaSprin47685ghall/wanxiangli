namespace Wanxiangli.Change

open System
open Fable.Core
open Fable.Core.JsInterop

type private HistoryState =
    { Jobs: Map<string, obj>
      Worktrees: Map<string, obj> }

module private HistoryWire =
    let text (value: obj) key : string = value?(key)
    let field (value: obj) key : obj = value?(key)
    let copy (value: obj) : obj = emitJsExpr value "JSON.parse(JSON.stringify($0))"
    let replace (value: obj) field (item: obj) : obj = emitJsExpr (value, createObj [ field ==> item ]) "Object.assign({}, $0, $1)"
    let optional = Option.map copy >> Option.defaultValue null

[<AttachMembers>]
type ChangeHistory(?snapshot: obj) =
    let state: HistoryState =
        snapshot |> Option.map unbox |> Option.defaultValue { Jobs = Map.empty; Worktrees = Map.empty }
    let text = HistoryWire.text
    let findJob id = Map.tryFind id state.Jobs
    let update id field value =
        match findJob id with
        | Some current when isNull (HistoryWire.field current "terminal") ->
            { state with Jobs = Map.add id (HistoryWire.replace current field value) state.Jobs }
        | _ -> state
    let accepted next = createObj [ "ok" ==> true; "history" ==> ChangeHistory(box next) ]
    let refused reason = createObj [ "ok" ==> false; "error" ==> reason ]

    member _.job(id: string) = findJob id |> HistoryWire.optional
    member _.jobBySession(session: string) =
        state.Jobs |> Map.tryPick (fun _ value -> if text value "session" = session then Some value else None)
        |> HistoryWire.optional
    member _.jobByName(name: string) =
        if String.IsNullOrWhiteSpace name then null
        else
            let wanted = name.Trim()
            state.Jobs |> Map.tryPick (fun _ value ->
                if String.Equals(text value "byname", wanted, StringComparison.OrdinalIgnoreCase) then Some value else None)
            |> HistoryWire.optional
    member _.activeJobs() =
        state.Jobs |> Map.toArray |> Array.choose (fun (_, value) ->
            if isNull (HistoryWire.field value "terminal") then Some(HistoryWire.copy value) else None)
    member _.worktreeEffect(identity: string) = Map.tryFind identity state.Worktrees |> HistoryWire.optional

    member _.apply(event: obj) : obj =
        let id = text event "id"
        let kind = text event "kind"
        let payload fields = fields |> List.map (fun key -> key, HistoryWire.copy (HistoryWire.field event key)) |> createObj
        match kind with
        | "ManagerJobCreated" ->
            if Map.containsKey id state.Jobs then accepted state
            else
                let byname = text event "byname"
                let created = createObj [
                    "id" ==> id; "session" ==> text event "session"; "agent" ==> text event "agent"
                    "byname" ==> (if String.IsNullOrWhiteSpace byname then text event "agent" else byname)
                    "worktreeIdentity" ==> text event "worktreeIdentity"; "worktreePath" ==> text event "worktreePath"
                    "target" ==> text event "target"; "targetBranchFrozen" ==> text event "targetBranchFrozen"
                    "candidate" ==> (null: obj); "conflict" ==> (null: obj); "rebased" ==> (null: obj); "claim" ==> (null: obj); "terminal" ==> (null: obj) ]
                accepted { state with Jobs = Map.add id created state.Jobs }
        | "CandidateReady" -> update id "candidate" (payload [ "commit" ]) |> accepted
        | "ConflictDetected" -> update id "conflict" (payload [ "commit"; "target"; "files"; "digest" ]) |> accepted
        | "RebasedCandidateReady" -> update id "rebased" (payload [ "commit"; "target" ]) |> accepted
        | "PublishClaimed" ->
            match findJob id |> Option.bind (fun value ->
                let rebased = HistoryWire.field value "rebased"
                if isNull rebased then None else Some rebased) with
            | None -> refused "PublishClaimedWithoutRebasedCandidate"
            | Some rebased when text rebased "commit" <> text event "commit" -> refused "PublishClaimedCommitMismatch"
            | Some _ -> update id "claim" (payload [ "target"; "commit"; "expected" ]) |> accepted
        | "Published" ->
            update id "terminal" (createObj [ "kind" ==> "Published"; "candidate" ==> text event "candidate"; "head" ==> text event "head" ]) |> accepted
        | "JobFailed" -> update id "terminal" (createObj [ "kind" ==> "Failed"; "reason" ==> text event "reason" ]) |> accepted
        | "JobAbandoned" -> update id "terminal" (createObj [ "kind" ==> "Abandoned" ]) |> accepted
        | "WorktreeCreateRequested"
        | "WorktreeCreated" ->
            let identity = text event "identity"
            let existing = Map.tryFind identity state.Worktrees
            let keep =
                match kind, existing with
                | "WorktreeCreateRequested", Some _ -> true
                | _, Some value when text value "kind" = "Created" -> true
                | _ -> false
            if keep then accepted state
            else
                let effect = createObj [ "kind" ==> (if kind = "WorktreeCreated" then "Created" else "Requested"); "id" ==> id; "path" ==> text event "path" ]
                accepted { state with Worktrees = Map.add identity effect state.Worktrees }
        | _ -> invalidArg "event.kind" ("Unknown Change event: " + kind)
