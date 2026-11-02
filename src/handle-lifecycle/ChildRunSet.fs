module Wanxiangli.HandleLifecycle.ChildRunSet

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<Emit("$0 == null")>]
let private absent (_value: obj) : bool = jsNative
[<Emit("Object.freeze({...$0})")>]
let private snapshot (_value: obj) : obj = jsNative
[<Emit("Object.freeze({...$0, ...$1})")>]
let private overlay (_value: obj) (_fields: obj) : obj = jsNative

let private success (value: obj) = createObj [ "ok" ==> true; "value" ==> value ]
let private failure (error: string) = createObj [ "ok" ==> false; "error" ==> error ]

type private ChildRun =
    { Id: string
      RunId: string
      Agent: string
      Role: string
      Prompt: string
      CreatedAt: obj
      mutable ChildSession: obj
      mutable Cancelled: bool
      mutable Completion: obj option
      Pending: Task<obj>
      Resolve: obj -> unit }

let private createRun id runId agent role prompt (createdAt: obj) : ChildRun =
    let mutable resolveValue: obj -> unit = ignore
    let promise: JS.Promise<obj> = JS.Constructors.Promise.Create(fun resolve _ -> resolveValue <- resolve)
    { Id = id; RunId = runId; Agent = agent; Role = role; Prompt = prompt; CreatedAt = createdAt
      ChildSession = null; Cancelled = false; Completion = None
      Pending = unbox<Task<obj>> promise; Resolve = resolveValue }

let private active run = not run.Cancelled && run.Completion.IsNone

let private status cancelled run =
    match run.Completion with
    | Some completion ->
        let outcome: obj = completion?outcome
        match unbox<string> outcome?kind with
        | "failed" when unbox<string> outcome?code = "INTERRUPTED" -> "Interrupted"
        | "abandoned" -> "Closed"
        | _ -> "Idle"
    | None when cancelled || run.Cancelled -> "Closed"
    | None -> "Busy"

let private record cancelled run =
    let label: obj =
        match run.Completion with
        | None -> null
        | Some completion ->
            let outcome: obj = completion?outcome
            match unbox<string> outcome?kind with
            | "failed" when unbox<string> outcome?code = "INTERRUPTED" -> outcome?message
            | "abandoned" -> outcome?reason
            | kind -> box kind
    snapshot (createObj [
        "agentId" ==> run.Id; "agent" ==> run.Agent; "role" ==> run.Role
        "status" ==> status cancelled run
        "currentRunId" ==> (if run.Completion.IsSome then null else box run.RunId)
        "terminalStatusLabel" ==> label; "completionCellSettled" ==> run.Completion.IsSome
        "childSessionId" ==> run.ChildSession ])

