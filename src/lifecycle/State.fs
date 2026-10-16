namespace Wanxiangli.Lifecycle

open System.Collections.Generic
open Wire

[<RequireQualifiedAccess>]
type internal WorkSequence = Plan | Execution

type internal Fence = { Run: string; Call: string }
type internal Draft = { Digest: string; Path: string }
type internal Review = { Stage: int; Promoted: bool; Reviewer: string }
type internal Delivery = { Id: string; Tenure: string; Fence: Fence; Cursor: float; Draft: Draft }
type internal Retirement =
    { Id: string
      Tenure: string
      Delivered: bool
      Fence: Fence
      Expected: string
      Cursor: float option
      Operation: string option
      Session: string option
      Draft: Draft option }

[<RequireQualifiedAccess>]
type internal Fact =
    | WorkOpened of workId: string * root: string * sequence: WorkSequence * authority: string
    | IncumbencyOpened of workId: string * id: string * owner: string * stage: int * cursor: float
    | Reviewed of tenure: string * review: Review
    | ConfirmationCommitted of tenure: string * fence: Fence
    | IncumbencyRetired of Retirement
    | DevOpsBound of id: string * target: string option
    | AdvanceCommitted of tenure: string * expected: string * next: string
    | Reopened of retirementId: string
    | RetirementBlocked of tenure: string * digest: string
    | DeliveryRequested of Delivery
    | DeliverySessionBound of operationId: string * sessionId: string
    | DeliveryRejected of operationId: string * reason: string

module internal Vocabulary =
    let stages = [| "S1"; "S2"; "S3"; "S4" |]
    let stage index = stages[index]
    let outcome promoted = if promoted then "Promoted" else "Stayed"
    let ending delivered = if delivered then "Delivered" else "Relayed"
    let sequence = function WorkSequence.Plan -> [| "S1"; "S2"; "S3" |] | WorkSequence.Execution -> [| "S4" |]

    let readStage value =
        let name = text value
        match stages |> Array.tryFindIndex ((=) name) with
        | Some index -> index
        | None -> fail "Unknown stage"

    let readSequence value =
        match strings value with
        | [| "S1"; "S2"; "S3" |] -> WorkSequence.Plan
        | [| "S4" |] -> WorkSequence.Execution
        | _ -> fail "Sequence must be S1/S2/S3 or S4"

    let readChoice yes no value =
        match text value with
        | name when name = yes -> true
        | name when name = no -> false
        | _ -> fail ("Expected " + yes + " or " + no)

    let fence (value: obj) = { Run = identifier (get value "providerRunId"); Call = identifier (get value "toolCallId") }
    let draft (value: obj) = { Digest = text (get value "digest"); Path = text (get value "path") }
    let result kind values = objectOf (("kind", box kind) :: values)

