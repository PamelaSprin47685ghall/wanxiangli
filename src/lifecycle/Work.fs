namespace Wanxiangli.Lifecycle

open Fable.Core
open Fable.Core.JsInterop
open Wire

[<AllowNullLiteral>]
type Journal =
    abstract read: stream: string -> string array
    abstract append: stream: string * expectedRevision: float * requestId: string * body: string -> obj

type private Decision = Write of Fact list | Observe of obj

module private Commands =
    let private retire (workId: string) (state: WorkState) (tenure: string) (fence: Fence) delivered retirementCursor operation session draft =
        let tag = if state.Sequence = WorkSequence.Plan then "oneshot-retirement-v1" else "retirement-v1"
        { Id = identity tag [ workId; fence.Run; fence.Call; Vocabulary.ending delivered; state.Authority ]
          Tenure = tenure; Delivered = delivered; Fence = fence; Expected = state.Authority
          Cursor = retirementCursor; Operation = operation; Session = session; Draft = draft }

    let decide (workId: string) (requestId: string) (state: WorkState) (command: obj) =
        let read key = text (get command key)
        let id key = identifier (get command key)
        let exact required optional = fields ("type" :: required) optional command
        let blockers () = strings (get command "blockers") |> Array.distinct |> Array.sort
        let blocked tenure reasons = Write [ Fact.RetirementBlocked(tenure, sha256 (canonical (box reasons))) ]
        match read "type" with
        | "Open" ->
            exact [ "root"; "sequence"; "ownerId"; "openingCursor" ] []
            let sequence = Vocabulary.readSequence (get command "sequence")
            let firstStage = if sequence = WorkSequence.Plan then 0 else 3
            Write [ Fact.WorkOpened(workId, read "root", sequence, identity "authority-initial-v1" [ workId ])
                    Fact.IncumbencyOpened(workId, identity "first-incumbency-v1" [ workId ], id "ownerId", firstStage, cursor (get command "openingCursor")) ]
        | "Review" ->
            exact [ "incumbencyId"; "reviewerId"; "findings" ] []
            let findings = strings (get command "findings")
            Write [ Fact.Reviewed(id "incumbencyId", { Stage = state.Stage; Promoted = Array.isEmpty findings; Reviewer = id "reviewerId" }) ]
        | "BindDevOps" ->
            exact [ "incumbencyId"; "trigger"; "devopsId"; "target" ] []
            state.RequireTenure(id "incumbencyId") |> ignore
            state.NoDelivery()
            let trigger = read "trigger"
            require ((state.Sequence = WorkSequence.Plan && trigger = "Ask") || (state.Sequence = WorkSequence.Execution && (trigger = "Resume" || trigger = "Horizon"))) "Bind trigger does not match the sequence"
            let devopsId, target = id "devopsId", optionalText command "target"
            match state.DevOps with
            | Some existing ->
                require (existing = (devopsId, target)) "DevOps binding conflict"
                Observe(Vocabulary.result "DevOpsBound" [ "devopsId", box devopsId ])
            | None -> Write [ Fact.DevOpsBound(devopsId, target) ]
        | "Advance" ->
            exact [ "incumbencyId"; "expected"; "next" ] []
            Write [ Fact.AdvanceCommitted(id "incumbencyId", id "expected", id "next") ]
        | "Reopen" ->
            exact [ "retirementId"; "ownerId"; "openingCursor"; "blockers" ] []
            require (Array.isEmpty (blockers ())) "Live resources block reopen"
            let retirementId = id "retirementId"
            Write [ Fact.Reopened retirementId
                    Fact.IncumbencyOpened(workId, identity "reopened-incumbency-v1" [ retirementId; requestId ], id "ownerId", state.Stage, cursor (get command "openingCursor")) ]
        | "Deliver" ->
            exact [ "incumbencyId"; "providerRunId"; "toolCallId"; "cursor"; "blockers" ] [ "nextOwnerId"; "draft" ]
            let tenureId, fence = id "incumbencyId", Vocabulary.fence command
            let observedCursor = cursor (get command "cursor")
            let reasons = blockers ()
            let nextOwner = optionalText command "nextOwnerId"
            let draft =
                if not (has command "draft") || isNull (get command "draft") then None
                else
                    let value = get command "draft"
                    fields [ "digest"; "path" ] [] value
                    Some(Vocabulary.draft value)
            require (state.Sequence = WorkSequence.Plan || draft.IsNone) "S4 does not accept a delivery draft"
            match state.TryFence fence with
            | Some result -> Observe result
            | None ->
                let tenure = state.RequireTenure tenureId
                state.NoDelivery()
                if state.Sequence = WorkSequence.Execution && tenure.Review.IsNone then
                    Observe(Vocabulary.result "ReviewRequired" [])
                elif state.Sequence = WorkSequence.Execution && tenure.Confirmation.IsNone then
                    Write [ Fact.ConfirmationCommitted(tenureId, fence) ]
                elif not (Array.isEmpty reasons) then blocked tenureId reasons
                elif state.Sequence = WorkSequence.Plan && state.Authorized then
                    let selected = draft |> Option.defaultWith (fun () -> fail "Authorized delivery requires a draft")
                    Write [ Fact.DeliveryRequested
                                { Id = identity "delivery-operation-v1" [ workId; tenureId; state.Authority; requestId ]
                                  Tenure = tenureId; Fence = fence; Cursor = observedCursor; Draft = selected } ]
                else
                    let delivered = state.Sequence = WorkSequence.Execution && tenure.Review.Value.Promoted
                    let retirementCursor = if state.Sequence = WorkSequence.Plan then Some observedCursor else None
                    let retired = retire workId state tenureId fence delivered retirementCursor None None None
                    if delivered then Write [ Fact.IncumbencyRetired retired ]
                    else
                        let owner = nextOwner |> Option.defaultWith (fun () -> fail "Relay requires nextOwnerId")
                        Write [ Fact.IncumbencyRetired retired
                                Fact.IncumbencyOpened(workId, identity "successor-incumbency-v1" [ retired.Id ], owner, state.Stage, observedCursor) ]
        | "ResolveDelivery" ->
            let outcome = read "outcome"
            let extra =
                match outcome with
                | "Accepted" -> [ "execSessionId"; "digest"; "path"; "blockers" ]
                | "NotStarted" -> [ "reason" ]
                | "Unknown" -> []
                | _ -> fail "Unknown execution observation"
            exact ([ "operationId"; "outcome" ] @ extra) []
            let operation = id "operationId"
            let accepted =
                if outcome = "Accepted" then Some(id "execSessionId", Vocabulary.draft command, blockers ())
                else None
            match state.TryCompleted operation with
            | Some retired ->
                require (outcome <> "NotStarted") "Observation conflicts with an accepted execution"
                match accepted with
                | Some(session, draft, _) ->
                    require (retired.Session = Some session && retired.Draft = Some draft) "Execution receipt mismatch"
                | None -> ()
                Observe(state.TryOperation operation |> Option.get)
            | None ->
                match state.TryOperation operation with
                | Some previous when (state.Pending |> Option.map (fun delivery -> delivery.Id)) <> Some operation ->
                    require (outcome <> "Accepted") "Observation conflicts with a rejected execution"
                    if outcome = "NotStarted" then require (read "reason" = (get previous "reason" |> text)) "Execution rejection conflict"
                    Observe previous
                | _ ->
                    let delivery = state.Pending |> Option.defaultWith (fun () -> fail "No pending delivery")
                    require (delivery.Id = operation) "Delivery operation mismatch"
                    match outcome, accepted with
                    | "Unknown", _ -> Observe(state.TryOperation operation |> Option.get)
                    | "NotStarted", _ -> Write [ Fact.DeliveryRejected(delivery.Id, read "reason") ]
                    | _, Some(session, draft, reasons) ->
                        require (draft = delivery.Draft) "Execution receipt draft mismatch"
                        if not (Array.isEmpty reasons) then blocked delivery.Tenure reasons
                        else
                            Write [ Fact.IncumbencyRetired(retire workId state delivery.Tenure delivery.Fence true (Some delivery.Cursor) (Some delivery.Id) (Some session) (Some delivery.Draft)) ]
                    | _ -> fail "Execution observation is incomplete"
        | _ -> fail "Unknown work command"

