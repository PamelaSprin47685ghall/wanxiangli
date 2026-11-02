module Wanxiangli.Change.ChangePublication

open System
open Fable.Core
open Fable.Core.JsInterop

let private text (value: obj) name : string = value?(name)
let private result kind fields = createObj ([ "kind" ==> kind ] @ fields)

[<AttachMembers>]
type ChangePublication() =
    member _.resume(record: obj) =
        if not (isNull record) && not (isNull record?terminal) then "CleanUp"
        elif not (isNull record) && not (isNull record?claim) then "ReenterClaim"
        else "RunLoop"
    member _.reenterClaim(target: string, claimTarget: string, commit: string, expected: string, record: obj) =
        if target <> claimTarget then "TargetMismatch"
        elif isNull record then "MissingRecord"
        elif isNull record?rebased then "MissingRebased"
        elif text record?rebased "commit" = commit && text record?rebased "target" = expected then "VerifyHead"
        else "RunLoop"
    member _.admitCandidate(commit: string, target: string, rebased: obj) =
        if isNull rebased then "InitialRebaseRequired"
        elif text rebased "commit" = commit && text rebased "target" = target then "PublishCertified"
        else "TargetAdvanced"
    member _.certify(commit: string, target: string, rebased: obj) =
        if isNull rebased then "MissingRebased"
        elif text rebased "commit" <> commit then "CandidatePinMismatch"
        elif text rebased "target" <> target then "SnapshotPinMismatch"
        else "Certified"
    member _.checkPublication(id: string, target: string, claimedId: string, claimedTarget: string, expected: string, current: string) =
        if claimedId <> id then "JobMismatch"
        elif claimedTarget <> target then "TargetMismatch"
        elif current <> expected then "CasMismatch"
        else "Matched"
    member _.fastForward(merge: obj, candidate: string, targetMovedError: string) =
        if unbox<bool> merge?ok then
            if text merge "value" = candidate then result "Landed" [ "head" ==> merge?value ]
            else result "LandedMismatch" [ "head" ==> merge?value ]
        elif text merge "error" = targetMovedError then result "TargetMoved" []
        else result "Failed" [ "error" ==> merge?error ]
    member _.rebaseFailed(files: string array) = if files.Length = 0 then "NotAConflict" else "Conflict"
    member _.classifyRebased(current: string, expected: string) =
        if isNull current then "HeadUnreadable" elif current = expected then "PublishReady" else "NeedsRebase"
    member _.classifyClaim(current: string, candidate: string, expected: string) =
        if isNull current then "HeadUnreadable"
        elif current = candidate then "AlreadyFastForwarded"
        elif current = expected then "PublishReady"
        else "ClaimExpired"
    member _.reconcile(request: obj, observed: obj) =
        let reject kind fields = result "Reject" ([ "reason" ==> kind ] @ fields)
        let kind = text observed "kind"
        let sameOwner = text observed "id" = text request "id" && text observed "path" = text request "path"
        if kind = "None" then result "RequestThenCreate" []
        elif kind = "Created" && sameOwner then result "AdoptCreated" []
        elif kind = "Created" || kind = "Conflict" || not sameOwner then reject "DurableOwnershipConflict" []
        elif not (unbox<bool> observed?physical?ok) then reject "WorktreeQueryFailed" [ "error" ==> observed?physical?error ]
        else
            let entries: obj array = observed?physical?value
            let relevant = entries |> Array.filter (fun entry -> text entry "path" = text request "path" || text entry "identity" = text request "identity")
            if relevant.Length = 0 then result "CreateAfterProvenMissing" []
            elif relevant |> Array.forall (fun entry -> text entry "path" = text request "path" && text entry "identity" = text request "identity") then result "AdoptThenRecordCreated" []
            else reject "PhysicalIdentityPathConflict" []
