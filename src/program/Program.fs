module Wanxiangli.Program.Program

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Program
open Wanxiangli.Program.Native
open Wanxiangli.Program.Caller

type private Observation = { Pause: int; Command: int }

[<AttachMembers>]
type private Session(sessionId: string, runtime: obj) =
    let programs = Dictionary<string, Run>()
    let calls = Dictionary<string, string * string * string * Task<obj>>()
    let mutable closed = false

    let rejected name code reason =
        Task.FromResult(receipt name "failed" (failure code reason))

    let observations () =
        programs
        |> Seq.map (fun entry ->
            entry.Key,
            { Pause = entry.Value.Generation
              Command = entry.Value.CommandGeneration })
        |> Map.ofSeq

    let canControl (caller: Set<string>) (target: Run) = Set.isSubset target.Capabilities caller

    let control
        (callerName: string)
        (callerCapabilities: Set<string>)
        (observed: Map<string, Observation>)
        (memberName: string)
        (args: obj array)
        (window: RequestWindow)
        =
        let targetName = if args.Length > 0 then text args[0] else ""
        let target = programs.TryGetValue targetName
        let wanted = Map.tryFind targetName observed

        if targetName = "" || targetName = callerName then
            rejected targetName "INVALID_ARGUMENT" "control requires the name of another program"
        elif memberName = "unpark" && (args.Length < 1 || args.Length > 2) then
            rejected
                targetName
                "INVALID_ARGUMENT"
                "unpark requires a name and an optional value; intent belongs to the tool request"
        elif memberName = "abandon" && args.Length <> 1 then
            rejected targetName "INVALID_ARGUMENT" "abandon requires one program name"
        elif
            (memberName = "signal" || memberName = "send")
            && (args.Length <> 2 || not (Set.contains "Exec" callerCapabilities))
        then
            rejected targetName "CAPABILITY_DENIED" "command control requires Exec and two arguments"
        else
            match target, wanted with
            | (false, _), _ -> rejected targetName "PROGRAM_UNKNOWN" "no execution site is known for this program name"
            | (true, _), None -> rejected targetName "STALE_CONTROL" "this request did not observe the target program"
            | (true, program), Some _ when not (canControl callerCapabilities program) ->
                rejected targetName "CAPABILITY_DENIED" "this request does not hold the target program's capabilities"
            | (true, program), Some seen ->
                match memberName with
                | "unpark" ->
                    let value = if args.Length = 2 then args[1] else null
                    program.Resume(window, value, seen.Pause)
                | "abandon" -> program.Abandon()
                | "signal" -> program.Signal(args[1], seen.Command)
                | "send" -> program.Send(args[1], seen.Command)
                | _ -> rejected targetName "INVALID_ARGUMENT" "unknown program control"

    member _.execute(options: obj) : Task<obj> =
        let nameValue = get options "name"
        let name = text nameValue
        let source = get options "program"
        let callId = field options "callId"
        let intent = get options "intent"

        if closed then
            rejected name "SESSION_CLOSED" "the program session is closed"
        elif
            not (validName nameValue)
            || not (isText source)
            || String.IsNullOrWhiteSpace(text source)
            || (budget intent).IsNone
        then
            rejected name "INVALID_ARGUMENT" "name, program and intent are required strings; intent must be non-empty"
        else
            let replay =
                if callId = "" then
                    None
                else
                    match calls.TryGetValue callId with
                    | true, value -> Some value
                    | _ -> None

            match replay with
            | Some(previousName, previousSource, previousPlan, result) when
                previousName = name && previousSource = text source && previousPlan = text intent
                ->
                result
            | Some _ -> rejected name "CALL_REPLAY_MISMATCH" "the physical tool call already belongs to another request"
            | None when programs.ContainsKey name ->
                rejected name "NAME_TAKEN" "this name already belongs to a program in the session"
            | None ->
                let observed = observations ()
                let capabilities = strings (get options "capabilities") |> Set.ofArray
                let window = RequestWindow(runtime, now runtime + (budget intent).Value)
                let program = Run(options, runtime, window, control name capabilities observed)
                programs.Add(name, program)
                let result = program.Start()

                if callId <> "" then
                    calls.Add(callId, (name, text source, text intent, result))

                result

    member _.inspect() =
        programs.Values |> Seq.map _.Inspect() |> Seq.toArray

    member _.pendingNames() =
        programs.Values
        |> Seq.filter (fun run -> not (terminal run.State))
        |> Seq.map _.Name
        |> Seq.sort
        |> Seq.toArray

    member _.close() : Task<obj> =
        task {
            closed <- true
            let programsToClose = programs.Values |> Seq.toArray
            let! outcomes = programsToClose |> Array.map _.Abandon() |> all

            return
                createObj
                    [ "sessionId" ==> sessionId
                      "state"
                      ==> (if outcomes |> Array.forall (fun value -> terminal (field value "state")) then
                               "closed"
                           else
                               "closing")
                      "programs" ==> outcomes ]
        }

let ProgramSession (sessionId: string) : obj =
    if String.IsNullOrWhiteSpace sessionId then
        invalidArg "sessionId" "sessionId is required"

    Session(sessionId, createRuntime ()) :> obj

[<AttachMembers>]
type private Sessions() =
    let sessions = Dictionary<string, Session>()
    let runtime = createRuntime ()

    member _.session(sessionId: string) : obj =
        if String.IsNullOrWhiteSpace sessionId then
            invalidArg "sessionId" "sessionId is required"

        match sessions.TryGetValue sessionId with
        | true, session -> session :> obj
        | false, _ ->
            let session = Session(sessionId, runtime)
            sessions.Add(sessionId, session)
            session :> obj

    member _.close(sessionId: string) : Task<obj> =
        task {
            match sessions.TryGetValue sessionId with
            | false, _ ->
                programCallers.clearSession sessionId
                return
                    createObj
                        [ "sessionId" ==> sessionId
                          "state" ==> "closed"
                          "programs" ==> ([||]: obj array) ]
            | true, session ->
                let! outcome = session.close ()

                if field outcome "state" = "closed" then
                    sessions.Remove sessionId |> ignore
                    programCallers.clearSession sessionId

                return outcome
        }

    member _.inspect() =
        sessions
        |> Seq.map (fun item -> createObj [ "sessionId" ==> item.Key; "programs" ==> item.Value.inspect () ])
        |> Seq.toArray

let Program () : obj = Sessions() :> obj
