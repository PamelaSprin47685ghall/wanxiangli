module Wanxiangli.ScopeProgress.AdvisorFlow

open System
open System.Threading.Tasks
open Fable.Core.JsInterop
open Wanxiangli.ScopeProgress.Queue

type AdvisorFlowReply =
    { Ok: bool
      Prose: string
      Reason: string }

type AdvisorFlowPorts =
    { AskWorker: string -> string -> Task<AdvisorFlowReply>
      AskSeat: string -> string -> Task<AdvisorFlowReply>
      SendSteer: string -> string -> string -> string -> Task<AdvisorFlowReply>
      CurrentEpoch: string -> string
      LanguageFor: string -> string
      Claim: string -> string -> string -> string -> Task<obj>
      Finish: string -> string -> string array -> string -> Task<obj>
      BeginStage: string -> string -> string -> int -> string -> string array -> Task<obj>
      ConfirmStage: string -> string -> string -> int -> string -> Task<obj>
      Pending: string -> string -> Task<obj> }

type AdvisorFlowPort =
    abstract trigger: sessionId: string * epochId: string * reportId: string * issue: string -> Task<obj>
    abstract resume: sessionId: string * epochId: string -> Task<obj>

let AdvisorFlow (queue: AdvisorProcessQueuePort) (ports: AdvisorFlowPorts) : AdvisorFlowPort =
    let isFresh session epoch = ports.CurrentEpoch session = epoch
    let stageOutcomeUnknown reason = Error("Advisor stage outcome unknown: " + reason)
    let observeDurable (work: unit -> Task<obj>) =
        task {
            try return! work()
            with ex ->
                return createObj [ "ok" ==> false; "status" ==> "Unknown"; "reason" ==> ex.Message ]
        }
    let stage session epoch processId phase question triggerIds (work: unit -> Task<AdvisorFlowReply>) =
        task {
            if not (isFresh session epoch) then
                return Error "Advisor process is stale: scope epoch has advanced"
            else
                let! reserved = observeDurable (fun () -> ports.BeginStage session epoch processId phase question (Array.ofList triggerIds))
                let allowed = not (isNull reserved?ok) && unbox<bool> reserved?ok
                let alreadyConfirmed = not (isNull reserved?confirmed) && unbox<bool> reserved?confirmed
                let first = not (isNull reserved?start) && unbox<bool> reserved?start
                if not allowed || (not first && not alreadyConfirmed) then
                    let reason = if isNull reserved?reason then "stage reservation not confirmed" else string reserved?reason
                    return stageOutcomeUnknown reason
                else
                    let! result =
                        if alreadyConfirmed then
                            Task.FromResult(Ok(string reserved?prose))
                        elif not (isFresh session epoch) then
                            Task.FromResult(Error "Advisor process is stale: scope epoch has advanced")
                        else
                            task {
                                let! observed =
                                    task {
                                        try
                                            let! reply = work()
                                            return Ok reply
                                        with ex ->
                                            return Error ex.Message
                                    }
                                match observed with
                                | Error reason -> return stageOutcomeUnknown ("Provider transport threw after stage reservation: " + reason)
                                | Ok reply when not reply.Ok ->
                                    let terminal =
                                        not (isNull reply?ConfirmedFailure) && unbox<bool> reply?ConfirmedFailure
                                    if terminal then return Error reply.Reason
                                    else return stageOutcomeUnknown ("Provider returned unverified failure: " + reply.Reason)
                                | Ok reply when String.IsNullOrWhiteSpace reply.Prose -> return Error "Advisor produced no prose"
                                | Ok reply ->
                                    let! persisted = observeDurable (fun () -> ports.ConfirmStage session epoch processId phase reply.Prose)
                                    let confirmed = not (isNull persisted?ok) && unbox<bool> persisted?ok
                                    if confirmed then return Ok reply.Prose
                                    else
                                        let reason = if isNull persisted?reason then "stage reply was not confirmed" else string persisted?reason
                                        return stageOutcomeUnknown reason
                            }
                    match result with
                    | Error reason -> return Error reason
                    | Ok prose when String.IsNullOrWhiteSpace prose -> return stageOutcomeUnknown "persisted prose is empty"
                    | Ok prose ->
                        let advanced = queue.advance(session, processId, phase)
                        if isNull advanced?ok || not (unbox<bool> advanced?ok) then
                            return stageOutcomeUnknown "Advisor process phase has lost its identity"
                        else return Ok prose
        }
    let rec runFour session epoch processId notes triggerIds =
        task {
            let language = ports.LanguageFor session
            if language <> "en" && language <> "zh-CN" then
                return Error "Advisor session language is not recognized"
            else
                return! runFourWithLanguage session epoch processId notes triggerIds language
        }
    and runFourWithLanguage session epoch processId notes triggerIds language =
        task {
            let issue = String.concat "\n" notes
            let! first = stage session epoch processId 1 issue triggerIds (fun () -> ports.AskWorker session issue)
            match first with
            | Error reason -> return Error reason
            | Ok prose1 ->
                let prompt2 =
                    if language = "zh-CN" then "关于下面这个问题，还需要哪些背景材料才能给出可靠的建议？\n" + prose1
                    else "What background do you need to answer the following problem well?\n" + prose1
                let! second = stage session epoch processId 2 prompt2 triggerIds (fun () -> ports.AskSeat session prompt2)
                match second with
                | Error reason -> return Error reason
                | Ok prose2 ->
                    let prompt3 =
                        if language = "zh-CN" then "你提出了问题：\n" + prose1 + "\n要分析这个问题，还需要以下材料：\n" + prose2 + "\n请提供相关背景、事实和你已经得到的判断。"
                        else "You raised the following problem:\n" + prose1 + "\nThe following background is needed to examine it:\n" + prose2 + "\nProvide the relevant context, facts, and conclusions reached so far."
                    let! third = stage session epoch processId 3 prompt3 triggerIds (fun () -> ports.AskWorker session prompt3)
                    match third with
                    | Error reason -> return Error reason
                    | Ok prose3 ->
                        let prompt4 =
                            if language = "zh-CN" then "补充信息如下：\n" + prose3 + "\n请结合之前的问题给出分析和建议。"
                            else "Additional background:\n" + prose3 + "\nUse the earlier problem and this background to provide your analysis and advice."
                        let! fourth = stage session epoch processId 4 prompt4 triggerIds (fun () -> ports.AskSeat session prompt4)
                        match fourth with
                        | Error reason -> return Error reason
                        | Ok prose4 ->
                            if not (isFresh session epoch) then
                                return Error "Advisor answer arrived after its scope was retired"
                            else
                                // Stage 5 fences the physical Host effect, independently of
                                // the four confirmed model answers. Unknown never resends.
                                let! reserved = observeDurable (fun () -> ports.BeginStage session epoch processId 5 prose4 (Array.ofList triggerIds))
                                let allowed = not (isNull reserved?ok) && unbox<bool> reserved?ok
                                let confirmed = not (isNull reserved?confirmed) && unbox<bool> reserved?confirmed
                                let first = not (isNull reserved?start) && unbox<bool> reserved?start
                                if confirmed && allowed then return Ok()
                                elif not allowed || not first then
                                    return stageOutcomeUnknown "Advisor steer physical delivery may already have happened"
                                else
                                    let! delivered =
                                        task {
                                            try return! ports.SendSteer session epoch processId prose4
                                            with ex ->
                                                return { Ok = false; Prose = ""; Reason = ex.Message }
                                        }
                                    if not delivered.Ok then
                                        return stageOutcomeUnknown ("Advisor steer physical outcome unknown: " + delivered.Reason)
                                    else
                                        let! settled = observeDurable (fun () -> ports.ConfirmStage session epoch processId 5 prose4)
                                        let success = not (isNull settled?ok) && unbox<bool> settled?ok
                                        if success then return Ok()
                                        else return stageOutcomeUnknown "Advisor accepted steer but physical proof commit is unknown"
        }
    let rec runQueue session epoch processId notes triggerIds =
        task {
            let! current =
                task {
                    try return! runFour session epoch processId notes triggerIds
                    with ex -> return Error("Advisor transport failed: " + ex.Message)
                }
            let unsettled =
                match current with
                | Error reason when reason.StartsWith("Advisor stage outcome unknown:", StringComparison.Ordinal) -> true
                | _ -> false
            if unsettled then
                return current
            else
                return! finishProcess session epoch processId notes triggerIds current
        }
    and finishProcess session epoch processId notes triggerIds current =
        task {
            let status = match current with | Ok () -> "Completed" | Error _ -> "Failed"
            let! settled =
                task {
                    try
                        return! ports.Finish session epoch (Array.ofList triggerIds) status
                    with ex ->
                        return createObj [ "ok" ==> false; "status" ==> "Unknown"; "reason" ==> ex.Message ]
                }
            let confirmed = not (isNull settled?ok) && unbox<bool> settled?ok
            if not confirmed then
                return Error "Advisor terminal persistence is unknown; the pending Process remains fenced"
            else
                let doneResult =
                    match current with
                    | Ok () -> queue.finish(session, processId)
                    | Error _ -> queue.fail(session, processId)
                let starts = not (isNull doneResult?start) && unbox<bool> doneResult?start
                if starts && isFresh session epoch then
                    let nextId = string doneResult?processId
                    let nextNotes = unbox<string array> doneResult?notes
                    let nextTriggers = unbox<string array> doneResult?triggers
                    return! runQueue session epoch nextId (Array.toList nextNotes) (Array.toList nextTriggers)
                else
                    if isFresh session epoch then
                        let! _ = resumePending session epoch
                        ()
                    return current
        }
    and resumePending sessionId epochId =
        task {
                if not (isFresh sessionId epochId) then
                    return createObj [ "ok" ==> false; "reason" ==> "Scope is no longer current" ]
                elif queue.hasActive(sessionId, epochId) then
                    return createObj [ "ok" ==> true; "start" ==> false; "reason" ==> "process is already in this owner" ]
                else
                    let! snapshot = observeDurable (fun () -> ports.Pending sessionId epochId)
                    let available = not (isNull snapshot?ok) && unbox<bool> snapshot?ok
                    if not available then return snapshot
                    else
                        let pending: obj array = unbox snapshot?pending
                        if pending.Length = 0 then return createObj [ "ok" ==> true; "start" ==> false ]
                        else
                            let first = pending[0]
                            let group = first?group
                            let reportIds: string array =
                                if isNull group then [| string first?reportId |]
                                else unbox group?reportIds
                            let firstIsGroupOwner =
                                reportIds.Length > 0 && reportIds[0] = string first?reportId
                            let allPending =
                                reportIds
                                |> Array.forall (fun id ->
                                    pending |> Array.exists (fun item -> string item?reportId = id))
                            if not firstIsGroupOwner || not allPending then
                                return createObj [ "ok" ==> false; "reason" ==> "durable Advisor group membership is incomplete" ]
                            else
                                let notes =
                                    reportIds
                                    |> Array.map (fun id ->
                                        pending
                                        |> Array.find (fun item -> string item?reportId = id)
                                        |> fun item -> string item?issue)
                                let rec verify index =
                                    task {
                                        if index >= reportIds.Length then return true
                                        else
                                            let! replay =
                                                observeDurable (fun () ->
                                                    ports.Claim sessionId epochId reportIds[index] notes[index])
                                            let proved =
                                                not (isNull replay?ok) && unbox<bool> replay?ok
                                                && not (isNull replay?accepted) && not (unbox<bool> replay?accepted)
                                                && string replay?status = "Replayed"
                                            if not proved then return false
                                            else return! verify (index + 1)
                                    }
                                let! admitted = verify 0
                                if not admitted || not (isFresh sessionId epochId) then
                                    return createObj [ "ok" ==> false; "reason" ==> "durable group replay identity or Scope fence cannot be proved" ]
                                else
                                    let queued = queue.restoreGroup(sessionId, epochId, reportIds, notes)
                                    let start = not (isNull queued?start) && unbox<bool> queued?start
                                    if start then
                                        runQueue sessionId epochId (string queued?processId)
                                            (Array.toList notes) (Array.toList reportIds) |> ignore
                                    return queued
        }
    { new AdvisorFlowPort with
        member _.resume(sessionId, epochId) = resumePending sessionId epochId
        member _.trigger(sessionId, epochId, reportId, issue) =
            task {
                if not (isFresh sessionId epochId) then
                    return createObj [ "ok" ==> false; "reason" ==> "Advisor trigger belongs to a retired Scope" ]
                else
                    let! claim = ports.Claim sessionId epochId reportId issue
                    let allowed = not (isNull claim?ok) && unbox<bool> claim?ok
                    let first = not (isNull claim?accepted) && unbox<bool> claim?accepted
                    if not allowed then return claim
                    elif not first then
                        return createObj [ "ok" ==> true; "accepted" ==> false; "start" ==> false; "reason" ==> "Advisor trigger already has durable admission" ]
                    elif not (isFresh sessionId epochId) then
                        return createObj [ "ok" ==> false; "reason" ==> "Scope advanced after Advisor admission; refusing dispatch" ]
                    elif not (isNull claim?held) && unbox<bool> claim?held && not (queue.hasActive(sessionId, epochId)) then
                        return createObj [ "ok" ==> true; "accepted" ==> true; "start" ==> false; "reason" ==> "prior Advisor Process remains durable and unresolved" ]
                    else
                        let accepted = queue.enqueueWithNote(sessionId, epochId, reportId, issue)
                        let ok = not (isNull accepted?ok) && unbox<bool> accepted?ok
                        let start = not (isNull accepted?start) && unbox<bool> accepted?start
                        if ok && start then
                            let work = runQueue sessionId epochId (string accepted?processId) [ issue ] [ reportId ]
                            work |> ignore
                        return accepted
            } }