module internal FactCodec =
    let encode fact =
        let make name values = objectOf (("type", box name) :: values)
        let fenceFields fence = [ "providerRunId", box fence.Run; "toolCallId", box fence.Call ]
        match fact with
        | Fact.WorkOpened(workId, root, sequence, authority) ->
            make "WorkOpened" [ "workId", box workId; "root", box root; "sequence", box (Vocabulary.sequence sequence); "authorityInitial", box authority ]
        | Fact.IncumbencyOpened(workId, id, owner, stage, cursor) ->
            make "IncumbencyOpened" [ "workId", box workId; "incumbencyId", box id; "ownerId", box owner; "stage", box (Vocabulary.stage stage); "openingCursor", box cursor ]
        | Fact.Reviewed(tenure, review) ->
            make "Reviewed" [ "incumbencyId", box tenure; "stage", box (Vocabulary.stage review.Stage); "outcome", box (Vocabulary.outcome review.Promoted); "reviewerId", box review.Reviewer ]
        | Fact.ConfirmationCommitted(tenure, fence) ->
            make "ConfirmationCommitted" (("incumbencyId", box tenure) :: fenceFields fence)
        | Fact.IncumbencyRetired retired ->
            let common =
                [ "retirementId", box retired.Id; "incumbencyId", box retired.Tenure
                  "outcome", box (Vocabulary.ending retired.Delivered); "expectedAdvance", box retired.Expected ]
            let physical =
                match retired.Cursor with
                | Some cursor -> ("retirementCursor", box cursor) :: fenceFields retired.Fence
                | None -> [ "projectionCut", objectOf (fenceFields retired.Fence) ]
            let execution =
                match retired.Operation, retired.Session, retired.Draft with
                | Some operation, Some session, Some draft ->
                    [ "operationId", box operation; "execSessionId", box session; "digest", box draft.Digest; "path", box draft.Path ]
                | None, None, None -> []
                | _ -> fail "Incomplete execution receipt"
            make "IncumbencyRetired" (common @ physical @ execution)
        | Fact.DevOpsBound(id, target) -> make "DevOpsBound" [ "devopsId", box id; "target", nullable target ]
        | Fact.AdvanceCommitted(tenure, expected, next) ->
            make "AdvanceCommitted" [ "incumbencyId", box tenure; "expected", box expected; "next", box next ]
        | Fact.Reopened retirementId -> make "Reopened" [ "retirementId", box retirementId ]
        | Fact.RetirementBlocked(tenure, digest) -> make "RetirementBlocked" [ "incumbencyId", box tenure; "blockerDigest", box digest ]
        | Fact.DeliveryRequested delivery ->
            make "DeliveryRequested"
                ([ "operationId", box delivery.Id; "incumbencyId", box delivery.Tenure
                   "retirementCursor", box delivery.Cursor; "digest", box delivery.Draft.Digest; "path", box delivery.Draft.Path ] @ fenceFields delivery.Fence)
        | Fact.DeliverySessionBound(operation, session) ->
            make "DeliverySessionBound" [ "operationId", box operation; "execSessionId", box session ]
        | Fact.DeliveryRejected(operation, reason) -> make "DeliveryRejected" [ "operationId", box operation; "reason", box reason ]

    let decode (value: obj) =
        let read key = text (get value key)
        let id key = identifier (get value key)
        let exact names = fields ("type" :: names) [] value
        match read "type" with
        | "WorkOpened" ->
            exact [ "workId"; "root"; "sequence"; "authorityInitial" ]
            Fact.WorkOpened(id "workId", read "root", Vocabulary.readSequence (get value "sequence"), id "authorityInitial")
        | "IncumbencyOpened" ->
            exact [ "workId"; "incumbencyId"; "ownerId"; "stage"; "openingCursor" ]
            Fact.IncumbencyOpened(id "workId", id "incumbencyId", id "ownerId", Vocabulary.readStage (get value "stage"), cursor (get value "openingCursor"))
        | "Reviewed" ->
            exact [ "incumbencyId"; "stage"; "outcome"; "reviewerId" ]
            Fact.Reviewed(id "incumbencyId", { Stage = Vocabulary.readStage (get value "stage"); Promoted = Vocabulary.readChoice "Promoted" "Stayed" (get value "outcome"); Reviewer = id "reviewerId" })
        | "ConfirmationCommitted" ->
            exact [ "incumbencyId"; "providerRunId"; "toolCallId" ]
            Fact.ConfirmationCommitted(id "incumbencyId", Vocabulary.fence value)
        | "IncumbencyRetired" ->
            let physicalFields, fence, retirementCursor =
                if has value "projectionCut" then
                    let cut = get value "projectionCut"
                    fields [ "providerRunId"; "toolCallId" ] [] cut
                    [ "projectionCut" ], Vocabulary.fence cut, None
                else
                    [ "providerRunId"; "toolCallId"; "retirementCursor" ], Vocabulary.fence value, Some(cursor (get value "retirementCursor"))
            let executionFields, operation, session, draft =
                if has value "operationId" then
                    [ "operationId"; "execSessionId"; "digest"; "path" ], Some(id "operationId"), Some(id "execSessionId"), Some(Vocabulary.draft value)
                else [], None, None, None
            exact ([ "retirementId"; "incumbencyId"; "outcome"; "expectedAdvance" ] @ physicalFields @ executionFields)
            Fact.IncumbencyRetired
                { Id = id "retirementId"; Tenure = id "incumbencyId"; Delivered = Vocabulary.readChoice "Delivered" "Relayed" (get value "outcome")
                  Fence = fence; Expected = id "expectedAdvance"; Cursor = retirementCursor; Operation = operation; Session = session; Draft = draft }
        | "DevOpsBound" ->
            exact [ "devopsId"; "target" ]
            Fact.DevOpsBound(id "devopsId", optionalText value "target")
        | "AdvanceCommitted" ->
            exact [ "incumbencyId"; "expected"; "next" ]
            Fact.AdvanceCommitted(id "incumbencyId", id "expected", id "next")
        | "Reopened" -> exact [ "retirementId" ]; Fact.Reopened(id "retirementId")
        | "RetirementBlocked" -> exact [ "incumbencyId"; "blockerDigest" ]; Fact.RetirementBlocked(id "incumbencyId", id "blockerDigest")
        | "DeliveryRequested" ->
            exact [ "operationId"; "incumbencyId"; "providerRunId"; "toolCallId"; "retirementCursor"; "digest"; "path" ]
            Fact.DeliveryRequested { Id = id "operationId"; Tenure = id "incumbencyId"; Fence = Vocabulary.fence value; Cursor = cursor (get value "retirementCursor"); Draft = Vocabulary.draft value }
        | "DeliverySessionBound" ->
            exact [ "operationId"; "execSessionId" ]
            Fact.DeliverySessionBound(id "operationId", id "execSessionId")
        | "DeliveryRejected" -> exact [ "operationId"; "reason" ]; Fact.DeliveryRejected(id "operationId", read "reason")
        | _ -> fail "Unknown lifecycle event"