[<AttachMembers>]
type ChildRunSet(options: obj) =
    let mailbox: obj = options?mailbox
    let mutable agents: Map<string, ChildRun> = Map.empty
    let mutable ptys: Map<string, obj> = Map.empty
    let now () : obj = options?now ()
    let mailboxCancelled () : bool = mailbox?isCancelled ()
    let pulse (id: string) : unit = mailbox?pulseAgent (id)

    let settle (run: ChildRun) (outcome: obj) =
        let identified =
            if unbox<string> outcome?kind = "abandoned" then
                overlay outcome (createObj [ "agentId" ==> run.Id ])
            else
                overlay outcome (createObj [ "agentId" ==> run.Id; "runId" ==> run.RunId; "role" ==> run.Role ])
        let completion = snapshot (createObj [
            "runId" ==> run.RunId; "agentName" ==> run.Agent; "role" ==> run.Role
            "outcome" ==> identified; "completedAt" ==> now () ])
        if run.Completion.IsNone then
            run.Completion <- Some completion
            run.Resolve completion
        pulse run.Id
        if not (absent options?onTerminal) then
            try (options?onTerminal (completion): unit) with _ -> ()

    let execute run (input: obj) =
        task {
            if not run.Cancelled then
                // Keep work after the asynchronous identity check used by the original runner.
                do! Task.FromResult ()
                let! outcome =
                    task {
                        try
                            let work: obj -> Task<obj> = if absent input?run then options?runDefault else input?run
                            return! work input
                        with ex ->
                            return createObj [ "kind" ==> "failed"; "childSessionId" ==> (null: obj)
                                               "code" ==> "ERROR"; "message" ==> ex.Message ]
                    }
                settle run outcome
        }

    member _.fork(input: obj) : string =
        let id: string = input?agentId
        let agent = (unbox<string> input?agent).Trim()
        if mailboxCancelled () then "NotFound"
        elif Map.tryFind id agents |> Option.exists active then "Nudged"
        else
            let isNew = not (Map.containsKey id agents)
            let runId: string = options?mintRunId ()
            let prompt = if absent input?prompt then "" else unbox<string> input?prompt
            let run = createRun id runId agent (unbox<string> input?role) prompt (now ())
            agents <- Map.add id run agents
            execute run input |> ignore
            if isNew then "Created" else "Nudged"

    member _.restore(input: obj) =
        let id: string = input?agentId
        if not (Map.containsKey id agents) then
            let run = createRun id ("restored-" + id) ((unbox<string> input?agent).Trim()) (unbox<string> input?role) "(restored from journal)" (now ())
            agents <- Map.add id run agents

    member _.bindChildSession(id: string, childSessionId: string) =
        Map.tryFind id agents |> Option.iter (fun run -> run.ChildSession <- box childSessionId)
    member _.cancelAgent(id: string) =
        Map.tryFind id agents |> Option.iter (fun run -> run.Cancelled <- true)
    member this.markInterrupted(id: string, _reason: string) = this.cancelAgent id

    member _.awaitAgent(id: string, ?timeoutMs: int) : Task<obj> =
        match Map.tryFind id agents with
        | None -> Task.FromResult(failure ("Unknown agent id: " + id))
        | Some run ->
            let timeout () = failure ("await agent timed out: " + id)
            task {
                match timeoutMs with
                | Some ms when ms <= 0 -> return timeout ()
                | Some ms ->
                    let pending: Task<bool> = options?raceExit (run.Pending, ms)
                    let! first = pending
                    if first then
                        let! value = run.Pending
                        return success value
                    else return timeout ()
                | None ->
                    let! value = run.Pending
                    return success value
            }

    member _.list() =
        createObj [ "agents" ==> (agents |> Map.toArray |> Array.map (snd >> record (mailboxCancelled ())))
                    "ptys" ==> (ptys |> Map.toArray |> Array.map (snd >> snapshot)) ]
    member _.registerPty(pty: obj) = ptys <- Map.add (unbox<string> pty?ptyId) (snapshot pty) ptys
    member _.unregisterPty(id: string) = ptys <- Map.remove id ptys
    member _.publishPtyCompletion(id: string, item: obj) =
        if Map.containsKey id ptys then (mailbox?publishPty (item): unit)
    member _.pulseAgentHandle(id: string) = pulse id
    member _.pulseWake() : unit = mailbox?pulseWake ()
    member _.waitForWake() : Task<obj> = mailbox?waitForWake ()
    member _.waitForSignal(interrupt: Task<obj>) : Task<obj> = mailbox?waitForSignal (interrupt)
    member _.drainAgentWakes(maxCount: int) : string array = mailbox?drainAgents (maxCount)
    member _.drainPtyCompletions(maxCount: int) : obj array = mailbox?drainPtys (maxCount)
    member _.isCancelled = mailboxCancelled ()
    member _.activeRunCount = agents |> Map.filter (fun _ run -> active run) |> Map.count
    member _.pendingCompletionCount: int = mailbox?pendingCount ()
    member _.pendingPtyCount: int = mailbox?pendingPtyCount ()
    member _.close() =
        if (mailbox?cancel (): bool) then
            for KeyValue(_, run) in agents do run.Cancelled <- true
            if not (absent options?cleanup) then
                for KeyValue(id, _) in agents do
                    try (options?cleanup (id): unit) with _ -> ()
