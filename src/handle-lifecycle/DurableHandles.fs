module Wanxiangli.HandleLifecycle.DurableHandles

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.HandleLifecycle.HandleHistory
open Wanxiangli.HandleLifecycle.CompletionRecord

let private text (value: obj) name : string = value?(name)
let private sameHandle (left: obj) (right: obj) =
    unbox<int> left?kind = unbox<int> right?kind && text left "id" = text right "id"
let private ok (value: obj) : bool = value?ok
let private success value = createObj [ "ok" ==> true; "value" ==> value ]
let private failure kind message = createObj [ "ok" ==> false; "kind" ==> kind; "error" ==> message ]
let private failed message = failure "AppendFailed" message
let private unavailable reason = failure "NotJoinable" reason
let private retired () = failure "AlreadyRetired" ""
[<Emit("$0()")>]
let private call0<'T> (_callback: obj) : 'T = jsNative
[<Emit("$0($1)")>]
let private call1<'T> (_callback: obj) (_value: obj) : 'T = jsNative
let private workIdentity (work: obj) = createObj [ "childSessionId" ==> work?child; "authorityRoot" ==> work?root ]
let private noBody = createObj [ "kind" ==> "Cancelled"; "reference" ==> null; "digest" ==> null ]
let private completion (record: obj) : obj = record?completion
let private joinable (record: obj) = text record "phase" = "CompletedAwaitingJoin" || text record "phase" = "Abandoned"
let private candidates (history: HandleHistory) = history.orderedCandidates()

