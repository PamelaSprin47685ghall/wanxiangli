module Wanxiangli.Lifecycle.Work

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Lifecycle
open Wire

[<ImportAll("node:fs")>]
let private nodeFs: obj = jsNative

[<ImportAll("node:path")>]
let private nodePath: obj = jsNative

let abandonLocalState (directory: string) =
    let resolve (value: string): string = nodePath?resolve(value)
    let real (value: string): string =
        if nodeFs?existsSync(value) then nodeFs?realpathSync(value) else resolve value
    let target = real directory
    let forbidden = real (resolve (nodePath?join(".", ".Herdchestra")))
    let relative: string = nodePath?relative(target, forbidden)
    let containsForbidden = relative = "" || (not (relative.StartsWith "..") && not (nodePath?isAbsolute(relative)))
    require (not containsForbidden) "Refusing to delete the workspace .Herdchestra"
    nodeFs?rmSync(target, objectOf [ "recursive", box true; "force", box true ])

type IWork =
    abstract inspect: unit -> obj
    abstract history: unit -> obj array
    abstract records: unit -> string array
    abstract recover: unit -> obj
    abstract execute: requestId: string * command: obj -> obj

type private Choice =
    | Write of Fact list
    | Observe of obj
    | Refuse of string

module private Commands =
    let private blockersOf (command: obj) =
        if not (has command "blockers") || isNull (get command "blockers") then []
        else strings (get command "blockers") |> Array.toList

    let private digestOf (command: obj) =
        if not (has command "digest") || isNull (get command "digest") then "待执行"
        else text (get command "digest")

    let private optionalId (command: obj) key =
        if not (has command key) || isNull (get command key) then None
        else Some(identifier (get command key))

    let private optionalReason (command: obj) =
        if not (has command "reason") || isNull (get command "reason") then None
        else Some(text (get command "reason"))

    let private decision kind incumbency milestone wait effect obligations extra =
        objectOf ([
            "kind", box kind
            "incumbencyId", incumbency
            "milestone", milestone
            "wait", box wait
            "effect", effect
            "obligations", obligations
        ] @ extra)

    let private blocked (ledger: Ledger) blockers =
        decision "Blocked" (ledger.ActiveId |> Option.map box |> Option.defaultValue null) (box ledger.Milestone) ledger.WaitName null (box (View.obligations ledger.Obligations)) [
            "blockers", box (blockers |> List.toArray)
        ]

    let private ignored messageId (ledger: Ledger) =
        decision "Ignored" (ledger.ActiveId |> Option.map box |> Option.defaultValue null) (box ledger.Milestone) ledger.WaitName null (box (View.obligations ledger.Obligations)) [
            "messageId", box messageId
        ]

    let private confirmed outcome effectId (ledger: Ledger) =
        decision "Confirmed" (ledger.ActiveId |> Option.map box |> Option.defaultValue null) (if ledger.Milestone = "" then null else box ledger.Milestone) ledger.WaitName (match ledger.PendingEffect with Some effect -> effect | None -> null) (box (View.obligations ledger.Obligations)) [
            "effectId", box effectId
            "outcome", box outcome
        ]

    let private opening workId office =
        let milestone = Program.firstMilestone office
        [ Fact.WorkOpened(workId, office)
          Fact.IncumbencyOpened(Identities.originator workId, "Originator", milestone, None) ]

    let private prependOpening workId office (ledger: Ledger) facts =
        if ledger.Opened then facts else opening workId office @ facts

    let private tenureOf workId (ledger: Ledger) =
        if ledger.Opened then ledger.ActiveId |> Option.defaultWith (fun () -> fail "No active tenure")
        else Identities.originator workId

    let private emptyLedger (ledger: Ledger) updates =
        Map.isEmpty (View.applyUpdates ledger.Obligations updates)

    let private effectOf program value =
        Program.step (Program.continueWith program value)

    let private decideReview (workId: string) (ledger: Ledger) (command: obj) =
        fields [ "type"; "office"; "providerRunId"; "toolCallId"; "updates" ] [ "blockers"; "digest" ] command
        let office = text (get command "office")
        require (office = "Plan" || office = "Manager") "Unknown office"
        let run = identifier (get command "providerRunId")
        let call = identifier (get command "toolCallId")
        let claimed = updates (get command "updates")
        let blockers = blockersOf command
        let digest = digestOf command
        match ledger.TryFence call with
        | Some result -> Observe result
        | None ->
            if ledger.Opened && ledger.Office <> office then Refuse "Office is fixed"
            else
                let milestone = if ledger.Opened then ledger.Milestone else Program.firstMilestone office
                let empty = emptyLedger ledger claimed
                // A completed work sits on AwaitOperator. Refuse before looking up its tenure.
                let program =
                    match ledger.Position with
                    | Some current -> current
                    | None -> Program.originator milestone
                if Program.step program = Program.Step.AwaitOperator then Refuse "Work is complete"
                elif ledger.HasOpenQuestion then Refuse "Awaiting operator answer"
                else
                    let tenure = tenureOf workId ledger
                    if ledger.HasBlockingPending then Refuse "Effect pending"
                    elif (match Program.step program with Program.Step.Ask _ -> true | _ -> false) then Refuse "Question delivery is unknown"
                    elif Program.step program = Program.Step.AwaitEmptyReview && not empty then Refuse "Ready accepts only an empty review"
                    elif milestone = "收尾" && empty && not (List.isEmpty blockers) then Observe(blocked ledger blockers)
                    else
                        match Program.step program with
                        | Program.Step.AwaitReview ->
                            match effectOf program (box empty) with
                            | Program.Step.Ask text ->
                                let questionId = Identities.ask workId tenure call
                                Write(prependOpening workId office ledger [ Fact.QuestionRequested(questionId, tenure, run, call, text, claimed) ])
                            | Program.Step.Commit ->
                                Write(prependOpening workId office ledger [ Fact.Reviewed(tenure, run, call, claimed) ])
                            | Program.Step.Relay(same, _) ->
                                let retirementId = Identities.relay workId tenure call
                                let successorId = Identities.successor retirementId
                                Write [ Fact.IncumbencyRetired(retirementId, tenure, "Relayed", run, call, claimed)
                                        Fact.ContextBarrier(Identities.barrier workId call, run, call, successorId)
                                        Fact.IncumbencyOpened(successorId, "Successor", same, None)
                                        Fact.PromptObliged(Identities.successorPrompt retirementId, "Successor", same, Program.successorPrompt same, successorId) ]
                            | Program.Step.Advance(next, text) ->
                                Write [ Fact.MilestoneAdvanced(tenure, milestone, next, run, call, claimed)
                                        Fact.PromptObliged(Identities.advancePrompt tenure next, "Advance", next, text, tenure) ]
                            | Program.Step.Complete ->
                                let retirementId = Identities.complete workId tenure call
                                Write [ Fact.IncumbencyRetired(retirementId, tenure, "Completed", run, call, claimed)
                                        Fact.StopObliged(Identities.stop workId tenure, tenure) ]
                            | _ -> fail "Review program diverged"
                        | Program.Step.AwaitEmptyReview ->
                            match effectOf program (box true) with
                            | Program.Step.Launch ->
                                let operationId = Identities.launch workId run call digest
                                Write [ Fact.DeliveryRequested(operationId, tenure, run, call, digest, claimed) ]
                            | _ -> fail "Launch program diverged"
                        | _ -> fail "Review is not waiting"

    let private recallNote (noted: Dictionary<string, obj>) messageId =
        if noted.ContainsKey messageId then Some noted[messageId] else None

    let decide (workId: string) (ledger: Ledger) (noted: Dictionary<string, obj>) (command: obj) =
        match text (get command "type") with
        | "Review" -> decideReview workId ledger command
        | "OperatorAnswer" ->
            fields [ "type"; "messageId" ] [] command
            let messageId = identifier (get command "messageId")
            match ledger.TryMessage messageId with
            | Some result -> Observe result
            | None ->
                    match ledger.AnswerableQuestion, ledger.ActiveId with
                    | None, _ -> Refuse "No parked question"
                    | Some questionId, Some tenure -> Write [ Fact.OperatorAnswered(messageId, tenure, questionId) ]
                    | Some _, None -> fail "No active tenure"
        | "OperatorMessage" ->
            fields [ "type"; "kind"; "messageId" ] [] command
            let kind = text (get command "kind")
            require (kind = "Operator" || kind = "Advisor" || kind = "Agent") "Unknown operator kind"
            let messageId = identifier (get command "messageId")
            match ledger.TryMessage messageId, recallNote noted messageId with
            | Some result, _ -> Observe result
            | None, Some result -> Observe result
            | None, None ->
                match ledger.Position with
                | Some program when Program.step program = Program.Step.AwaitOperator ->
                    match effectOf program (box kind) with
                    | Program.Step.Reopen -> Write [ Fact.IncumbencyOpened(Identities.reopen workId messageId, "Originator", "执行", Some messageId) ]
                    | Program.Step.AwaitOperator -> Observe(ignored messageId ledger)
                    | _ -> fail "Completion program diverged"
                | _ -> Refuse "Operator message is only accepted after completion"
        | "Confirm" ->
            fields [ "type"; "effectId"; "outcome" ] [ "execSessionId"; "reason" ] command
            let effectId = identifier (get command "effectId")
            let outcome = text (get command "outcome")
            let session = optionalId command "execSessionId"
            let reason = optionalReason command
            let late () = Observe(confirmed outcome effectId ledger)
            match ledger.Describe effectId, outcome, session, reason with
            | None, _, _, _ -> Refuse "Effect is not pending"
            | Some("Ask", "", _), "Parked", None, None
            | Some("Ask", "", _), "Unknown", None, None -> Write [ Fact.EffectConfirmed(effectId, outcome, None, None) ]
            | Some("Ask", recorded, _), claimed, None, None when recorded = claimed -> late ()
            | Some("Dispatch", "", _), "Sent", None, None
            | Some("Dispatch", "", _), "Unknown", None, None -> Write [ Fact.EffectConfirmed(effectId, outcome, None, None) ]
            | Some("Dispatch", recorded, _), claimed, None, None when recorded = claimed -> late ()
            | Some("Launch", "Create", _), "SessionCreated", Some _, None -> Write [ Fact.DeliverySessionBound(effectId, Option.get session) ]
            | Some("Launch", "Create", _), "Unknown", None, None -> Write [ Fact.EffectConfirmed(effectId, "Unknown", None, None) ]
            | Some("Launch", "Create", _), "NotStarted", None, Some reason -> Write [ Fact.DeliveryRejected(effectId, reason) ]
            | Some("Launch", "Send", Some bound), "Admitted", Some claimed, None when bound = claimed -> Write [ Fact.DeliveryAdmitted(effectId, claimed) ]
            | Some("Launch", "Send", _), "Unknown", None, None -> Write [ Fact.EffectConfirmed(effectId, "Unknown", None, None) ]
            | Some("Launch", "Send", _), "NotStarted", None, Some reason -> Write [ Fact.DeliveryRejected(effectId, reason) ]
            | Some("Launch", "Send", Some bound), "SessionCreated", Some claimed, None when bound = claimed -> late ()
            | Some("Launch", "Admitted", Some bound), "Admitted", Some claimed, None when bound = claimed -> late ()
            | Some("Launch", "Unknown", _), "Unknown", None, None -> late ()
            | Some("Launch", "Rejected", _), "NotStarted", None, Some _ -> late ()
            | Some("Stop", "", _), "Requested", None, None
            | Some("Stop", "", _), "Unknown", None, None -> Write [ Fact.EffectConfirmed(effectId, outcome, None, None) ]
            | Some("Stop", "Requested", _), "Observed", None, None -> Write [ Fact.EffectConfirmed(effectId, "Observed", None, None) ]
            | Some("Stop", "Requested", _), "Requested", None, None -> late ()
            | Some("Stop", "Observed", _), "Observed", None, None -> late ()
            | Some("Stop", "Unknown", _), "Unknown", None, None -> late ()
            | _ -> Refuse "Confirmation does not match the effect"
        | "BindDevOps" ->
            fields [ "type"; "trigger"; "devopsId"; "target" ] [] command
            if not ledger.Opened then Refuse "Work is not open"
            else
                let trigger = text (get command "trigger")
                let devopsId = identifier (get command "devopsId")
                let target = if isNull (get command "target") then None else Some(text (get command "target"))
                match ledger.DevOps with
                | Some(existingId, existingTarget, existingTrigger) when existingId = devopsId && existingTarget = target && existingTrigger = trigger ->
                    Observe(decision "DevOpsBound" (ledger.ActiveId |> Option.map box |> Option.defaultValue null) (box ledger.Milestone) ledger.WaitName null (box (View.obligations ledger.Obligations)) [ "devopsId", box devopsId ])
                | Some _ -> Refuse "DevOps binding conflict"
                | None -> Write [ Fact.DevOpsBound(devopsId, target, trigger) ]
        | _ -> fail "Unknown work command"