type internal Tenure(id: string, owner: string, openingStage: int, openingCursor: float) =
    member _.Id = id
    member _.Owner = owner
    member _.OpeningStage = openingStage
    member _.OpeningCursor = openingCursor
    member val Review: Review option = None with get, set
    member val Confirmation: Fence option = None with get, set

type internal Receipt = { Hash: string; Result: obj; Operation: string option }

type internal WorkState(workId: string) =
    let mutable opened = false
    let mutable root = ""
    let mutable sequence = WorkSequence.Plan
    let mutable stage = 0
    let mutable authority = ""
    let mutable authorized = false
    let mutable active: Tenure option = None
    let mutable devops: (string * string option) option = None
    let mutable pending: Delivery option = None
    let mutable pendingSession: string option = None
    let mutable lastRetirement: Retirement option = None
    let mutable lastCursor = 0.
    let advances = HashSet<string>()
    let receipts = Dictionary<string, Receipt>()
    let fences = Dictionary<string, string * obj>()
    let operations = Dictionary<string, obj>()
    let completedOperations = Dictionary<string, Retirement>()
    let rounds = ResizeArray<obj>()

    let current () = active |> Option.defaultWith (fun () -> fail "No active incumbency")
    let requireTenure id =
        let tenure = current ()
        require (tenure.Id = id) "Incumbency mismatch"
        tenure

    let noDelivery () =
        require (pending.IsNone && pendingSession.IsNone) "Delivery is pending; observe the existing operation"

    let observeDelivery (delivery: Delivery) =
        Vocabulary.result
            "ObserveExecution"
            [ "operationId", box delivery.Id
              "digest", box delivery.Draft.Digest
              "path", box delivery.Draft.Path
              "execSessionId", nullable pendingSession ]

    let rememberFence (fence: Fence) result replace =
        require (replace || not (fences.ContainsKey fence.Call)) "Tool call already belongs to another transition"
        fences[fence.Call] <- fence.Run, result

    let retirementId (retired: Retirement) =
        let tag = if sequence = WorkSequence.Plan then "oneshot-retirement-v1" else "retirement-v1"
        identity tag [ workId; retired.Fence.Run; retired.Fence.Call; Vocabulary.ending retired.Delivered; authority ]

    let retire (retired: Retirement) =
        let tenure = requireTenure retired.Tenure
        require (retired.Expected = authority && retired.Id = retirementId retired) "Retirement identity conflict"
        if sequence = WorkSequence.Plan then
            require retired.Cursor.IsSome "Plan retirement requires a cursor"
            require (retired.Cursor.Value >= tenure.OpeningCursor && retired.Cursor.Value >= lastCursor) "Retirement cursor moved backwards"
            if retired.Delivered then
                require authorized "Plan is not authorized for delivery"
                let delivery = pending |> Option.defaultWith (fun () -> fail "Delivery was not reserved")
                require
                    (retired.Operation = Some delivery.Id
                     && retired.Fence = delivery.Fence
                     && retired.Draft = Some delivery.Draft
                     && retired.Cursor = Some delivery.Cursor
                     && retired.Session = pendingSession
                     && pendingSession.IsSome)
                    "Execution receipt mismatch"
            else
                noDelivery ()
                require (not authorized) "Authorized plan must deliver through an execution receipt"
                require (retired.Operation.IsNone && retired.Session.IsNone && retired.Draft.IsNone) "Relay cannot carry an execution receipt"
            lastCursor <- retired.Cursor.Value
        else
            noDelivery ()
            require (retired.Cursor.IsNone && retired.Operation.IsNone && retired.Session.IsNone && retired.Draft.IsNone) "Execution retirement has plan-only fields"
            let review = tenure.Review |> Option.defaultWith (fun () -> fail "Review is required")
            let confirmed = tenure.Confirmation |> Option.defaultWith (fun () -> fail "Confirmation is required")
            require (retired.Fence.Call <> confirmed.Call && retired.Delivered = review.Promoted) "Second delivery must use another call and the review outcome"
        let result = Vocabulary.result (Vocabulary.ending retired.Delivered) [ "retirementId", box retired.Id; "incumbencyId", box retired.Tenure ]
        rememberFence retired.Fence result (retired.Operation.IsSome)
        match retired.Operation with
        | Some operation ->
            operations[operation] <- result
            completedOperations.Add(operation, retired)
        | None -> ()
        rounds.Add(objectOf
            [ "incumbencyId", box tenure.Id; "ownerId", box tenure.Owner
              "openingStage", box (Vocabulary.stage tenure.OpeningStage); "closingStage", box (Vocabulary.stage stage)
              "openingCursor", box tenure.OpeningCursor; "retirementCursor", nullableCursor retired.Cursor
              "reviewOutcome", nullable (tenure.Review |> Option.map (fun review -> Vocabulary.outcome review.Promoted))
              "outcome", box (Vocabulary.ending retired.Delivered); "retirementId", box retired.Id ])
        active <- None
        pending <- None
        pendingSession <- None
        lastRetirement <- Some retired
        result

    member _.Opened = opened
    member _.Sequence = sequence
    member _.Stage = stage
    member _.Authority = authority
    member _.Authorized = authorized
    member _.Active = active
    member _.Pending = pending
    member _.PendingSession = pendingSession
    member _.DevOps = devops
    member _.LastRetirement = lastRetirement
    member _.Revision = receipts.Count
    member _.RequireTenure id = requireTenure id
    member _.NoDelivery() = noDelivery ()

    /// The last committed retirement, if any: an unreviewed Plan relay that
    /// opened the current tenure. Two consecutive unreviewed relays is the
    /// no-op handoff chain the kernel must refuse.
    member _.LastRoundWasUnreviewedRelay =
        match rounds.Count with
        | 0 -> false
        | count ->
            let last = rounds[count - 1]
            isNull (get last "reviewOutcome") && text (get last "outcome") = "Relayed"

    member _.TryReceipt id =
        match receipts.TryGetValue id with true, receipt -> Some receipt | _ -> None

    member _.TryOperation id =
        match operations.TryGetValue id with true, result -> Some result | _ -> None

    member _.TryCompleted id =
        match completedOperations.TryGetValue id with true, retired -> Some retired | _ -> None

    member _.Replay(receipt: Receipt) =
        match receipt.Operation with
        | Some operation -> operations[operation]
        | None -> receipt.Result

    member _.TryFence(fence: Fence) =
        match fences.TryGetValue fence.Call with
        | true, (run, result) ->
            require (run = fence.Run) "RetirementConfirmationReplayConflict"
            Some result
        | _ -> None

    member _.Remember(requestId, hash, result, operation) =
        require (not (receipts.ContainsKey requestId)) "Duplicate request in history"
        receipts.Add(requestId, { Hash = hash; Result = result; Operation = operation })

    member _.Apply(requestId: string, facts: Fact list): obj =
        match facts with
        | [ Fact.WorkOpened(id, openedRoot, openedSequence, initial); Fact.IncumbencyOpened(openedId, tenureId, owner, openingStage, openingCursor) ] ->
            require (not opened && id = workId && openedId = workId) "Work is already open or identity differs"
            require (initial = identity "authority-initial-v1" [ workId ]) "Initial authority mismatch"
            require (tenureId = identity "first-incumbency-v1" [ workId ]) "First incumbency identity mismatch"
            require (openingStage = (if openedSequence = WorkSequence.Plan then 0 else 3)) "Invalid first stage"
            opened <- true
            root <- openedRoot
            sequence <- openedSequence
            stage <- openingStage
            authority <- initial
            advances.Add initial |> ignore
            lastCursor <- openingCursor
            active <- Some(Tenure(tenureId, owner, stage, openingCursor))
            Vocabulary.result "Opened" [ "incumbencyId", box tenureId ]
        | [ Fact.IncumbencyRetired retired; Fact.IncumbencyOpened(id, tenureId, owner, openingStage, openingCursor) ] ->
            require (not retired.Delivered && id = workId) "Successor must follow a relay"
            require (tenureId = identity "successor-incumbency-v1" [ retired.Id ] && openingStage = stage) "Successor identity or stage mismatch"
            require (openingCursor >= (current ()).OpeningCursor && openingCursor >= lastCursor) "Successor cursor moved backwards"
            if sequence = WorkSequence.Plan then require (retired.Cursor = Some openingCursor) "Plan successor cursor differs from retirement"
            let result = retire retired
            lastCursor <- openingCursor
            active <- Some(Tenure(tenureId, owner, stage, openingCursor))
            let response = objectOf [ "kind", box "Relayed"; "retirementId", get result "retirementId"; "incumbencyId", box retired.Tenure; "successorId", box tenureId; "autoDispatch", box (sequence = WorkSequence.Execution) ]
            fences[retired.Fence.Call] <- retired.Fence.Run, response
            response
        | [ Fact.IncumbencyRetired retired ] ->
            require retired.Delivered "Relay is missing its successor"
            retire retired
        | [ Fact.Reviewed(id, review) ] ->
            noDelivery ()
            let tenure = requireTenure id
            require tenure.Review.IsNone "Incumbency already reviewed"
            require (review.Reviewer <> tenure.Owner) "An owner cannot review its own incumbency"
            require (review.Stage = stage) "Review stage mismatch"
            tenure.Review <- Some review
            if sequence = WorkSequence.Plan && review.Promoted then
                if stage < 2 then stage <- stage + 1
                else authorized <- true
            Vocabulary.result "Reviewed" [ "outcome", box (Vocabulary.outcome review.Promoted); "stage", box (Vocabulary.stage stage) ]
        | [ Fact.ConfirmationCommitted(id, fence) ] ->
            noDelivery ()
            let tenure = requireTenure id
            require (sequence = WorkSequence.Execution && tenure.Review.IsSome && tenure.Confirmation.IsNone) "Confirmation requires an unconfirmed reviewed S4 incumbency"
            tenure.Confirmation <- Some fence
            let result = Vocabulary.result "Confirmed" [ "incumbencyId", box id ]
            rememberFence fence result false
            result
        | [ Fact.DevOpsBound(id, target) ] ->
            current () |> ignore
            noDelivery ()
            require devops.IsNone "DevOps is already bound"
            devops <- Some(id, target)
            Vocabulary.result "DevOpsBound" [ "devopsId", box id ]
        | [ Fact.AdvanceCommitted(id, expected, next) ] ->
            noDelivery ()
            let tenure = requireTenure id
            require (tenure.Review.IsSome && expected = authority && not (advances.Contains next)) "Invalid authority advance"
            advances.Add next |> ignore
            authority <- next
            Vocabulary.result "Advanced" [ "authority", box next ]
        | [ Fact.Reopened(retirementId); Fact.IncumbencyOpened(id, tenureId, owner, openingStage, openingCursor) ] ->
            noDelivery ()
            require (sequence = WorkSequence.Plan && active.IsNone && id = workId) "Only an inactive delivered plan can reopen"
            let retired = lastRetirement |> Option.defaultWith (fun () -> fail "No retirement to reopen")
            require (retired.Delivered && retired.Id = retirementId) "Reopen retirement mismatch"
            require (tenureId = identity "reopened-incumbency-v1" [ retirementId; requestId ] && openingStage = stage && openingCursor >= lastCursor) "Invalid reopened incumbency"
            authorized <- false
            lastCursor <- openingCursor
            active <- Some(Tenure(tenureId, owner, stage, openingCursor))
            Vocabulary.result "Reopened" [ "incumbencyId", box tenureId ]
        | [ Fact.RetirementBlocked(id, digest) ] ->
            requireTenure id |> ignore
            Vocabulary.result "Blocked" [ "blockerDigest", box digest ]
        | [ Fact.DeliveryRequested delivery ] ->
            noDelivery ()
            let tenure = requireTenure delivery.Tenure
            require (sequence = WorkSequence.Plan && authorized) "Plan is not authorized for delivery"
            require (delivery.Id = identity "delivery-operation-v1" [ workId; delivery.Tenure; authority; requestId ]) "Delivery operation identity mismatch"
            require (delivery.Cursor >= tenure.OpeningCursor && delivery.Cursor >= lastCursor) "Delivery cursor moved backwards"
            let observed = observeDelivery delivery
            rememberFence delivery.Fence observed false
            operations.Add(delivery.Id, observed)
            pending <- Some delivery
            pendingSession <- None
            Vocabulary.result "DeliveryRequested" [ "operationId", box delivery.Id; "digest", box delivery.Draft.Digest; "path", box delivery.Draft.Path ]
        | [ Fact.DeliverySessionBound(operation, session) ] ->
            let delivery = pending |> Option.defaultWith (fun () -> fail "No pending delivery")
            require (delivery.Id = operation) "Delivery operation mismatch"
            require pendingSession.IsNone "Execution session is already bound"
            pendingSession <- Some session
            let result =
                Vocabulary.result
                    "ExecutionSessionBound"
                    [ "operationId", box operation
                      "execSessionId", box session
                      "digest", box delivery.Draft.Digest
                      "path", box delivery.Draft.Path ]
            operations[operation] <- result
            result
        | [ Fact.DeliveryRejected(operation, reason) ] ->
            let delivery = pending |> Option.defaultWith (fun () -> fail "No pending delivery")
            require (delivery.Id = operation) "Delivery operation mismatch"
            let result = Vocabulary.result "ExecutionRejected" [ "operationId", box operation; "reason", box reason ]
            operations[operation] <- result
            fences[delivery.Fence.Call] <- delivery.Fence.Run, result
            pending <- None
            pendingSession <- None
            result
        | _ -> fail "Invalid lifecycle transaction; atomic event pair is incomplete or vocabulary is invalid"

    member _.Snapshot(): obj =
        let tenureView =
            active |> Option.map (fun tenure ->
                objectOf [ "id", box tenure.Id; "ownerId", box tenure.Owner; "openingStage", box (Vocabulary.stage tenure.OpeningStage); "openingCursor", box tenure.OpeningCursor
                           "reviewOutcome", nullable (tenure.Review |> Option.map (fun review -> Vocabulary.outcome review.Promoted))
                           "confirmed", box tenure.Confirmation.IsSome ]) |> Option.defaultValue null
        let canWrite = active |> Option.exists (fun tenure -> tenure.Review.IsSome && pending.IsNone)
        objectOf [ "workId", box workId; "opened", box opened; "root", (if opened then box root else null)
                   "sequence", (if opened then box (Vocabulary.sequence sequence) else null)
                   "stage", (if opened then box (Vocabulary.stage stage) else null); "authority", (if opened then box authority else null)
                   "revision", box receipts.Count; "deliveryAuthorized", box authorized; "active", tenureView
                   "devopsId", nullable (devops |> Option.map fst); "canWriteSource", box canWrite; "canDispatchDevOps", box (canWrite && devops.IsSome)
                   "pendingDelivery", (pending |> Option.map observeDelivery |> Option.defaultValue null)
                   "rounds", box (rounds.ToArray()) ]

    member this.Recovery(): obj =
        let next =
            match pending, active with
            | Some _, _ -> "ObserveExecution"
            | None, None -> if opened then "Done" else "Open"
            | None, Some tenure when tenure.Review.IsNone -> "Review"
            | None, Some tenure when sequence = WorkSequence.Execution && tenure.Confirmation.IsNone -> "Confirm"
            | _ -> "Continue"
        objectOf [ "next", box next; "state", this.Snapshot() ]
