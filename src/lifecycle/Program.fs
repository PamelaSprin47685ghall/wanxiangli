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

    [<RequireQualifiedAccess>]
    type Step =
        | AwaitReview
        | AwaitEmptyReview
        | AwaitOperator
        | Ask of string
        | Commit
        | Relay of string * string
        | Advance of string * string
        | Launch
        | Complete
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
    let askAndPark text: Await<unit> = Await(Step.Ask text)
    let commitReview: Await<unit> = Await Step.Commit
    let relayAt milestone: Await<unit> = Await(Step.Relay(milestone, successorPrompt milestone))
    let advanceFrom milestone: Await<unit> =
        let next = nextMilestone milestone
        Await(Step.Advance(next, advancePrompt next))
    let launchManager: Await<unit> = Await Step.Launch
    let completeWhenUnblocked: Await<unit> = Await Step.Complete
    let reopenExecution: Await<unit> = Await Step.Reopen

    let step (Waiting(current, _)) = current
    let continueWith (Waiting(_, next)) value = next value

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
        match milestone with
        | "事实与取舍" -> originator "理解与路径"
        | "理解与路径" -> originator "流程与伪代码"
        | "流程与伪代码" -> ready ()
        | "执行" -> cleanup ()
        | other -> failwith ("No entry after " + other)

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

    let entry phase milestone =
        match phase with
        | "Unopened"
        | "Originator" -> originator milestone
        | "Working" -> workUntilClear milestone
        | "SuccessorFirst" -> successor milestone
        | "Ready" -> ready ()
        | "Cleanup" -> cleanup ()
        | "Completed" -> completed ()
        | other -> failwith ("No program for " + other)