[<AttachMembers>]
type DurableHandles(effects: obj) =
    let codec = CompletionRecord()
    let history () : HandleHistory = call0 effects?current
    let refresh () : obj = call0 effects?refresh
    let append fact : Task<obj> = call1 effects?append fact
    let read reference : Task<obj> = call1 effects?readBlob reference
    let sha body : string = call1 effects?sha256 body
    let event kind fields = createObj ([ "kind" ==> kind ] @ fields)
    let afterConsume result value =
        if ok result then success value
        elif text result "kind" = "AppendFailed" then failure "NotFound" (text result "error")
        else success null

    let consumeScoped (record: obj) =
        task {
            let refreshed = refresh ()
            if not (ok refreshed) then return failed (text refreshed "error")
            else
                let work: obj = record?work
                let current = history ()
                let durable = current.work work
                if isNull durable then return unavailable "WorkNotAdmitted"
                elif text durable "phase" = "Retired" then return retired ()
                else
                    let cell = if text durable "phase" = "Abandoned" then noBody else completion durable
                    if isNull cell then return unavailable "NotCompleted"
                    else
                        let consumptionId: string = call0 effects?mintConsumptionId
                        let checked = current.transitionWork(createObj [ "event" ==> "consume"; "work" ==> work; "completion" ==> cell; "consumptionId" ==> consumptionId ])
                        if not (ok checked) then
                            if text checked "error" = "HandleIsRetired" then return retired ()
                            else return unavailable (text checked "error")
                        else
                            let! appended = append (event "consumeWork" [ "work" ==> work; "completion" ==> cell; "consumptionId" ==> consumptionId ])
                            if not (ok appended) then return failed (text appended "error")
                            else
                                let refreshed = refresh ()
                                if not (ok refreshed) then return failed (text refreshed "error")
                                else
                                    let consumed = (history ()).work work
                                    if not (isNull consumed) && text consumed "consumptionId" = consumptionId then return success record
                                    elif not (isNull consumed) && text consumed "phase" = "Retired" then return retired ()
                                    else return failed "exact consumption receipt was not confirmed"
        }

    let consumeHistorical (record: obj) =
        task {
            let refreshed = refresh ()
            if not (ok refreshed) then return failed (text refreshed "error")
            else
                let binding = (history ()).binding record?handle
                if not (isNull binding) && text binding "phase" = "Retired" then return retired ()
                elif isNull binding || text binding "phase" <> "Abandoned" || text binding "reason" <> "Voided" then return unavailable "NotCompleted"
                else
                    let! appended = append (event "retire" [ "handle" ==> record?handle ])
                    if not (ok appended) then return failed (text appended "error")
                    else
                        let refreshed = refresh ()
                        if not (ok refreshed) then return failed (text refreshed "error")
                        else
                            let binding = (history ()).binding record?handle
                            if not (isNull binding) && text binding "phase" = "Retired" then return success binding
                            else return failed "historical retirement receipt was not confirmed"
        }

    let rejectFalse (record: obj) (cell: obj) =
        task {
            if text record "phase" <> "CompletedAwaitingJoin" then return success null
            else
                let! appended = append (event "rejectFalseCompletion" [ "handle" ==> record?handle; "completion" ==> cell ])
                if ok appended then return success null
                else
                    let current = (history ()).summary record?handle
                    if not (isNull current) && text current "phase" = "Active" then return success null
                    else return failure "NotFound" (text appended "error")
        }

    member _.orderedCandidates() = candidates (history ())

    member _.link(binding: obj) =
        let checked = (history ()).link binding
        if not (ok checked) then Task.FromResult(failed ("binding rejected: " + text checked "error"))
        else append (event "link" [ "binding" ==> binding ])

    member _.complete(request: obj) =
        task {
            let work: obj = request?work
            if not (sameHandle request?handle work?handle) || text request "child" <> text work "child" then return failed "completion belongs to another child work"
            else
                let prior = (history ()).work work
                if isNull prior then return failed "completion work was never canonically admitted"
                elif text prior "logicalRun" <> text request "logicalRun" then return failed "completion logical run mismatch"
                elif text prior "phase" = "Retired" && isNull prior?lastCompletion then return failed "voided work cannot produce a completion"
                elif text prior "phase" <> "Active" then return success null
                else
                    let body: obj = request?body
                    let decoded = if isNull body then null else codec.decode (unbox body)
                    if isNull decoded || text decoded "kind" <> "current" || not (codec.belongsToWork(workIdentity work, decoded?payload)) then return failed "completion body is not an exact work terminal"
                    else
                        let! written = call1<Task<obj>> effects?writeBlob body
                        if not (ok written) then return written
                        else
                            let receipt: obj = written?value
                            return! append (event "completeWork" [ "work" ==> work; "completion" ==> createObj [ "kind" ==> request?kind; "reference" ==> receipt?reference; "digest" ==> receipt?digest ] ])
        }

    member _.consume(record: obj) =
        let work: obj = record?work
        if isNull work && text record "phase" = "Abandoned" && text record "reason" = "Voided" then consumeHistorical record
        elif isNull work then Task.FromResult(failed "unscoped historical completion is audit-only; explicit settlement evidence is required")
        elif (history ()).isLegacy work?handle then Task.FromResult(failed "ambiguous unscoped work history is quarantined")
        else consumeScoped record

    member _.abandon(work: obj, reason: string) =
        let current = history ()
        let prior = current.work work
        if current.isLegacy work?handle then Task.FromResult(failed "ambiguous unscoped work history is quarantined")
        elif isNull prior then Task.FromResult(failed "work was never admitted")
        else
            match text prior "phase" with
            | "Abandoned" -> Task.FromResult(success null)
            | "Active" -> append (event "abandonWork" [ "work" ==> work; "reason" ==> reason ])
            | "Retired" -> Task.FromResult(failed "retired work cannot be abandoned")
            | _ -> Task.FromResult(failed "completed work cannot be abandoned")

    member _.abandonActive(handle: obj, reason: string) =
        let active = (history ()).workBindings() |> Array.tryFind (fun record -> text record "phase" = "Active" && sameHandle record?handle handle)
        match active with
        | Some record -> append (event "abandonWork" [ "work" ==> record?work; "reason" ==> reason ])
        | None -> Task.FromResult(failed "unscoped historical work cannot authorize a new abandonment")

    member this.cancel(handles: obj array, reason: string) =
        let rec loop remaining = task {
            match remaining with
            | [] -> return success null
            | handle :: rest ->
                let active = (history ()).workBindings() |> Array.tryFind (fun record -> text record "phase" = "Active" && sameHandle record?handle handle)
                match active with
                | None -> return failed "legacy active work requires explicit settlement evidence"
                | Some record ->
                    let! result = this.abandon(record?work, reason)
                    if ok result then return! loop rest else return result
        }
        loop (Array.toList handles)

    member _.reconcileFalseAborts() =
        let rec loop remaining = task {
            match remaining with
            | [] -> return success null
            | record :: rest ->
                let phase = text record "phase"
                let cell = if phase = "CompletedAwaitingJoin" then completion record elif phase = "Retired" then record?lastCompletion else null
                if unbox<int> record?handle?kind <> 0 || isNull cell || isNull cell?reference || isNull cell?digest then return! loop rest
                else
                    let! read = read cell?reference
                    if not (ok read) || sha read?value <> text cell "digest" then return! loop rest
                    else
                        let decoded = codec.decode (text read "value")
                        if text decoded "kind" <> "legacy-false-abort" then return! loop rest
                        elif phase = "Retired" then return failure "NotFound" "legacy false-abort tombstone on retired handle; archive or remove the affected journal"
                        else
                            let! _ = rejectFalse record cell
                            return! loop rest
        }
        loop ((history ()).summaries() |> Array.toList)

    member this.drain(maxCount: int, accept: obj -> bool) =
        let currentCandidates () = (history ()).filterBindings(accept) |> candidates
        let consumeOne (record: obj) = task {
            if unbox<int> record?handle?kind <> 0 then return success null
            elif text record "phase" = "Abandoned" then
                let! result = this.consume record
                return afterConsume result (createObj [ "record" ==> record; "abandoned" ==> record?reason; "runId" ==> ("abandoned-" + text record?handle "id") ])
            else
                let cell = completion record
                let reference = createObj [ "ref" ==> cell?reference; "digest" ==> cell?digest ]
                let readBlob value : JS.Promise<obj> = unbox (box (read (box value)))
                let! readResult = unbox<Task<obj>> (box (codec.read(reference, readBlob, fun body -> sha (box body))))
                if not (ok readResult) then return failure "NotFound" (text readResult "error")
                elif isNull readResult?value then
                    if text cell "kind" <> "Cancelled" then return failure "TerminalMaterializationFailed" (text record?handle "id")
                    else
                        let! result = this.consume record
                        return afterConsume result (createObj [ "record" ==> record; "abandoned" ==> "Cancelled"; "runId" ==> ("cancelled-" + text record?handle "id") ])
                else
                    let material: obj = readResult?value
                    let decoded = codec.decode (text material "body")
                    match text decoded "kind" with
                    | "legacy-false-abort" -> return! rejectFalse record cell
                    | "current" ->
                        if not (isNull record?work) && not (codec.belongsToWork(workIdentity record?work, decoded?payload)) then return failure "NotFound" "completion work identity mismatch"
                        else
                            let! result = this.consume record
                            return afterConsume result (createObj [ "record" ==> record; "payload" ==> codec.materialize(text record?handle "id", decoded?payload) ])
                    | _ -> return success null
        }
        let rec loop collected remaining records = task {
            match remaining, records with
            | 0, _ | _, [] -> return success (collected |> List.rev |> List.toArray)
            | _, record :: rest ->
                let! result = consumeOne record
                if not (ok result) then
                    if List.isEmpty collected then return result
                    else return success (collected |> List.rev |> List.toArray)
                elif not (isNull result?value) then return! loop (result?value :: collected) (remaining - 1) rest
                else
                    let refreshed = currentCandidates () |> Array.toList
                    let same: bool = emitJsExpr (refreshed |> List.toArray, records |> List.toArray) "JSON.stringify($0) === JSON.stringify($1)"
                    return! loop collected remaining (if same then rest else refreshed)
        }
        task {
            let! reconciled = this.reconcileFalseAborts()
            if not (ok reconciled) then return reconciled
            elif maxCount <= 0 then return success [||]
            else return! loop [] (min maxCount 32) (currentCandidates () |> Array.toList)
        }