[<AttachMembers>]
type Work(workId: string, journal: Journal) =
    do identifier (box workId) |> ignore
    let mutable unknownRequest: string option = None

    let load () =
        let state = WorkState(workId)
        let bodies = journal.read workId
        require (isArray (box bodies)) "Journal.read must return an array of committed bodies"
        for body in bodies do
            let frame = parse body
            fields [ "requestId"; "requestHash"; "events" ] [] frame
            require (canonical frame = body) "History body is not canonical JSON"
            let requestId = identifier (get frame "requestId")
            let hash = text (get frame "requestHash")
            require (hash.Length = 64 && hash |> Seq.forall (fun character -> "0123456789abcdef".Contains character)) "Invalid request hash"
            let encoded = get frame "events"
            require (isArray encoded) "Events must be an array"
            let facts = unbox<obj array> encoded |> Array.map FactCodec.decode |> Array.toList
            let result = state.Apply(requestId, facts)
            let operation = facts |> List.tryPick (function Fact.DeliveryRequested delivery -> Some delivery.Id | _ -> None)
            state.Remember(requestId, hash, result, operation)
        state, bodies

    let response (status: string) (revision: int) (result: obj) (reason: obj): obj =
        objectOf [ "status", box status; "revision", box revision; "result", result; "reason", reason ]

    let addFindings (command: obj) (result: obj) =
        if (unbox<string> (get command "type")) = "Review" && not (isNull result) then
            result?findings <- get command "findings"
        result

    member _.inspect(): obj =
        let state, _ = load ()
        state.Snapshot()

    member _.history(): obj array =
        let _, bodies = load ()
        bodies |> Array.map parse

    member _.recover(): obj =
        match unknownRequest with
        | Some requestId -> objectOf [ "next", box "ObserveCommit"; "requestId", box requestId; "state", null ]
        | None ->
            let state, _ = load ()
            state.Recovery()

    member _.execute(requestId: string, input: obj): obj =
        identifier (box requestId) |> ignore
        require unknownRequest.IsNone "Previous commit is unknown; reopen the journal and work before reconciliation"
        let encoded = canonical input
        let command = parse encoded
        let hash = sha256 encoded
        let state, _ = load ()
        match state.TryReceipt requestId with
        | Some receipt ->
            require (receipt.Hash = hash) "RequestIdConflict"
            response "Replayed" state.Revision (addFindings command (state.Replay receipt)) (null: obj)
        | None ->
            match Commands.decide workId requestId state command with
            | Observe result -> response "Observed" state.Revision result (null: obj)
            | Write facts ->
                let facts = facts |> List.map (FactCodec.encode >> FactCodec.decode)
                let revision = state.Revision
                let result = state.Apply(requestId, facts)
                let body = canonical (objectOf [ "requestId", box requestId; "requestHash", box hash; "events", box (facts |> List.map FactCodec.encode |> List.toArray) ])
                let acknowledgement =
                    try journal.append(workId, float revision, requestId, body)
                    with error -> objectOf [ "status", box "Unknown"; "revision", box revision; "reason", box error.Message ]
                let unknown (reason: obj): obj =
                    unknownRequest <- Some requestId
                    response "Unknown" revision (null: obj) reason
                try
                    fields [ "status"; "revision"; "reason" ] [] acknowledgement
                    let status = get acknowledgement "status" |> text
                    let committedRevision = get acknowledgement "revision" |> cursor
                    let reason = get acknowledgement "reason"
                    require (isNull reason || isString reason) "Invalid journal reason"
                    match status with
                    | "Committed" ->
                        if committedRevision <> float (revision + 1) then
                            unknown (box "Journal returned an unexpected commit revision")
                        else response "Committed" (revision + 1) (addFindings command result) (null: obj)
                    | "Replayed" ->
                        let current, _ = load ()
                        let receipt = current.TryReceipt requestId |> Option.defaultWith (fun () -> fail "Journal replay receipt is absent")
                        require (receipt.Hash = hash) "RequestIdConflict"
                        response "Replayed" current.Revision (addFindings command (current.Replay receipt)) (null: obj)
                    | "Conflict" | "NotWritten" -> response status revision (null: obj) reason
                    | "Unknown" -> unknown reason
                    | _ -> unknown (box "Unknown journal acknowledgement")
                with error -> unknown (box error.Message)
