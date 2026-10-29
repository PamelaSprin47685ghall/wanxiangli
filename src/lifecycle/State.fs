namespace Wanxiangli.Lifecycle

open System.Collections.Generic
open Wire

module internal Identities =
    let originator workId = identity "originator-v1" [ workId ]
    let successor retirementId = identity "successor-v1" [ retirementId ]
    let ask workId tenure call = identity "ask-v1" [ workId; tenure; call ]
    let relay workId tenure call = identity "relay-v1" [ workId; tenure; call ]
    let barrier workId call = identity "barrier-v1" [ workId; call ]
    let successorPrompt retirementId = identity "successor-prompt-v1" [ retirementId ]
    let advancePrompt tenure milestone = identity "advance-prompt-v1" [ tenure; milestone ]
    let launch workId run call digest = identity "launch-v1" [ workId; run; call; digest ]
    let complete workId tenure call = identity "complete-v1" [ workId; tenure; call ]
    let stop workId tenure = identity "stop-v1" [ workId; tenure ]
    let reopen workId messageId = identity "reopen-v1" [ workId; messageId ]
    let continuation workId continuationId = identity "continue-v1" [ workId; continuationId ]

type internal Tenure =
    { Id: string
      Origin: string
      Milestone: string
      Substantive: bool
      Obligations: Map<string, string> }

type internal Round =
    { Id: string
      Origin: string
      Milestone: string
      Outcome: string
      RetirementId: string
      ProviderRunId: string
      ToolCallId: string
      StopEffectId: string option }

[<RequireQualifiedAccess>]
type internal Slot =
    | Ask of id: string * text: string * incumbency: string * outcome: string option
    | Dispatch of id: string * promptKind: string * milestone: string * text: string * incumbency: string * outcome: string option
    | Launch of id: string * digest: string * run: string * call: string * incumbency: string * session: string option * status: string
    | Stop of id: string * incumbency: string * requested: bool * observed: bool * unknown: bool

[<RequireQualifiedAccess>]
type internal Fact =
    | WorkOpened of workId: string * office: string
    | IncumbencyOpened of id: string * origin: string * milestone: string * messageId: string option
    | WorkContinued of id: string * continuationId: string
    | QuestionRequested of id: string * incumbency: string * run: string * call: string * text: string * updates: (string * string option) list
    | OperatorAnswered of messageId: string * incumbency: string * questionId: string
    | Reviewed of incumbency: string * run: string * call: string * updates: (string * string option) list
    | IncumbencyRetired of id: string * incumbency: string * outcome: string * run: string * call: string * updates: (string * string option) list
    | ContextBarrier of id: string * run: string * call: string * successorId: string
    | PromptObliged of id: string * kind: string * milestone: string * text: string * incumbency: string
    | MilestoneAdvanced of incumbency: string * fromMilestone: string * toMilestone: string * run: string * call: string * updates: (string * string option) list
    | DeliveryRequested of id: string * incumbency: string * run: string * call: string * digest: string * updates: (string * string option) list
    | DeliverySessionBound of id: string * session: string
    | DeliveryAdmitted of id: string * session: string
    | DeliveryRejected of id: string * reason: string
    | EffectConfirmed of id: string * outcome: string * session: string option * reason: string option
    | StopObliged of id: string * incumbency: string
    | DevOpsBound of id: string * target: string option * trigger: string

[<RequireQualifiedAccess>]
type internal Seal =
    | Tool of string
    | Message of string
    | Continuation of string
    | None