let Work (workId: string) (records: string array option): IWork =
    do identifier (box workId) |> ignore
    let observed = Dictionary<string, Receipt>()
    let noted = Dictionary<string, obj>()

    let rebuild (bodies: string array) =
        let ledger = Ledger(workId)
        require (isArray (box bodies)) "History must be an array of records, not a service"
        for body in bodies do
            require (isString (box body)) "History records must be text"
            let frame: obj = parse body
            fields [ "requestId"; "requestHash"; "events" ] [] frame
            require (canonical frame = body) "History body is not canonical JSON"
            let requestId = identifier (get frame "requestId")
            let hash = text (get frame "requestHash")
            require (hash.Length = 64 && hash |> Seq.forall (fun character -> "0123456789abcdef".Contains character)) "Invalid request hash"
            let encoded = get frame "events"
            require (isArray encoded) "Events must be an array"
            let facts = unbox<obj array> encoded |> Array.map FactCodec.decode |> Array.toList
            let seal, result = ledger.Apply facts
            ledger.Seal(requestId, hash, seal, result)
        ledger

    let mutable saved = defaultArg records [||]
    let mutable state = rebuild saved
    do saved <- Array.copy saved
    let mutable busy = false

    let guard action =
        require (not busy) "Work does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let detach value = value |> canonical |> parse

    let response status revision result record reason =
        objectOf [ "status", box status; "revision", box revision; "result", result; "record", record; "reason", reason ]

    let remember requestId hash result =
        observed[requestId] <- { Hash = hash; Result = result }

    let recall requestId =
        if observed.ContainsKey requestId then Some observed[requestId] else None

    let inspect () = guard (fun () -> detach (state.Snapshot(saved.Length)))
    let history () = guard (fun () -> saved |> Array.map parse)
    let records () = guard (fun () -> Array.copy saved)
    let recover () = guard (fun () -> detach (state.Recover(saved.Length)))

    let execute (requestId: string, input: obj): obj =
        guard (fun () ->
            identifier (box requestId) |> ignore
            let encoded = canonical input
            let command = parse encoded
            let hash = sha256 encoded
            let revision = saved.Length
            let stored =
                match state.TryReceipt requestId with
                | Some receipt -> Some receipt
                | None -> recall requestId
            match stored with
            | Some receipt ->
                if receipt.Hash = hash then response "Replayed" revision (detach receipt.Result) (null: obj) (null: obj)
                else response "Conflict" revision (null: obj) (null: obj) (box "RequestIdConflict")
            | None ->
                match Commands.decide workId state noted command with
                | Refuse reason -> response "Conflict" revision (null: obj) (null: obj) (box reason)
                | Observe result ->
                    let frozen = detach result
                    remember requestId hash frozen
                    if unbox<string> (get frozen "kind") = "Ignored" then
                        noted[identifier (get command "messageId")] <- frozen
                    response "Observed" revision (detach frozen) (null: obj) (null: obj)
                | Write facts ->
                    let candidate = rebuild saved
                    let facts = facts |> List.map (FactCodec.encode >> FactCodec.decode)
                    let seal, result = candidate.Apply facts
                    let body = canonical (objectOf [ "requestId", box requestId; "requestHash", box hash; "events", box (facts |> List.map FactCodec.encode |> List.toArray) ])
                    let frozen = detach result
                    candidate.Seal(requestId, hash, seal, frozen)
                    let reply = response "Applied" (saved.Length + 1) (detach frozen) (box body) (null: obj)
                    saved <- Array.append saved [| body |]
                    state <- candidate
                    reply)

    { new IWork with
        member _.inspect() = inspect ()
        member _.history() = history ()
        member _.records() = records ()
        member _.recover() = recover ()
        member _.execute(requestId, input) = execute (requestId, input) }
