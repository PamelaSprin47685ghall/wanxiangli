module Wanxiangli.Change.ChangeJob

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

let private text (raw: obj) name : string = raw?(name)
let private ok (raw: obj) : bool = raw?ok
let private success value = createObj [ "ok" ==> true; "value" ==> value ]
[<Emit("$0()")>]
let private call0<'T> (_callback: obj) : 'T = jsNative
[<Emit("$0($1)")>]
let private call1<'T> (_callback: obj) (_arg: obj) : 'T = jsNative
[<Emit("$0($1,$2)")>]
let private call2<'T> (_callback: obj) (_a: obj) (_b: obj) : 'T = jsNative
[<Emit("$0($1,$2,$3,$4)")>]
let private call4<'T> (_callback: obj) (_a: obj) (_b: obj) (_c: obj) (_d: obj) : 'T = jsNative

type private Next =
    | Continue
    | Rebase of string * string
    | Done of obj

[<AttachMembers>]
type ChangeJob() =
    member _.run(job: obj, collaborators: obj) : Task<obj> =
        let id = text job "id"
        let target = text job "target"
        let path = text job "path"
        let git: obj = collaborators?git
        let relay: obj = collaborators?relay
        let verdict kind fields = createObj ([ "kind" ==> kind; "id" ==> id ] @ fields)
        let failed details = verdict "IntegrationFailed" [ "error" ==> details ]
        let failure details = createObj [ "ok" ==> false; "error" ==> failed details ]
        let current () : obj =
            let history: obj = call0 collaborators?history
            history?job(id)
        let append kind fields : Task<obj> =
            task {
                let! result = call1<Task<obj>> collaborators?append (createObj ([ "kind" ==> kind; "id" ==> id ] @ fields))
                return if ok result then success null else failure (text result "error")
            }
        let checked prefix (operation: Task<obj>) = task {
            let! result = operation
            return if ok result then result else failure (prefix + text result "error")
        }
        let readHead () = checked "Git head lookup failed: " (call1 git?readHead (box path))
        let targetHead () = checked "Git target head lookup failed: " (call1 git?targetHead (box target))
        let conflicts () = checked "Conflict-file lookup failed: " (call1 git?conflictedFiles (box path))
        let prepare () = checked "Candidate admission failed: " (call1 relay?prepareCandidate (box id))
        let continueLoop () = checked "Manager loop continuation failed: " (call1 relay?continueLoop (box id))
        let release () = task {
            do! call1<Task<unit>> relay?terminateResources (box id)
            return! call0<Task<obj>> job?release
        }
        let settle head = task {
            let! cleanup = release ()
            if ok cleanup then return verdict "Published" [ "head" ==> head ]
            else return verdict "PublishedPendingCleanup" [ "head" ==> head; "error" ==> cleanup?error ]
        }
        let recordConflict candidate targetHead (files: string array) =
            let digest: string = call1 collaborators?sha256 (box (String.Join("\n", files)))
            append "ConflictDetected" [ "commit" ==> candidate; "target" ==> targetHead; "files" ==> files; "digest" ==> digest ]
        let publishInside candidate expected = task {
            let! targetResult = targetHead ()
            if not (ok targetResult) then return Done targetResult?error
            elif text targetResult "value" <> expected then return Rebase(candidate, "")
            else
                let currentHead = text targetResult "value"
                let! head = readHead ()
                if not (ok head) then return Done head?error
                elif text head "value" <> candidate then return Done(failed (sprintf "Worktree HEAD %s does not match candidate commit %s" (text head "value") candidate))
                else
                    let! conflictResult = conflicts ()
                    if not (ok conflictResult) then return Done conflictResult?error
                    else
                        let files: string array = conflictResult?value
                        if files.Length <> 0 then return Done(failed (sprintf "Worktree has unmerged conflicts before publish: %A" (Array.toList files)))
                        else
                            let! claimed = append "PublishClaimed" [ "target" ==> target; "commit" ==> candidate; "expected" ==> expected ]
                            if not (ok claimed) then return Done claimed?error
                            else
                                let! merged = call4<Task<obj>> git?ffMerge (box path) (box target) (box currentHead) (box candidate)
                                if not (ok merged) then
                                    if text merged "error" = "target ref moved" then return Rebase(candidate, "")
                                    else return Done(failed ("FF merge failed: " + text merged "error"))
                                elif text merged "value" <> candidate then return Done(failed (sprintf "FF merge landed %s which does not match pinned candidate %s" (text merged "value") candidate))
                                else
                                    let landed = text merged "value"
                                    let! published = append "Published" [ "candidate" ==> candidate; "head" ==> landed ]
                                    if ok published then return Done(verdict "Landed" [ "head" ==> landed ])
                                    else return Done published?error
        }
        let underGate candidate expected = task {
            let! lease = call0<Task<obj>> collaborators?acquireGate
            let! outcome = task {
                try
                    let! result = publishInside candidate expected
                    return Choice1Of2 result
                with error -> return Choice2Of2 error
            }
            do! call0<Task<unit>> lease?release
            match outcome with
            | Choice1Of2 result -> return result
            | Choice2Of2 error when call1<bool> collaborators?isCancellation (box error) -> return raise error
            | Choice2Of2 error -> return Done(failed ("Publish window failed: " + error.Message))
        }
        let rec loop () : Task<obj> = task {
            let! signal = call1<Task<obj>> relay?awaitSignal (box id)
            if not (ok signal) then return failed ("Manager loop signal failed: " + text signal "error")
            else
                let value: obj = signal?value
                match text value "kind" with
                | "Continue" -> return! continueThenLoop ()
                | "Candidate" -> return! candidate ()
                | _ -> return failed (text value "reason")
        }
        and continueThenLoop () = task {
            let! continued = continueLoop ()
            if not (ok continued) then return continued?error
            else return! loop ()
        }
        and rebase candidate currentTarget = task {
            let! rebased = call2<Task<obj>> git?rebase (box path) (box target)
            if ok rebased then
                let! head = readHead ()
                if not (ok head) then return head?error
                else
                    let! recorded = append "RebasedCandidateReady" [ "commit" ==> head?value; "target" ==> currentTarget ]
                    if not (ok recorded) then return recorded?error
                    else return! continueThenLoop ()
            else
                let! conflictResult = conflicts ()
                if not (ok conflictResult) then return conflictResult?error
                else
                    let files: string array = conflictResult?value
                    if files.Length = 0 then return failed ("Rebase failed without conflicts: " + text rebased "error")
                    else
                        let! recorded = recordConflict candidate currentTarget files
                        if not (ok recorded) then return recorded?error
                        else return! continueThenLoop ()
        }
        and publish candidate expected = task {
            let record = current ()
            if isNull record then return failed "No record found for certified publish"
            elif isNull record?rebased then return failed "Missing RebasedCandidateReady evidence for certified publish"
            else
                let rebased: obj = record?rebased
                if text rebased "commit" <> candidate then return failed (sprintf "Candidate %s does not match rebased evidence pin %s" candidate (text rebased "commit"))
                elif text rebased "target" <> expected then return failed (sprintf "Target head %s does not match rebased evidence snapshot %s" expected (text rebased "target"))
                else
                    let! result = underGate candidate expected
                    match result with
                    | Done result when text result "kind" = "Landed" -> return! settle (text result "head")
                    | Done result -> return result
                    | Rebase _ ->
                        let! refreshed = targetHead ()
                        if not (ok refreshed) then return refreshed?error
                        else return! rebase candidate (text refreshed "value")
                    | Continue -> return! loop ()
        }
        and prepared candidate = task {
            let! targetResult = targetHead ()
            if not (ok targetResult) then return targetResult?error
            else
                let target = text targetResult "value"
                let record = current ()
                let rebased: obj = if isNull record then null else record?rebased
                if not (isNull rebased) && text rebased "commit" = candidate && text rebased "target" = target then return! publish candidate target
                else
                    let! recorded = append "CandidateReady" [ "commit" ==> candidate ]
                    if not (ok recorded) then return recorded?error
                    else return! rebase candidate target
        }
        and candidate () = task {
            let! result = prepare ()
            if ok result then return! prepared (text result "value")
            else
                let! conflictResult = conflicts ()
                if not (ok conflictResult) then return conflictResult?error
                else
                    let files: string array = conflictResult?value
                    if files.Length = 0 then
                        let! second = prepare ()
                        if not (ok second) then return second?error
                        else return! prepared (text second "value")
                    else
                        let! head = readHead ()
                        if not (ok head) then return head?error
                        else
                            let! targetResult = targetHead ()
                            if not (ok targetResult) then return targetResult?error
                            else
                                let! recorded = recordConflict (text head "value") (text targetResult "value") files
                                if not (ok recorded) then return recorded?error
                                else return! continueThenLoop ()
        }
        let reenter (claim: obj) = task {
            let record = current ()
            if text claim "target" <> target then return failed "Publish claim target mismatch; refusing publish recovery"
            elif isNull record then return failed "No record found for publish claim reentry"
            elif isNull record?rebased then return failed "Missing RebasedCandidateReady evidence for publish claim reentry"
            elif text record?rebased "commit" <> text claim "commit" || text record?rebased "target" <> text claim "expected" then return! loop ()
            else
                let candidate = text claim "commit"
                let! head = readHead ()
                if not (ok head) then return head?error
                elif text head "value" <> candidate then return failed (sprintf "Worktree HEAD %s does not match claimed rebased commit %s" (text head "value") candidate)
                else
                    let! observed = call1<Task<obj>> git?targetHead (box target)
                    if not (ok observed) then return failed "GetTargetHead failed; refusing publish recovery"
                    elif text observed "value" = candidate then
                        let! recorded = append "Published" [ "candidate" ==> candidate; "head" ==> observed?value ]
                        if not (ok recorded) then return recorded?error
                        else return! settle (text observed "value")
                    elif text observed "value" = text claim "expected" then
                        let! result = underGate candidate (text claim "expected")
                        match result with
                        | Done result when text result "kind" = "Landed" -> return! settle (text result "head")
                        | Done result -> return result
                        | _ -> return! loop ()
                    else return! loop ()
        }
        task {
            let record = current ()
            if not (isNull record) && not (isNull record?terminal) then
                let! result = release ()
                if ok result then return verdict "Empty" []
                else return failed ("Terminal job cleanup failed: " + text result "error")
            elif not (isNull record) && not (isNull record?claim) then return! reenter record?claim
            else return! loop ()
        }
