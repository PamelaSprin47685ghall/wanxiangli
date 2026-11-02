namespace Wanxiangli.RunWitness

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("$0 == null")>]
    let isNullish (_value: obj) : bool = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    let fail (message: string) : 'a =
        raise (ArgumentException("execution-model-routing: " + message))

    let text (owner: string) (name: string) (value: obj) : string =
        if isString value then unbox<string> value else fail (sprintf "%s requires string %s" owner name)

    let target (owner: string) (value: obj) : obj =
        if isNullish value then fail (sprintf "%s requires a target" owner) else value

/// Process-local exact provider-run observations of one Host process
/// (CUT-10 ⑥a): which target a finished provider run used, which exact
/// (session, physical user message) a provider run belongs to.
///
/// Targets are opaque values compared by nobody here; they are stored and
/// handed back by reference.
[<AttachMembers>]
type ProviderRunWitness() =
    /// provider run → (session, target); at most one live witness per session.
    let targetByRun = Dictionary<string, struct (string * obj)>()
    /// session → its latest provider run that still has a witness.
    let latestRunBySession = Dictionary<string, string>()
    /// provider run → exact (session, physical user message).
    let stepByRun = Dictionary<string, struct (string * string)>()

    let retireLatest (sessionId: string) =
        match latestRunBySession.TryGetValue sessionId with
        | true, run ->
            latestRunBySession.Remove sessionId |> ignore
            targetByRun.Remove run |> ignore
        | false, _ -> ()

    let forgetLatestIfCurrent (sessionId: string) (run: string) =
        match latestRunBySession.TryGetValue sessionId with
        | true, latest when latest = run -> latestRunBySession.Remove sessionId |> ignore
        | _ -> ()

    let takeWitness (run: string) : (string * obj) option =
        match targetByRun.TryGetValue run with
        | true, struct (sessionId, target) ->
            targetByRun.Remove run |> ignore
            forgetLatestIfCurrent sessionId run
            Some(sessionId, target)
        | false, _ -> None

    let dropSteps (keep: string * string -> bool) =
        stepByRun
        |> Seq.choose (fun (KeyValue(run, struct (s, p))) -> if keep (s, p) then None else Some run)
        |> Seq.toArray
        |> Array.iter (fun run -> stepByRun.Remove run |> ignore)

    let witnessView (sessionId: string, target: obj) =
        Wire.freeze (createObj [ "sessionId" ==> sessionId; "target" ==> target ])

    /// The exact provider run of the session's current execution finished
    /// with `target`. The session's previous witness is retired: only the
    /// latest run of a session can later be taken.
    member _.remember(sessionId: obj, providerRun: obj, target: obj) : unit =
        let sessionId = Wire.text "remember" "sessionId" sessionId
        let run = Wire.text "remember" "providerRun" providerRun
        let target = Wire.target "remember" target
        retireLatest sessionId
        targetByRun[run] <- struct (sessionId, target)
        latestRunBySession[sessionId] <- run

    /// Single-consumption read of a provider run's witness: `{ sessionId, target }`
    /// or null for a run never remembered, already taken or retired.
    member _.take(providerRun: obj) : obj =
        let run = Wire.text "take" "providerRun" providerRun

        match takeWitness run with
        | Some witness -> witnessView witness
        | None -> null

    /// Record the exact (session, physical user message) a Host-observed
    /// provider run belongs to. A later observation of the same run replaces it.
    member _.rememberStep(sessionId: obj, physicalUserMessageId: obj, providerRun: obj) : unit =
        let sessionId = Wire.text "rememberStep" "sessionId" sessionId
        let physical = Wire.text "rememberStep" "physicalUserMessageId" physicalUserMessageId
        let run = Wire.text "rememberStep" "providerRun" providerRun
        stepByRun[run] <- struct (sessionId, physical)

    /// `{ sessionId, physicalUserMessageId }` of a run this process observed, or
    /// null. Never a session-current substitute.
    member _.stepOf(providerRun: obj) : obj =
        let run = Wire.text "stepOf" "providerRun" providerRun

        match stepByRun.TryGetValue run with
        | true, struct (sessionId, physical) ->
            Wire.freeze (createObj [ "sessionId" ==> sessionId; "physicalUserMessageId" ==> physical ])
        | false, _ -> null

    /// The session's execution retired: its latest witness and
    /// every run → physical relation of the session are forgotten.
    member _.forgetSession(sessionId: obj) : unit =
        let sessionId = Wire.text "forgetSession" "sessionId" sessionId
        retireLatest sessionId
        dropSteps (fun (s, _) -> s <> sessionId)

    /// Exact physical terminal evidence: only the run → physical relations of
    /// that exact (session, physical user message) are forgotten.
    member _.forgetPhysical(sessionId: obj, physicalUserMessageId: obj) : unit =
        let sessionId = Wire.text "forgetPhysical" "sessionId" sessionId
        let physical = Wire.text "forgetPhysical" "physicalUserMessageId" physicalUserMessageId
        dropSteps (fun (s, p) -> s <> sessionId || p <> physical)

    /// Read-only counts for invariant checks and tests.
    member _.snapshot() : obj =
        Wire.freeze (
            createObj
                [ "witnesses" ==> targetByRun.Count
                  "latest" ==> latestRunBySession.Count
                  "steps" ==> stepByRun.Count
                   ]
        )
