module Wanxiangli.Change.ChangeRuntime

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Change.ChangeJob
open Wanxiangli.Change.ChangePublication

let private text (raw: obj) name : string = raw?(name)
let private ok (raw: obj) : bool = raw?ok
let private success value = createObj [ "ok" ==> true; "value" ==> value ]
[<Emit("$0()")>]
let private call0<'T> (_callback: obj) : 'T = jsNative
[<Emit("$0($1)")>]
let private call1<'T> (_callback: obj) (_arg: obj) : 'T = jsNative
[<Emit("$0($1,$2)")>]
let private call2<'T> (_callback: obj) (_a: obj) (_b: obj) : 'T = jsNative
[<Emit("$0($1,$2,$3)")>]
let private call3<'T> (_callback: obj) (_a: obj) (_b: obj) (_c: obj) : 'T = jsNative

[<AttachMembers>]
type ChangeRuntime(effects: obj) =
    let publication = ChangePublication()
    let jobRunner = ChangeJob()
    let worktrees: obj = effects?worktrees
    let startPublication job =
        call0<unit> effects?startJob
        task {
            let! outcome = task {
                try return! jobRunner.run(job, effects?publication)
                with error ->
                    if call1<bool> effects?publication?isCancellation (box error) then return createObj [ "kind" ==> "Cancelled"; "id" ==> job?id ]
                    else return createObj [ "kind" ==> "IntegrationFailed"; "id" ==> job?id; "error" ==> call1<string> effects?formatError (box error) ]
            }
            call1<unit> effects?publish outcome
        } |> ignore
    let makeJob request resource =
        createObj [ "id" ==> request?id; "target" ==> request?target; "path" ==> resource?path; "release" ==> resource?release ]

    member _.recover(record: obj) =
        let resource: obj = call2 worktrees?adopt record?worktreeIdentity record?worktreePath
        startPublication (makeJob record resource)

    member _.start(request: obj) : Task<obj> =
        let id = text request "id"
        let fail prefix message = createObj [ "ok" ==> false; "error" ==> createObj [ "kind" ==> "IntegrationFailed"; "id" ==> id; "error" ==> (prefix + ": " + message) ] ]
        let append kind fields prefix = task {
            let! result = call1<Task<obj>> effects?publication?append (createObj ([ "kind" ==> kind; "id" ==> id ] @ fields))
            return if ok result then result else fail prefix (text result "error")
        }
        let eventFields = [ "identity" ==> request?identity; "path" ==> request?path ]
        let releaseOnError resource (operation: Task<obj>) = task {
            let! result = operation
            if not (ok result) then
                let! _ = call0<Task<obj>> resource?release
                return result
            else return result
        }
        let createSession resource = task {
            let! created = call1<Task<obj>> effects?createSession request
            if not (ok created) then return fail "Failed to create manager session" (text created "error")
            else
                let! recorded = append "ManagerJobCreated" [ "session" ==> created?value; "agent" ==> request?agent; "byname" ==> request?byname; "worktreeIdentity" ==> resource?identity; "worktreePath" ==> request?path; "target" ==> request?target; "targetBranchFrozen" ==> request?target ] "Failed to persist manager job"
                if not (ok recorded) then return recorded
                else return success (makeJob request resource)
        }
        let admission decision = task {
            let kind = text decision "kind"
            let! acquired =
                if kind = "RequestThenCreate" || kind = "CreateAfterProvenMissing" then task {
                    let! result = call3<Task<obj>> worktrees?create request?identity request?path request?target
                    return if ok result then result else fail "Failed to create worktree" (text result "error")
                }
                else Task.FromResult(success (call2<obj> worktrees?adopt request?identity request?path))
            if not (ok acquired) then return acquired
            else
                let resource: obj = acquired?value
                let confirmation =
                    if kind = "AdoptCreated" then Task.FromResult(success null)
                    else append "WorktreeCreated" [ "identity" ==> resource?identity; "path" ==> request?path ] "Failed to persist worktree created"
                let! recorded = releaseOnError resource confirmation
                if not (ok recorded) then return recorded
                else
                    if unbox<bool> effects?durable then call0<unit> resource?markDurable
                    if unbox<bool> effects?durable then return! createSession resource
                    else return! releaseOnError resource (createSession resource)
        }
        let admitUnderGate decision = task {
            let! gate = call0<Task<obj>> effects?publication?acquireGate
            let! outcome = task {
                try return! admission decision
                with error -> return fail "Manager admission failed" error.Message
            }
            do! call0<Task<unit>> gate?release
            if not (ok outcome) then return outcome
            else
                let! activated = call1<Task<obj>> effects?activate (box id)
                if not (ok activated) then return fail "Failed to activate manager" (text activated "error")
                else
                    startPublication outcome?value
                    return success (createObj [ "id" ==> id; "path" ==> request?path ])
        }
        task {
            let! dirty = call1<Task<obj>> effects?isDirty effects?repoPath
            if not (ok dirty) then return fail "Failed to inspect target cleanliness" (text dirty "error")
            else
                let paths: string array = dirty?value
                if paths.Length <> 0 then return createObj [ "ok" ==> false; "error" ==> createObj [ "kind" ==> "RejectedDirty"; "id" ==> id; "error" ==> ("Worktree is dirty: " + System.String.Join(", ", paths)) ] ]
                else
                    let history: obj = call0 effects?publication?history
                    let durable: obj = history?worktreeEffect(request?identity)
                    let! observed = task {
                        if isNull durable then return createObj [ "kind" ==> "None" ]
                        elif text durable "kind" = "Created" then return durable
                        elif text durable "id" <> id || text durable "path" <> text request "path" then return createObj [ "kind" ==> "Conflict"; "id" ==> durable?id; "path" ==> durable?path ]
                        else
                            let! physical = call0<Task<obj>> worktrees?list
                            return createObj [ "kind" ==> "Requested"; "id" ==> durable?id; "path" ==> durable?path; "physical" ==> physical ]
                    }
                    let decision = publication.reconcile(request, observed)
                    match text decision "kind" with
                    | "Reject" ->
                        let reason = match text decision "reason" with
                                     | "DurableOwnershipConflict" -> "Durable worktree intent conflicts with the requested job or path"
                                     | "WorktreeQueryFailed" -> "Failed to query requested worktree ambiguity: " + text decision "error"
                                     | _ -> "Physical worktree identity/path evidence conflicts with the durable request"
                        return fail "Worktree reconciliation rejected" reason
                    | "RequestThenCreate" ->
                        let! recorded = append "WorktreeCreateRequested" eventFields "Failed to persist worktree request"
                        if not (ok recorded) then return recorded
                        else return! admitUnderGate decision
                    | _ -> return! admitUnderGate decision
        }