module internal FactCodec =
    let private make name values = objectOf (("type", box name) :: values)
    let private oneOf allowed value =
        let name = text value
        require (List.contains name allowed) ("Unknown value: " + name)
        name

    let encode fact =
        match fact with
        | Fact.WorkOpened(workId, office) -> make "WorkOpened" [ "workId", box workId; "office", box office ]
        | Fact.IncumbencyOpened(id, origin, milestone, messageId) ->
            make "IncumbencyOpened" [ "incumbencyId", box id; "origin", box origin; "milestone", box milestone; "messageId", nullable messageId ]
        | Fact.WorkContinued(id, continuationId) ->
            make "WorkContinued" [ "incumbencyId", box id; "continuationId", box continuationId ]
        | Fact.QuestionRequested(id, incumbency, run, call, text, updates) ->
            make "QuestionRequested" [ "questionId", box id; "incumbencyId", box incumbency; "providerRunId", box run; "toolCallId", box call; "text", box text; "updates", box (encodeUpdates updates) ]
        | Fact.OperatorAnswered(messageId, incumbency, questionId) ->
            make "OperatorAnswered" [ "messageId", box messageId; "incumbencyId", box incumbency; "questionId", box questionId ]
        | Fact.Reviewed(incumbency, run, call, updates) ->
            make "Reviewed" [ "incumbencyId", box incumbency; "providerRunId", box run; "toolCallId", box call; "updates", box (encodeUpdates updates) ]
        | Fact.IncumbencyRetired(id, incumbency, outcome, run, call, updates) ->
            make "IncumbencyRetired" [ "retirementId", box id; "incumbencyId", box incumbency; "outcome", box outcome; "providerRunId", box run; "toolCallId", box call; "updates", box (encodeUpdates updates) ]
        | Fact.ContextBarrier(id, run, call, successorId) ->
            make "ContextBarrier" [ "barrierId", box id; "providerRunId", box run; "toolCallId", box call; "successorId", box successorId ]
        | Fact.PromptObliged(id, kind, milestone, text, incumbency) ->
            make "PromptObliged" [ "promptId", box id; "promptKind", box kind; "milestone", box milestone; "text", box text; "incumbencyId", box incumbency ]
        | Fact.MilestoneAdvanced(incumbency, fromMilestone, toMilestone, run, call, updates) ->
            make "MilestoneAdvanced" [ "incumbencyId", box incumbency; "from", box fromMilestone; "to", box toMilestone; "providerRunId", box run; "toolCallId", box call; "updates", box (encodeUpdates updates) ]
        | Fact.DeliveryRequested(id, incumbency, run, call, digest, updates) ->
            make "DeliveryRequested" [ "operationId", box id; "incumbencyId", box incumbency; "providerRunId", box run; "toolCallId", box call; "digest", box digest; "updates", box (encodeUpdates updates) ]
        | Fact.DeliverySessionBound(id, session) -> make "DeliverySessionBound" [ "operationId", box id; "execSessionId", box session ]
        | Fact.DeliveryAdmitted(id, session) -> make "DeliveryAdmitted" [ "operationId", box id; "execSessionId", box session ]
        | Fact.DeliveryRejected(id, reason) -> make "DeliveryRejected" [ "operationId", box id; "reason", box reason ]
        | Fact.EffectConfirmed(id, outcome, session, reason) ->
            make "EffectConfirmed" [ "effectId", box id; "outcome", box outcome; "execSessionId", nullable session; "reason", nullable reason ]
        | Fact.StopObliged(id, incumbency) -> make "StopObliged" [ "stopId", box id; "incumbencyId", box incumbency ]
        | Fact.DevOpsBound(id, target, trigger) -> make "DevOpsBound" [ "devopsId", box id; "target", nullable target; "trigger", box trigger ]

    let decode (value: obj) =
        let exact names = fields ("type" :: names) [] value
        let id key = identifier (get value key)
        let word key = text (get value key)
        let optionalId key = if isNull (get value key) then None else Some(identifier (get value key))
        match word "type" with
        | "WorkOpened" ->
            exact [ "workId"; "office" ]
            Fact.WorkOpened(id "workId", oneOf [ "Plan"; "Manager" ] (get value "office"))
        | "IncumbencyOpened" ->
            exact [ "incumbencyId"; "origin"; "milestone"; "messageId" ]
            Fact.IncumbencyOpened(id "incumbencyId", oneOf [ "Originator"; "Successor" ] (get value "origin"), word "milestone", optionalId "messageId")
        | "WorkContinued" ->
            exact [ "incumbencyId"; "continuationId" ]
            Fact.WorkContinued(id "incumbencyId", id "continuationId")
        | "QuestionRequested" ->
            exact [ "questionId"; "incumbencyId"; "providerRunId"; "toolCallId"; "text"; "updates" ]
            Fact.QuestionRequested(id "questionId", id "incumbencyId", id "providerRunId", id "toolCallId", word "text", updates (get value "updates"))
        | "OperatorAnswered" ->
            exact [ "messageId"; "incumbencyId"; "questionId" ]
            Fact.OperatorAnswered(id "messageId", id "incumbencyId", id "questionId")
        | "Reviewed" ->
            exact [ "incumbencyId"; "providerRunId"; "toolCallId"; "updates" ]
            Fact.Reviewed(id "incumbencyId", id "providerRunId", id "toolCallId", updates (get value "updates"))
        | "IncumbencyRetired" ->
            exact [ "retirementId"; "incumbencyId"; "outcome"; "providerRunId"; "toolCallId"; "updates" ]
            Fact.IncumbencyRetired(id "retirementId", id "incumbencyId", oneOf [ "Relayed"; "Completed" ] (get value "outcome"), id "providerRunId", id "toolCallId", updates (get value "updates"))
        | "ContextBarrier" ->
            exact [ "barrierId"; "providerRunId"; "toolCallId"; "successorId" ]
            Fact.ContextBarrier(id "barrierId", id "providerRunId", id "toolCallId", id "successorId")
        | "PromptObliged" ->
            exact [ "promptId"; "promptKind"; "milestone"; "text"; "incumbencyId" ]
            Fact.PromptObliged(id "promptId", oneOf [ "Successor"; "Advance" ] (get value "promptKind"), word "milestone", word "text", id "incumbencyId")
        | "MilestoneAdvanced" ->
            exact [ "incumbencyId"; "from"; "to"; "providerRunId"; "toolCallId"; "updates" ]
            Fact.MilestoneAdvanced(id "incumbencyId", word "from", word "to", id "providerRunId", id "toolCallId", updates (get value "updates"))
        | "DeliveryRequested" ->
            exact [ "operationId"; "incumbencyId"; "providerRunId"; "toolCallId"; "digest"; "updates" ]
            Fact.DeliveryRequested(id "operationId", id "incumbencyId", id "providerRunId", id "toolCallId", word "digest", updates (get value "updates"))
        | "DeliverySessionBound" -> exact [ "operationId"; "execSessionId" ]; Fact.DeliverySessionBound(id "operationId", id "execSessionId")
        | "DeliveryAdmitted" -> exact [ "operationId"; "execSessionId" ]; Fact.DeliveryAdmitted(id "operationId", id "execSessionId")
        | "DeliveryRejected" -> exact [ "operationId"; "reason" ]; Fact.DeliveryRejected(id "operationId", word "reason")
        | "EffectConfirmed" ->
            exact [ "effectId"; "outcome"; "execSessionId"; "reason" ]
            Fact.EffectConfirmed(id "effectId", oneOf [ "Parked"; "Sent"; "Unknown"; "Requested"; "Observed" ] (get value "outcome"), optionalId "execSessionId", if isNull (get value "reason") then None else Some(word "reason"))
        | "StopObliged" -> exact [ "stopId"; "incumbencyId" ]; Fact.StopObliged(id "stopId", id "incumbencyId")
        | "DevOpsBound" ->
            exact [ "devopsId"; "target"; "trigger" ]
            let target = if isNull (get value "target") then None else Some(word "target")
            Fact.DevOpsBound(id "devopsId", target, oneOf [ "Ask"; "Resume"; "Horizon" ] (get value "trigger"))
        | _ -> fail "Unknown lifecycle event"

