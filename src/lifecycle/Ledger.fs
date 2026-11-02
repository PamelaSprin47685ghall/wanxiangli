namespace Wanxiangli.Lifecycle

open System.Collections.Generic
open Wire

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
    // 程序位置只按事实重放推进：计数器由 CE 结构持有，不按 phase 跳转。
    let mutable position: Program.Program option = None

    // 事实只经等待步喂入；落笔步落完即穿透，位置只停驻等待步。
    let advancePosition (expected: Program.Step) (value: obj) =
        match position with
        | Some current ->
            require (Program.expects expected (Program.step current)) "Facts diverge from the program"
            position <- Some(Program.advance current value)
        | None -> fail "Facts precede the program"

    // Answer 消费 Ask：按模式匹配（Ask 的 text 是运行时数据，不适用相等比较）。
    let advanceFromAsk (value: obj) =
        match position with
        | Some current ->
            match Program.step current with
            | Program.Step.Ask _ -> position <- Some(Program.advance current value)
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
        | [ Fact.IncumbencyRetired(retirementId, incumbency, outcome, _, call, claimedUpdates); Fact.ContextBarrier(barrierId, _, barrierCall, successorId); Fact.IncumbencyOpened(openedId, origin, milestone, messageId); Fact.PromptObliged(promptId, kind, promptMilestone, text, promptTenure) ] ->
            this.Relay(retirementId, incumbency, outcome, call, claimedUpdates, barrierId, barrierCall, successorId, openedId, origin, milestone, messageId, promptId, kind, promptMilestone, text, promptTenure)
        | [ Fact.MilestoneAdvanced(incumbency, fromMilestone, toMilestone, _, call, claimedUpdates); Fact.PromptObliged(promptId, kind, promptMilestone, text, promptTenure) ] ->
            this.Advance(incumbency, fromMilestone, toMilestone, call, claimedUpdates, promptId, kind, promptMilestone, text, promptTenure)
        | [ Fact.DeliveryRequested(operationId, incumbency, run, call, digest, claimedUpdates) ] ->
            this.Launch(operationId, incumbency, run, call, digest, claimedUpdates)
        | [ Fact.DeliverySessionBound(operationId, session) ] -> this.BindSession(operationId, session)
        | [ Fact.DeliveryAdmitted(operationId, session) ] -> this.Admit(operationId, session)
        | [ Fact.DeliveryRejected(operationId, reason) ] -> this.RejectLaunch(operationId, reason)
        | [ Fact.EffectConfirmed(effectId, outcome, session, reason) ] -> this.Confirm(effectId, outcome, session, reason)
        | [ Fact.IncumbencyRetired(retirementId, incumbency, outcome, _, call, claimedUpdates); Fact.StopObliged(stopId, stopTenure) ] ->
            this.Complete(retirementId, incumbency, outcome, call, claimedUpdates, stopId, stopTenure)
        | [ Fact.IncumbencyOpened(id, origin, milestone, messageId) ] -> this.Reopen(id, origin, milestone, messageId)
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
        unknownQuestion <- None
        Seal.Tool call, finishActive "Reviewed" None []

    member private _.Answer(messageId, incumbency, questionId) =
        let current = tenure ()
        require (current.Id = incumbency) "Tenure mismatch"
        require (openQuestion = Some questionId || unknownQuestion = Some questionId) "No parked question"
        openQuestion <- None
        unknownQuestion <- None
        advanceFromAsk (box ())
        Seal.Message messageId, finishActive "Answered" None [ "messageId", box messageId ]

    member private _.Relay(retirementId, incumbency, outcome, call, claimedUpdates, barrierId, barrierCall, successorId, openedId, origin, milestone, messageId, promptId, kind, promptMilestone, text, promptTenure) =
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
        rounds <- rounds @ [ { Id = current.Id; Origin = current.Origin; Milestone = current.Milestone; Outcome = "Relayed"; RetirementId = retirementId } ]
        barrier <- Some(call, successorId)
        replaceTenure { Id = successorId; Origin = "Successor"; Milestone = milestone; Substantive = false; Obligations = Map.empty }
        slots <- slots @ [ Slot.Dispatch(promptId, kind, milestone, text, successorId, None) ]
        advancePosition Program.Step.AwaitReview (box true)
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

    member private _.Complete(retirementId, incumbency, outcome, call, claimedUpdates, stopId, stopTenure) =
        requireIdle ()
        let current = tenure ()
        require (current.Milestone = "收尾" && current.Id = incumbency && stopTenure = incumbency) "Completion belongs to 收尾"
        require (outcome = "Completed") "Completion outcome mismatch"
        require (retirementId = Identities.complete workId incumbency call) "Retirement identity mismatch"
        require (stopId = Identities.stop workId incumbency) "Stop identity mismatch"
        let emptied = clearAndRequire claimedUpdates
        require (Map.isEmpty emptied) "Completion requires an empty ledger"
        rounds <- rounds @ [ { Id = current.Id; Origin = current.Origin; Milestone = current.Milestone; Outcome = "Completed"; RetirementId = retirementId } ]
        active <- None
        completed <- true
        slots <- slots @ [ Slot.Stop(stopId, incumbency, false, false, false) ]
        advancePosition Program.Step.AwaitReview (box true)
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
            Seal.Message message, finishActive "Reopened" None [ "messageId", box message ]

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
