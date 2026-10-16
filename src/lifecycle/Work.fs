module Wanxiangli.Lifecycle.Work

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Lifecycle
open Wire

type IWork =
    abstract inspect: unit -> obj
    abstract history: unit -> obj array
    abstract records: unit -> string array
    abstract recover: unit -> obj
    abstract execute: requestId: string * command: obj -> obj

type private Decision = Write of Fact list | Observe of obj | Refuse of string

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
            // A second open on an existing work is a foreseeable refusal, not a
            // fold failure: leave the durable state untouched and return a typed
            // Conflict instead of writing a fact the fold must reject.
            if state.Opened then
                Refuse "Work is already open"
            else
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
                elif state.Sequence = WorkSequence.Plan
                     && tenure.Review.IsNone
                     && state.LastRoundWasUnreviewedRelay then
                    Observe(Vocabulary.result "ReviewRequired" [])
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
                | "SessionCreated" -> [ "execSessionId" ]
                | "NotStarted" -> [ "reason" ]
                | "Unknown" -> []
                | _ -> fail "Unknown execution observation"
            exact ([ "operationId"; "outcome" ] @ extra) []
            let operation = id "operationId"
            let accepted =
                if outcome = "Accepted" then Some(id "execSessionId", Vocabulary.draft command, blockers ())
                else None
            let createdSession = if outcome = "SessionCreated" then Some(id "execSessionId") else None
            match state.TryCompleted operation with
            | Some retired ->
                require (outcome <> "NotStarted") "Observation conflicts with an accepted execution"
                match accepted with
                | Some(session, draft, _) ->
                    require (retired.Session = Some session && retired.Draft = Some draft) "Execution receipt mismatch"
                | None -> ()
                match createdSession with
                | Some session -> require (retired.Session = Some session) "Execution session mismatch"
                | None -> ()
                Observe(state.TryOperation operation |> Option.get)
            | None ->
                match state.TryOperation operation with
                | Some previous when (state.Pending |> Option.map (fun delivery -> delivery.Id)) <> Some operation ->
                    match outcome with
                    | "Unknown" -> Observe previous
                    | "NotStarted" ->
                        require (read "reason" = (get previous "reason" |> text)) "Execution rejection conflict"
                        Observe previous
                    | _ -> fail "Observation conflicts with a rejected execution"
                | _ ->
                    let delivery = state.Pending |> Option.defaultWith (fun () -> fail "No pending delivery")
                    require (delivery.Id = operation) "Delivery operation mismatch"
                    match outcome, accepted, createdSession with
                    | "Unknown", _, _ -> Observe(state.TryOperation operation |> Option.get)
                    | "NotStarted", _, _ -> Write [ Fact.DeliveryRejected(delivery.Id, read "reason") ]
                    | "SessionCreated", _, Some session ->
                        match state.PendingSession with
                        | Some existing ->
                            require (existing = session) "Execution session mismatch"
                            Observe(state.TryOperation operation |> Option.get)
                        | None -> Write [ Fact.DeliverySessionBound(delivery.Id, session) ]
                    | _, Some(session, draft, reasons), _ ->
                        require (state.PendingSession = Some session) "Execution session is not durably bound"
                        require (draft = delivery.Draft) "Execution receipt draft mismatch"
                        if not (Array.isEmpty reasons) then blocked delivery.Tenure reasons
                        else
                            Write [ Fact.IncumbencyRetired(retire workId state delivery.Tenure delivery.Fence true (Some delivery.Cursor) (Some delivery.Id) (Some session) (Some delivery.Draft)) ]
                    | _ -> fail "Execution observation is incomplete"
        | _ -> fail "Unknown work command"

let Work (workId: string) (records: string array option): IWork =
    do identifier (box workId) |> ignore

    let rebuild (bodies: string array) =
        let state = WorkState(workId)
        require (isArray (box bodies)) "History must be an array of records, not a service"
        for body in bodies do
            require (isString (box body)) "History records must be text"
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
        state

    let mutable saved = defaultArg records [||]
    let mutable state = rebuild saved
    do saved <- Array.copy saved
    let mutable busy = false

    let guard action =
        require (not busy) "Work does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let detached value = value |> canonical |> parse

    let response status revision result record =
        objectOf [ "status", box status; "revision", box revision; "result", result; "record", record ]

    let addFindings (command: obj) (result: obj) =
        let result = detached result
        if (unbox<string> (get command "type")) = "Review" && not (isNull result) then
            result?findings <- detached (get command "findings")
        result

    let inspect () = guard (fun () -> detached (state.Snapshot()))

    let history () = guard (fun () -> saved |> Array.map parse)

    let records () = guard (fun () -> Array.copy saved)

    let recover () = guard (fun () -> detached (state.Recovery()))

    let execute (requestId: string, input: obj): obj =
        guard (fun () ->
            identifier (box requestId) |> ignore
            let encoded = canonical input
            let command = parse encoded
            let hash = sha256 encoded
            match state.TryReceipt requestId with
            | Some receipt ->
                if receipt.Hash = hash then
                    response "Replayed" state.Revision (addFindings command (state.Replay receipt)) (null: obj)
                else
                    // 同一 requestId 的异载荷是可预见的冲突：返回结构化结果，不写、不抛。
                    response "Conflict" state.Revision (null: obj) (box "RequestIdConflict")
            | None ->
                match Commands.decide workId requestId state command with
                | Refuse reason -> response "Conflict" state.Revision (null: obj) (box reason)
                | Observe result -> response "Observed" state.Revision (addFindings command result) (null: obj)
                | Write facts ->
                    // 事务在私有候选上完成；任何验证失败都不改变当前个体。
                    let candidate = rebuild saved
                    let facts = facts |> List.map (FactCodec.encode >> FactCodec.decode)
                    let result = candidate.Apply(requestId, facts)
                    let body = canonical (objectOf [ "requestId", box requestId; "requestHash", box hash; "events", box (facts |> List.map FactCodec.encode |> List.toArray) ])
                    let operation = facts |> List.tryPick (function Fact.DeliveryRequested delivery -> Some delivery.Id | _ -> None)
                    candidate.Remember(requestId, hash, result, operation)
                    let reply = response "Applied" candidate.Revision (addFindings command result) (box body)
                    let next = Array.append saved [| body |]
                    saved <- next
                    state <- candidate
                    reply)

    { new IWork with
        member _.inspect() = inspect ()
        member _.history() = history ()
        member _.records() = records ()
        member _.recover() = recover ()
        member _.execute(requestId, input) = execute (requestId, input) }