module internal Effects =
    let ask id text incumbency =
        objectOf [ "kind", box "Ask"; "id", box id; "text", box text; "incumbencyId", box incumbency ]

    let dispatch id promptKind milestone text incumbency =
        objectOf [ "kind", box "Dispatch"; "id", box id; "promptKind", box promptKind; "milestone", box milestone; "text", box text; "incumbencyId", box incumbency ]

    let launch id phase digest run call session =
        objectOf [ "kind", box "Launch"; "id", box id; "phase", box phase; "digest", box digest; "providerRunId", box run; "toolCallId", box call; "execSessionId", nullable session ]

    let stop id incumbency =
        objectOf [ "kind", box "Stop"; "id", box id; "incumbencyId", box incumbency ]

    let ofSlot slot =
        match slot with
        | Slot.Ask(id, text, incumbency, None) -> Some(ask id text incumbency)
        | Slot.Dispatch(id, kind, milestone, text, incumbency, None) -> Some(dispatch id kind milestone text incumbency)
        | Slot.Launch(id, digest, run, call, _, session, "Create") -> Some(launch id "Create" digest run call session)
        | Slot.Launch(id, digest, run, call, _, session, "Send") -> Some(launch id "Send" digest run call session)
        | Slot.Stop(id, incumbency, false, _, false) -> Some(stop id incumbency)
        | _ -> None

    let blocks slot =
        match slot with
        | Slot.Ask(_, _, _, None) -> true
        | Slot.Dispatch(_, _, _, _, _, None) -> true
        | Slot.Stop(_, _, false, _, false) -> true
        | _ -> false

    let idOf = function
        | Slot.Ask(id, _, _, _) -> id
        | Slot.Dispatch(id, _, _, _, _, _) -> id
        | Slot.Launch(id, _, _, _, _, _, _) -> id
        | Slot.Stop(id, _, _, _, _) -> id

module internal View =
    let obligations map =
        map
        |> Map.toList
        |> List.sortBy fst
        |> List.map (fun (key, value) -> objectOf [ "key", box key; "value", box value ])
        |> List.toArray

    let applyUpdates current updates =
        updates |> List.fold (fun acc (key, value) ->
            match value with
            | None -> Map.remove key acc
            | Some text -> Map.add key text acc) current

type internal Receipt = { Hash: string; Result: obj }

