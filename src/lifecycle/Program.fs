namespace Wanxiangli.Lifecycle

module internal Program =
    let askText = "我需要干什么？"

    let milestones = function
        | "Plan" -> [| "事实与取舍"; "理解与路径"; "流程与伪代码"; "待执行" |]
        | "Manager" -> [| "执行"; "收尾"; "已完成" |]
        | other -> failwith ("Unknown office: " + other)

    let firstMilestone office = (milestones office)[0]

    let knownMilestone office milestone =
        milestones office |> Array.exists ((=) milestone)

    let nextMilestone milestone =
        match milestone with
        | "事实与取舍" -> "理解与路径"
        | "理解与路径" -> "流程与伪代码"
        | "流程与伪代码" -> "待执行"
        | "执行" -> "收尾"
        | other -> failwith ("No next milestone: " + other)

    let successorPrompt milestone = "继任「" + milestone + "」。先独立验收。"
    let advancePrompt milestone = "进入「" + milestone + "」。"

    type Context =
        { WorkId: string
          Tenure: string
          Run: string
          Call: string
          Claimed: (string * string option) list
          Digest: string }

    [<RequireQualifiedAccess>]
    type Step =
        | AwaitReview
        | AwaitEmptyReview
        | AwaitOperator
        | Ask of text: string * question: (Context -> Fact)
        | Post of write: (Context -> Fact list)
        | Reopen

    type Program = Waiting of Step * (obj -> Program)

    type Await<'T> = Await of Step

    type WorkBuilder() =
        member _.Bind(source: Await<'T>, binder: 'T -> Program) : Program =
            let (Await step) = source
            Waiting(step, fun value -> binder (unbox value))

        member _.ReturnFrom(program: Program) = program
        member _.Delay(thunk: unit -> Program) = thunk ()

    let work = WorkBuilder()
    let awaitReview: Await<bool> = Await Step.AwaitReview
    let awaitEmptyReview: Await<bool> = Await Step.AwaitEmptyReview
    let awaitOperator: Await<string> = Await Step.AwaitOperator
    let askAndPark (text: string): Await<unit> =
        Await(Step.Ask(text, fun context ->
            Fact.QuestionRequested(Identities.ask context.WorkId context.Tenure context.Call, context.Tenure, context.Run, context.Call, text, context.Claimed)))
    let postFacts (write: Context -> Fact list): Await<unit> = Await(Step.Post write)
    let reopenExecution: Await<unit> = Await Step.Reopen
    let commitReview: Await<unit> =
        postFacts (fun context -> [ Fact.Reviewed(context.Tenure, context.Run, context.Call, context.Claimed) ])
    let relayAt milestone: Await<unit> =
        postFacts (fun context ->
            let retirementId = Identities.relay context.WorkId context.Tenure context.Call
            let successorId = Identities.successor retirementId
            [ Fact.IncumbencyRetired(retirementId, context.Tenure, "Relayed", context.Run, context.Call, context.Claimed)
              Fact.ContextBarrier(Identities.barrier context.WorkId context.Call, context.Run, context.Call, successorId)
              Fact.IncumbencyOpened(successorId, "Successor", milestone, None)
              Fact.PromptObliged(Identities.successorPrompt retirementId, "Successor", milestone, successorPrompt milestone, successorId) ])
    let advanceFrom milestone: Await<unit> =
        postFacts (fun context ->
            let next = nextMilestone milestone
            [ Fact.MilestoneAdvanced(context.Tenure, milestone, next, context.Run, context.Call, context.Claimed)
              Fact.PromptObliged(Identities.advancePrompt context.Tenure next, "Advance", next, advancePrompt next, context.Tenure) ])
    let launchManager: Await<unit> =
        postFacts (fun context ->
            [ Fact.DeliveryRequested(Identities.launch context.WorkId context.Run context.Call context.Digest, context.Tenure, context.Run, context.Call, context.Digest, context.Claimed) ])
    let completeWhenUnblocked: Await<unit> =
        postFacts (fun context ->
            [ Fact.IncumbencyRetired(Identities.complete context.WorkId context.Tenure context.Call, context.Tenure, "Completed", context.Run, context.Call, context.Claimed)
              Fact.StopObliged(Identities.stop context.WorkId context.Tenure, context.Tenure) ])

    let step (Waiting(current, _)) = current
    let continueWith (Waiting(_, next)) value = next value

    let expects (expected: Step) (current: Step) =
        match expected, current with
        | Step.AwaitReview, Step.AwaitReview
        | Step.AwaitEmptyReview, Step.AwaitEmptyReview
        | Step.AwaitOperator, Step.AwaitOperator
        | Step.Ask _, Step.Ask _
        | Step.Post _, Step.Post _
        | Step.Reopen, Step.Reopen -> true
        | _ -> false

    let rec settle (program: Program) =
        match step program with
        | Step.Post _
        | Step.Reopen -> settle (continueWith program (box ()))
        | _ -> program

    let advance (program: Program) (value: obj) = settle (continueWith program value)

    let rec collect (context: Context) (program: Program) : Fact list * Program =
        match step program with
        | Step.Ask(_, question) -> [ question context ], program
        | Step.Post write ->
            let facts, next = collect context (continueWith program (box ()))
            write context @ facts, next
        | Step.Reopen -> collect context (continueWith program (box ()))
        | _ -> [], program

    let reviewContext workId tenure run call claimed digest =
        { WorkId = workId; Tenure = tenure; Run = run; Call = call; Claimed = claimed; Digest = digest }

    let review (context: Context) (program: Program) (empty: bool) : Fact list * Program =
        match step program with
        // 未知投递上的实账评审就是答复：消费 Ask，再按普通评审推进。
        | Step.Ask _ ->
            let afterAsk = settle (continueWith program (box ()))
            match step (continueWith afterAsk (box false)) with
            | Step.Post _ -> collect context (continueWith afterAsk (box false))
            | _ -> invalidOp "Review program diverged"
        | Step.AwaitReview ->
            let next = continueWith program (box empty)
            match step next with
            | Step.Ask _
            | Step.Post _ -> collect context next
            | _ -> invalidOp "Review program diverged"
        | Step.AwaitEmptyReview ->
            let next = continueWith program (box true)
            match step next with
            | Step.Post _ -> collect context next
            | _ -> invalidOp "Launch program diverged"
        | _ -> invalidOp "Review is not waiting"

    type Completion =
        | Reopened of Fact list
        | Ignored

    let complete (workId: string) (messageId: string) (kind: string) (program: Program) : Completion * Program =
        let next = continueWith program (box kind)
        match step next with
        | Step.Reopen ->
            Reopened [ Fact.IncumbencyOpened(Identities.reopen workId messageId, "Originator", "执行", Some messageId) ], settle next
        | Step.AwaitOperator -> Ignored, settle next
        | _ -> invalidOp "Completion program diverged"

    let rec originator milestone = work {
        let! empty = awaitReview
        if empty then
            do! askAndPark askText
            return! originator milestone
        else
            do! commitReview
            return! workUntilClear milestone
    }

    and workUntilClear milestone = work {
        let! empty = awaitReview
        if empty then
            do! relayAt milestone
            return! successor milestone
        else
            do! commitReview
            return! workUntilClear milestone
    }

    and successor milestone = work {
        let! empty = awaitReview
        if empty then
            do! advanceFrom milestone
            return! enterNext milestone
        else
            do! commitReview
            return! workUntilClear milestone
    }

    and enterNext milestone =
        let next = nextMilestone milestone
        match next with
        | "待执行" -> ready ()
        | "收尾" -> cleanup ()
        | _ -> originator next

    and ready () = work {
        let! _empty = awaitEmptyReview
        do! launchManager
        return! ready ()
    }

    and cleanup () = work {
        let! empty = awaitReview
        if empty then
            do! completeWhenUnblocked
            return! completed ()
        else
            do! commitReview
            return! cleanup ()
    }

    and completed () = work {
        let! kind = awaitOperator
        if kind = "Operator" then
            do! reopenExecution
            return! originator "执行"
        else
            return! completed ()
    }