type internal Ledger(workId: string) =
    let mutable opened = false
    let mutable office = ""
    let mutable completed = false
    let mutable active: Tenure option = None
    let mutable barrier: (string * string) option = None
    let mutable rounds: Round list = []
    let mutable slots: Slot list = []
    let mutable openQuestion: string option = None
    let mutable unknownQuestion: string option = None
    let mutable devops: (string * string option * string) option = None
    let receipts = Dictionary<string, Receipt>()
    let fences = Dictionary<string, obj>()
    let messages = Dictionary<string, obj>()
    let continuations = Dictionary<string, obj>()

    // 程序位置只按事实重放推进：计数器由 CE 结构持有，不按 phase 跳转。
    let mutable position: Program.Program option = None

    let advancePosition (expected: Program.Step) (value: obj) =
        match position with
        | Some current ->
            require (Program.step current = expected) "Facts diverge from the program"
            position <- Some(Program.continueWith current value)
        | None -> fail "Facts precede the program"

    // 内部步骤（Commit/Relay/Advance/Launch/Complete/Reopen）不等待外部输入，
    // 落上后立即推进穿透，直到下一个等待步（AwaitReview/AwaitEmptyReview/AwaitOperator/Ask）。
    let rec settlePosition () =
        match position with
        | Some current ->
            match Program.step current with
            | Program.Step.AwaitReview | Program.Step.AwaitEmptyReview
            | Program.Step.AwaitOperator | Program.Step.Ask _ -> ()
            | _ ->
                position <- Some(Program.continueWith current (box ()))
                settlePosition ()
        | None -> ()

    // Answer 消费 Ask：按模式匹配（Ask 的 text 是运行时数据，不适用等号匹配）。
    let advanceFromAsk (value: obj) =
        match position with
        | Some current ->
            match Program.step current with
            | Program.Step.Ask _ -> position <- Some(Program.continueWith current value)
            | _ -> fail "No open question in the program"
        | None -> fail "Facts precede the program"

    let requireIdle () =
        require (not (slots |> List.exists Effects.blocks)) "Effect pending"

    let tenure () =
        match active with
        | Some value -> value
        | None -> fail "No active tenure"

    let replaceTenure value = active <- Some value

    let replace id change =
        let mutable found = false
        slots <- slots |> List.map (fun slot ->
            if Effects.idOf slot = id then
                found <- true
                change slot
            else slot)
        require found "Effect is not pending"

    let phase () =
        if not opened then "Unopened"
        elif completed then "Completed"
        elif openQuestion.IsSome then "AwaitingAnswer"
        else
            match active with
            | None -> fail "Open work has no tenure"
            | Some current ->
                if current.Milestone = "待执行" then "Ready"
                elif current.Milestone = "收尾" then "Cleanup"
                elif current.Milestone = "已完成" then "Completed"
                elif current.Origin = "Successor" && not current.Substantive then "SuccessorFirst"
                elif not current.Substantive then "Originator"
                else "Working"

    let wait () =
        if slots |> List.exists (fun slot -> Effects.ofSlot slot |> Option.isSome) then "ConfirmEffect"
        elif unknownQuestion.IsSome then "AwaitOperatorAnswer"
        else
            match phase () with
            | "Ready" -> "AwaitEmptyReview"
            | "AwaitingAnswer" -> "AwaitOperatorAnswer"
            | "Completed" -> "AwaitOperatorMessage"
            | _ -> "AwaitReview"

    let oldest () = slots |> List.tryPick Effects.ofSlot

    let milestoneName () =
        if completed then box "已完成"
        elif not opened then null
        else
            match active with
            | Some current -> box current.Milestone
            | None -> null

    let incumbencyName () =
        match active with
        | Some current -> box current.Id
        | None -> null

    let finish kind incumbency milestone effect extra =
        objectOf ([
            "kind", box kind
            "incumbencyId", incumbency
            "milestone", milestone
            "wait", box (wait ())
            "effect", match effect with Some value -> value | None -> null
            "obligations", box (View.obligations (match active with Some current -> current.Obligations | None -> Map.empty))
        ] @ extra)

    let finishActive kind effect extra =
        let current = tenure ()
        finish kind (box current.Id) (box current.Milestone) effect extra

    let clearAndRequire updates =
        let current = tenure ()
        let next = View.applyUpdates current.Obligations updates
        require (Map.isEmpty next) "Ledger must be empty"
        next

    let fill updates =
        let current = tenure ()
        let next = View.applyUpdates current.Obligations updates
        require (not (Map.isEmpty next)) "Review must keep a ledger"
        { current with Substantive = true; Obligations = next }

    member _.Opened = opened
    member _.Office = office
    member _.Phase = phase ()
    member _.Milestone = if completed then "已完成" elif opened then (tenure ()).Milestone else ""
    member _.ActiveId = active |> Option.map (fun current -> current.Id)
    member _.Obligations = match active with Some current -> current.Obligations | None -> Map.empty
    member _.HasBlockingPending = slots |> List.exists Effects.blocks
    member _.HasUnobservedStop =
        slots |> List.exists (function Slot.Stop(_, _, _, observed, _) -> not observed | _ -> false)
    member _.HasOpenQuestion = openQuestion.IsSome
    member _.HasUnknownQuestion = unknownQuestion.IsSome
    member _.Position = position
    member _.DevOps = devops
    member _.WaitName = wait ()
    member _.PendingEffect = oldest ()
    // 答复到达即证明问题实际送达；Park 与 Unknown 由答复接续，未知不得冒充已 Parked。
    member _.AnswerableQuestion =
        match openQuestion with
        | Some id -> Some id
        | None -> unknownQuestion

    member _.Describe(id: string) =
        slots |> List.tryPick (function
            | Slot.Ask(found, _, _, outcome) when found = id -> Some("Ask", defaultArg outcome "", None)
            | Slot.Dispatch(found, _, _, _, _, outcome) when found = id -> Some("Dispatch", defaultArg outcome "", None)
            | Slot.Launch(found, _, _, _, _, session, status) when found = id -> Some("Launch", status, session)
            | Slot.Stop(found, _, requested, observed, unknown) when found = id ->
                let status = if unknown then "Unknown" elif observed then "Observed" elif requested then "Requested" else ""
                Some("Stop", status, None)
            | _ -> None)
    member _.TryReceipt requestId =
        if receipts.ContainsKey requestId then Some receipts[requestId] else None
    member _.TryFence call =
        if fences.ContainsKey call then Some fences[call] else None
    member _.TryMessage messageId =
        if messages.ContainsKey messageId then Some messages[messageId] else None
    member _.TryContinuation continuationId =
        if continuations.ContainsKey continuationId then Some continuations[continuationId] else None
    member _.Seal(requestId, hash, seal, result) =
        require (not (receipts.ContainsKey requestId)) "Duplicate request"
        receipts[requestId] <- { Hash = hash; Result = result }
        match seal with
        | Seal.Tool call ->
            require (not (fences.ContainsKey call)) "Duplicate tool call"
            fences[call] <- result
        | Seal.Message messageId ->
            require (not (messages.ContainsKey messageId)) "Duplicate message"
            messages[messageId] <- result
        | Seal.Continuation continuationId ->
            require (not (continuations.ContainsKey continuationId)) "Duplicate continuation"
            continuations[continuationId] <- result
        | Seal.None -> ()

    member this.Open(claimedWork, claimedOffice, id, origin, milestone, messageId: string option) =
        require (not opened) "Work is already open"
        require (claimedWork = workId) "Work identity mismatch"
        require (messageId.IsNone) "The first tenure has no message"
        require (origin = "Originator") "The first tenure is the originator"
        require (id = Identities.originator workId) "Incumbency identity mismatch"
        require (milestone = Program.firstMilestone claimedOffice) "First milestone mismatch"
        require (Program.knownMilestone claimedOffice milestone) "Milestone does not belong to the office"
        opened <- true
        office <- claimedOffice
        completed <- false
        active <- Some { Id = id; Origin = origin; Milestone = milestone; Substantive = false; Obligations = Map.empty }
        position <- Some(Program.originator milestone)

    member this.Snapshot(revision) =
        let activeView =
            match active with
            | None -> null
            | Some current ->
                objectOf [
                    "id", box current.Id
                    "ownerId", box office
                    "origin", box current.Origin
                    "milestone", box current.Milestone
                    "substantive", box current.Substantive
                    "obligations", box (View.obligations current.Obligations)
                ]
        let roundView (round: Round) =
            objectOf [
                "incumbencyId", box round.Id
                "ownerId", box office
                "origin", box round.Origin
                "milestone", box round.Milestone
                "outcome", box round.Outcome
                "retirementId", box round.RetirementId
                "providerRunId", box round.ProviderRunId
                "toolCallId", box round.ToolCallId
                "stopEffectId", nullable round.StopEffectId
            ]
        let launchView = function
            | Slot.Launch(id, digest, run, call, _, session, status) ->
                Some(objectOf [
                    "id", box id; "status", box status; "digest", box digest
                    "providerRunId", box run; "toolCallId", box call; "execSessionId", nullable session
                ])
            | _ -> None
        let devopsId, devopsTarget =
            match devops with
            | None -> null, null
            | Some(id, target, _) -> box id, match target with Some value -> box value | None -> null
        objectOf [
            "workId", box workId
            "office", (if opened then box office else null)
            "milestone", milestoneName ()
            "revision", box revision
            "phase", box (phase ())
            "wait", box (wait ())
            "active", activeView
            "rounds", box (rounds |> List.map roundView |> List.toArray)
            "devopsId", devopsId
            "devopsTarget", devopsTarget
            "pending", match oldest () with Some effect -> effect | None -> null
            "launches", box (slots |> List.choose launchView |> List.toArray)
            "obligations", box (View.obligations (match active with Some current -> current.Obligations | None -> Map.empty))
            "completed", box completed
            "barrier",
            match barrier with
            | None -> null
            | Some(toolCallId, successorTenureId) ->
                objectOf [ "toolCallId", box toolCallId; "successorTenureId", box successorTenureId ]
        ]

    member this.Recover(revision) =
        let currentWait = wait ()
        let next =
            match currentWait with
            | "ConfirmEffect" -> "ConfirmEffect"
            | "AwaitOperatorAnswer" -> "OperatorAnswer"
            | "AwaitOperatorMessage" -> "OperatorMessage"
            | _ -> "Review"
        objectOf [
            "next", box next
            "wait", box currentWait
            "effect", match oldest () with Some effect -> effect | None -> null
            "state", this.Snapshot(revision)
        ]

    member this.Apply(facts: Fact list) =
        match facts with
        | [ Fact.WorkOpened(claimed, claimedOffice); Fact.IncumbencyOpened(id, origin, milestone, messageId); Fact.QuestionRequested(questionId, incumbency, _, call, text, claimedUpdates) ] ->
            this.Open(claimed, claimedOffice, id, origin, milestone, messageId)
            this.Ask(questionId, incumbency, call, text, claimedUpdates)
        | [ Fact.WorkOpened(claimed, claimedOffice); Fact.IncumbencyOpened(id, origin, milestone, messageId); Fact.Reviewed(incumbency, _, call, claimedUpdates) ] ->
            this.Open(claimed, claimedOffice, id, origin, milestone, messageId)
            this.Review(incumbency, call, claimedUpdates)
        | [ Fact.QuestionRequested(questionId, incumbency, _, call, text, claimedUpdates) ] ->
            this.Ask(questionId, incumbency, call, text, claimedUpdates)
        | [ Fact.OperatorAnswered(messageId, incumbency, questionId) ] ->
            this.Answer(messageId, incumbency, questionId)
        | [ Fact.Reviewed(incumbency, _, call, claimedUpdates) ] ->
            this.Review(incumbency, call, claimedUpdates)
        | [ Fact.IncumbencyRetired(retirementId, incumbency, outcome, run, call, claimedUpdates); Fact.ContextBarrier(barrierId, _, barrierCall, successorId); Fact.IncumbencyOpened(openedId, origin, milestone, messageId); Fact.PromptObliged(promptId, kind, promptMilestone, text, promptTenure) ] ->
            this.Relay(retirementId, incumbency, outcome, run, call, claimedUpdates, barrierId, barrierCall, successorId, openedId, origin, milestone, messageId, promptId, kind, promptMilestone, text, promptTenure)
        | [ Fact.MilestoneAdvanced(incumbency, fromMilestone, toMilestone, _, call, claimedUpdates); Fact.PromptObliged(promptId, kind, promptMilestone, text, promptTenure) ] ->
            this.Advance(incumbency, fromMilestone, toMilestone, call, claimedUpdates, promptId, kind, promptMilestone, text, promptTenure)
        | [ Fact.DeliveryRequested(operationId, incumbency, run, call, digest, claimedUpdates) ] ->
            this.Launch(operationId, incumbency, run, call, digest, claimedUpdates)
        | [ Fact.DeliverySessionBound(operationId, session) ] -> this.BindSession(operationId, session)
        | [ Fact.DeliveryAdmitted(operationId, session) ] -> this.Admit(operationId, session)
        | [ Fact.DeliveryRejected(operationId, reason) ] -> this.RejectLaunch(operationId, reason)
        | [ Fact.EffectConfirmed(effectId, outcome, session, reason) ] -> this.Confirm(effectId, outcome, session, reason)
        | [ Fact.IncumbencyRetired(retirementId, incumbency, outcome, run, call, claimedUpdates); Fact.StopObliged(stopId, stopTenure) ] ->
            this.Complete(retirementId, incumbency, outcome, run, call, claimedUpdates, stopId, stopTenure)
        | [ Fact.IncumbencyOpened(id, origin, milestone, messageId) ] -> this.Reopen(id, origin, milestone, messageId)
        | [ Fact.WorkContinued(id, continuationId) ] -> this.Continue(id, continuationId)
        | [ Fact.DevOpsBound(devopsId, target, trigger) ] -> this.BindDevOps(devopsId, target, trigger)
        | _ -> fail "Illegal lifecycle transaction"

    member private _.Ask(questionId, incumbency, call, text, claimedUpdates) =
        requireIdle ()
        let current = tenure ()
        require (current.Id = incumbency) "Tenure mismatch"
        require (not current.Substantive) "Ask belongs to an originator"
        require (current.Milestone <> "待执行" && current.Milestone <> "收尾" && current.Milestone <> "已完成") "This milestone does not ask"
        require (text = Program.askText) "Unexpected question"
        require (questionId = Identities.ask workId incumbency call) "Question identity mismatch"
        require openQuestion.IsNone "A question is already open"
        let next = clearAndRequire claimedUpdates
        replaceTenure { current with Obligations = next }
        slots <- slots @ [ Slot.Ask(questionId, text, incumbency, None) ]
        advancePosition Program.Step.AwaitReview (box true)
        Seal.Tool call, finishActive "Asked" (Some(Effects.ask questionId text incumbency)) []

    member private _.Review(incumbency, call, claimedUpdates) =
        requireIdle ()
        let current = tenure ()
        require (current.Id = incumbency) "Tenure mismatch"
        require (current.Milestone <> "待执行" && current.Milestone <> "已完成") "This milestone does not take a ledger"
        require openQuestion.IsNone "Awaiting operator answer"
        let next = fill claimedUpdates
        replaceTenure next
        // 询问投递未知时，一次实账 review 就是「我需要干什么」的答复本身：
        // 先消费 Ask，再按普通评审推进。投递已 Parked 的询问仍只等操作员答复。
        if unknownQuestion.IsSome then advanceFromAsk (box ())
        advancePosition Program.Step.AwaitReview (box false)
        settlePosition ()
        unknownQuestion <- None
        Seal.Tool call, finishActive "Reviewed" None []

    member private _.Answer(messageId, incumbency, questionId) =
        let current = tenure ()
        require (current.Id = incumbency) "Tenure mismatch"
        require (openQuestion = Some questionId || unknownQuestion = Some questionId) "No parked question"
        openQuestion <- None
        unknownQuestion <- None
        advanceFromAsk (box ())
        settlePosition ()
        Seal.Message messageId, finishActive "Answered" None [ "messageId", box messageId ]

    member private _.Relay(retirementId, incumbency, outcome, run, call, claimedUpdates, barrierId, barrierCall, successorId, openedId, origin, milestone, messageId, promptId, kind, promptMilestone, text, promptTenure) =
        requireIdle ()
        let current = tenure ()
        require current.Substantive "Relay follows a substantive review"
        require (current.Id = incumbency) "Tenure mismatch"
        require (current.Milestone <> "收尾" && current.Milestone <> "待执行") "This milestone does not relay"
        require (outcome = "Relayed") "Relay outcome mismatch"
        require (retirementId = Identities.relay workId incumbency call) "Retirement identity mismatch"
        require (call = barrierCall) "Barrier tool call mismatch"
        require (barrierId = Identities.barrier workId call) "Barrier identity mismatch"
        require (successorId = Identities.successor retirementId) "Successor identity mismatch"
        require (openedId = successorId && origin = "Successor" && messageId.IsNone) "Successor tenure mismatch"
        require (milestone = current.Milestone && promptMilestone = milestone) "Successor stays on the milestone"
        require (kind = "Successor" && text = Program.successorPrompt milestone && promptTenure = successorId) "Successor prompt mismatch"
        require (promptId = Identities.successorPrompt retirementId) "Prompt identity mismatch"
        let emptied = clearAndRequire claimedUpdates
        require (Map.isEmpty emptied) "Relay requires an empty ledger"
        rounds <- rounds @ [ { Id = current.Id; Origin = current.Origin; Milestone = current.Milestone; Outcome = "Relayed"; RetirementId = retirementId; ProviderRunId = run; ToolCallId = call; StopEffectId = None } ]
        barrier <- Some(call, successorId)
        replaceTenure { Id = successorId; Origin = "Successor"; Milestone = milestone; Substantive = false; Obligations = Map.empty }
        slots <- slots @ [ Slot.Dispatch(promptId, kind, milestone, text, successorId, None) ]
        advancePosition Program.Step.AwaitReview (box true)
        settlePosition ()
        Seal.Tool call, finishActive "Relayed" (Some(Effects.dispatch promptId kind milestone text successorId)) [
            "successorId", box successorId
            "retirementId", box retirementId
            "barrierId", box barrierId
            "predecessorId", box incumbency
            "toolCallId", box call
        ]

    member private _.Advance(incumbency, fromMilestone, toMilestone, call, claimedUpdates, promptId, kind, promptMilestone, text, promptTenure) =
        requireIdle ()
        let current = tenure ()
        require (current.Id = incumbency && promptTenure = incumbency) "Tenure mismatch"
        require (current.Origin = "Successor" && not current.Substantive) "Advance belongs to the successor's first review"
        require (fromMilestone = current.Milestone) "Advance source mismatch"
        require (toMilestone = Program.nextMilestone fromMilestone) "Advance target mismatch"
        require (Program.knownMilestone office toMilestone) "Milestone does not belong to the office"
        require (kind = "Advance" && promptMilestone = toMilestone && text = Program.advancePrompt toMilestone) "Advance prompt mismatch"
        require (promptId = Identities.advancePrompt incumbency toMilestone) "Prompt identity mismatch"
        let emptied = clearAndRequire claimedUpdates
        require (Map.isEmpty emptied) "Advance requires an empty ledger"
        replaceTenure { current with Origin = "Originator"; Milestone = toMilestone; Substantive = false; Obligations = Map.empty }
        slots <- slots @ [ Slot.Dispatch(promptId, kind, toMilestone, text, incumbency, None) ]
        advancePosition Program.Step.AwaitReview (box true)
        settlePosition ()
        Seal.Tool call, finish "Advanced" (box incumbency) (box toMilestone) (Some(Effects.dispatch promptId kind toMilestone text incumbency)) [
            "from", box fromMilestone
            "toolCallId", box call
        ]

    member private _.Launch(operationId, incumbency, run, call, digest, claimedUpdates) =
        requireIdle ()
        let current = tenure ()
        require (office = "Plan" && current.Milestone = "待执行" && current.Id = incumbency) "Launch belongs to 待执行"
        require (operationId = Identities.launch workId run call digest) "Launch identity mismatch"
        let emptied = clearAndRequire claimedUpdates
        require (Map.isEmpty emptied) "Launch requires an empty ledger"
        replaceTenure { current with Obligations = emptied }
        slots <- slots @ [ Slot.Launch(operationId, digest, run, call, incumbency, None, "Create") ]
        advancePosition Program.Step.AwaitEmptyReview (box true)
        settlePosition ()
        Seal.Tool call, finishActive "Launched" (Some(Effects.launch operationId "Create" digest run call None)) [
            "operationId", box operationId
            "toolCallId", box call
        ]

    member private _.BindSession(operationId, session) =
        replace operationId (function
            | Slot.Launch(id, digest, run, call, incumbency, None, "Create") -> Slot.Launch(id, digest, run, call, incumbency, Some session, "Send")
            | _ -> fail "Launch is not waiting for a session")
        let effect =
            slots |> List.tryPick (function
                | Slot.Launch(id, digest, run, call, _, Some bound, "Send") when id = operationId && bound = session ->
                    Some(Effects.launch id "Send" digest run call (Some session))
                | _ -> None)
        Seal.None, finish "Confirmed" (incumbencyName ()) (milestoneName ()) effect [ "effectId", box operationId; "outcome", box "SessionCreated" ]

    member private _.Admit(operationId, session) =
        replace operationId (function
            | Slot.Launch(id, digest, run, call, incumbency, Some bound, "Send") when bound = session ->
                Slot.Launch(id, digest, run, call, incumbency, Some session, "Admitted")
            | _ -> fail "Launch is not waiting for admission")
        Seal.None, finish "Confirmed" (incumbencyName ()) (milestoneName ()) None [ "effectId", box operationId; "outcome", box "Admitted" ]

    member private _.RejectLaunch(operationId, reason) =
        replace operationId (function
            | Slot.Launch(id, digest, run, call, incumbency, session, status) when status = "Create" || status = "Send" ->
                Slot.Launch(id, digest, run, call, incumbency, session, "Rejected")
            | _ -> fail "Launch is not open")
        Seal.None, finish "Confirmed" (incumbencyName ()) (milestoneName ()) None [ "effectId", box operationId; "outcome", box "NotStarted"; "reason", box reason ]

    member private _.Confirm(effectId, outcome, session, reason) =
        require session.IsNone "Confirmation does not bind a session"
        require reason.IsNone "Confirmation does not carry a reason"
        replace effectId (fun slot ->
            match slot, outcome with
            | Slot.Ask(id, text, incumbency, None), ("Parked" | "Unknown") -> Slot.Ask(id, text, incumbency, Some outcome)
            | Slot.Dispatch(id, kind, milestone, text, incumbency, None), ("Sent" | "Unknown") -> Slot.Dispatch(id, kind, milestone, text, incumbency, Some outcome)
            | Slot.Launch(id, digest, run, call, incumbency, None, "Create"), "Unknown" -> Slot.Launch(id, digest, run, call, incumbency, None, "Unknown")
            | Slot.Launch(id, digest, run, call, incumbency, Some bound, "Send"), "Unknown" -> Slot.Launch(id, digest, run, call, incumbency, Some bound, "Unknown")
            | Slot.Stop(id, incumbency, false, false, false), "Requested" -> Slot.Stop(id, incumbency, true, false, false)
            | Slot.Stop(id, incumbency, false, false, false), "Unknown" -> Slot.Stop(id, incumbency, false, false, true)
            | Slot.Stop(id, incumbency, true, false, false), "Observed" -> Slot.Stop(id, incumbency, true, true, false)
            | _ -> fail "Confirmation does not match the effect")
        match outcome with
        | "Parked" ->
            match slots |> List.tryFind (fun slot -> Effects.idOf slot = effectId) with
            | Some(Slot.Ask(id, _, _, Some "Parked")) -> openQuestion <- Some id
            | _ -> ()
        | "Unknown" ->
            match slots |> List.tryFind (fun slot -> Effects.idOf slot = effectId) with
            | Some(Slot.Ask(id, _, _, Some "Unknown")) -> unknownQuestion <- Some id
            | _ -> ()
        | _ -> ()
        Seal.None, finish "Confirmed" (incumbencyName ()) (milestoneName ()) (oldest ()) [ "effectId", box effectId; "outcome", box outcome ]

    member private _.Complete(retirementId, incumbency, outcome, run, call, claimedUpdates, stopId, stopTenure) =
        requireIdle ()
        let current = tenure ()
        require (current.Milestone = "收尾" && current.Id = incumbency && stopTenure = incumbency) "Completion belongs to 收尾"
        require (outcome = "Completed") "Completion outcome mismatch"
        require (retirementId = Identities.complete workId incumbency call) "Retirement identity mismatch"
        require (stopId = Identities.stop workId incumbency) "Stop identity mismatch"
        let emptied = clearAndRequire claimedUpdates
        require (Map.isEmpty emptied) "Completion requires an empty ledger"
        rounds <- rounds @ [ { Id = current.Id; Origin = current.Origin; Milestone = current.Milestone; Outcome = "Completed"; RetirementId = retirementId; ProviderRunId = run; ToolCallId = call; StopEffectId = Some stopId } ]
        active <- None
        completed <- true
        slots <- slots @ [ Slot.Stop(stopId, incumbency, false, false, false) ]
        advancePosition Program.Step.AwaitReview (box true)
        settlePosition ()
        Seal.Tool call, finish "Completed" (box incumbency) (box "已完成") (Some(Effects.stop stopId incumbency)) [ "retirementId", box retirementId ]

    member private _.Reopen(id, origin, milestone, messageId) =
        require opened "Work is not open"
        require completed "Reopen requires completion"
        require active.IsNone "Completed work has no active tenure"
        match messageId with
        | None -> fail "Reopen requires a message"
        | Some message ->
            require (origin = "Originator" && milestone = "执行") "Reopen returns to 执行"
            require (id = Identities.reopen workId message) "Reopen identity mismatch"
            completed <- false
            replaceTenure { Id = id; Origin = origin; Milestone = milestone; Substantive = false; Obligations = Map.empty }
            advancePosition Program.Step.AwaitOperator (box "Operator")
            settlePosition ()
            Seal.Message message, finishActive "Reopened" None [ "messageId", box message ]

    member private _.Continue(id, continuationId) =
        require opened "Work is not open"
        require completed "Continuation requires completion"
        require active.IsNone "Completed work has no active tenure"
        require (id = Identities.continuation workId continuationId) "Continuation identity mismatch"
        let previous = rounds |> List.tryLast
        require (previous |> Option.exists (fun round -> round.Outcome = "Completed")) "Completed retirement is missing"
        barrier <- Some((Option.get previous).ToolCallId, id)
        completed <- false
        replaceTenure { Id = id; Origin = "Originator"; Milestone = "执行"; Substantive = false; Obligations = Map.empty }
        advancePosition Program.Step.AwaitOperator (box "Operator")
        settlePosition ()
        Seal.Continuation continuationId, finishActive "Reopened" None [ "continuationId", box continuationId ]

    member private _.BindDevOps(devopsId, target, trigger) =
        require opened "Work is not open"
        let allowed =
            (office = "Plan" && trigger = "Ask")
            || (office = "Manager" && (trigger = "Resume" || trigger = "Horizon"))
        require allowed "Bind trigger does not match the office"
        match devops with
        | Some _ -> fail "DevOps binding conflict"
        | None ->
            devops <- Some(devopsId, target, trigger)
            Seal.None, finish "DevOpsBound" (incumbencyName ()) (milestoneName ()) None [ "devopsId", box devopsId ]
