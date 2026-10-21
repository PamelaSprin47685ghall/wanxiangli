module Wanxiangli.Integration.IntegrationLaw

open Fable.Core
open Fable.Core.JsInterop

/// Change integration law (CUT-23 ②): commission/manager worktree binding,
/// the publish gate's verdicts, conflict ownership and crash-recovery resume.
/// Pure: the caller runs Git, reads the journal and hands the facts in; this
/// module answers which step is allowed next. It never spawns, writes or waits.

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArrayValue (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/integration: malformed %s" what))

let private record (what: string) (value: obj) : obj =
    if isObject value then value else malformed what

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private flag (what: string) (value: obj) : bool =
    if isBool value then unbox<bool> value else malformed what

let private optionalText (what: string) (value: obj) : string option =
    if isAbsent value then None else Some(text what value)

let private texts (what: string) (value: obj) : string list =
    if isArrayValue value then
        unbox<obj array> value |> Array.map (text what) |> Array.toList
    else
        malformed what

let private result (pairs: (string * obj) list) : obj = freeze (createObj pairs)

/// A rebased candidate as recorded by RebasedCandidateReady.
type private Rebased =
    { Commit: string; TargetSnapshot: string }

let private rebasedOf (what: string) (value: obj) : Rebased option =
    if isAbsent value then
        None
    else
        let value = record what value

        Some
            { Commit = text (what + ".rebasedCommit") (field value "rebasedCommit")
              TargetSnapshot = text (what + ".targetHeadSnapshot") (field value "targetHeadSnapshot") }

[<AttachMembers>]
type IntegrationLaw() =
    member _.contractVersion: int = 1

    /// PERSIST-009 commission binding: decide worktree creation from the durable
    /// intent and, only when a Requested intent is ambiguous, one complete
    /// physical `worktree list` observation.
    member _.reconcileWorktree(input: obj) : obj =
        let input = record "input" input
        let jobId = text "jobId" (field input "jobId")
        let identity = text "identity" (field input "identity")
        let path = text "path" (field input "path")
        let evidence = record "evidence" (field input "evidence")
        let kind = text "evidence.kind" (field evidence "kind")

        let decide (decision: string) = result [ "decision" ==> decision ]

        let reject (reason: string) (extra: (string * obj) list) =
            result ([ "decision" ==> "Reject"; "reason" ==> reason ] @ extra)

        let sameOwner () =
            text "evidence.jobId" (field evidence "jobId") = jobId
            && text "evidence.path" (field evidence "path") = path

        let physical (entries: obj) =
            if not (isArrayValue entries) then
                malformed "evidence.entries"

            let relevant =
                unbox<obj array> entries
                |> Array.map (fun entry ->
                    let entry = record "evidence.entries[]" entry

                    text "evidence.entries[].path" (field entry "path"),
                    optionalText "evidence.entries[].identity" (field entry "identity"))
                |> Array.filter (fun (observedPath, observedIdentity) ->
                    observedPath = path || observedIdentity = Some identity)

            if relevant.Length = 0 then
                decide "CreateAfterProvenMissing"
            elif
                relevant
                |> Array.forall (fun (observedPath, observedIdentity) ->
                    observedPath = path && observedIdentity = Some identity)
            then
                decide "AdoptThenRecordCreated"
            else
                reject "PhysicalIdentityPathConflict" []

        match kind with
        | "NoDurableEffect" -> decide "RequestThenCreate"
        | "CreatedReceipt" when sameOwner () -> decide "AdoptCreated"
        | "CreatedReceipt"
        | "RequestedConflict" -> reject "DurableOwnershipConflict" []
        | "RequestedEntries"
        | "RequestedQueryFailure" when not (sameOwner ()) -> reject "DurableOwnershipConflict" []
        | "RequestedEntries" -> physical (field evidence "entries")
        | "RequestedQueryFailure" ->
            reject "WorktreeQueryFailed" [ "error" ==> text "evidence.error" (field evidence "error") ]
        | _ -> malformed "evidence.kind"

    /// ORCH-007: what a recorded rebased candidate means against the target head now.
    member _.rebasedCandidate(input: obj) : obj =
        let input = record "input" input
        let head = optionalText "head" (field input "head")
        text "rebasedCommit" (field input "rebasedCommit") |> ignore
        let snapshot = text "targetHeadSnapshot" (field input "targetHeadSnapshot")

        let reality =
            match head with
            | None -> "HeadUnreadable"
            | Some head when head = snapshot -> "PublishReady"
            | Some _ -> "NeedsRebase"

        result [ "reality" ==> reality ]

    /// ORCH-007: what a durable publish claim means against the target head now.
    /// Already-published is tested first, then unchanged target, then expired.
    member _.publishClaim(input: obj) : obj =
        let input = record "input" input
        let head = optionalText "head" (field input "head")
        let rebased = text "rebasedCommit" (field input "rebasedCommit")
        let expected = text "expectedHead" (field input "expectedHead")

        let reality =
            match head with
            | None -> "HeadUnreadable"
            | Some head when head = rebased -> "AlreadyFastForwarded"
            | Some head when head = expected -> "PublishReady"
            | Some _ -> "ClaimExpired"

        result [ "reality" ==> reality ]

    /// Crash-recovery entry: a terminal job is only cleaned up, a claimed one
    /// re-enters its claim, anything else resumes the manager loop.
    member _.resume(input: obj) : obj =
        let input = record "input" input
        let job = field input "record"

        let step =
            if isAbsent job then
                "RunLoop"
            else
                let job = record "record" job

                if flag "record.terminal" (field job "terminal") then "CleanUp"
                elif flag "record.claimed" (field job "claimed") then "ReenterClaim"
                else "RunLoop"

        result [ "step" ==> step ]

    /// Re-entering a durable publish claim after restart: the claim must target
    /// the job's own ref and still pin the latest rebased candidate exactly.
    member _.reenterClaim(input: obj) : obj =
        let input = record "input" input
        let jobTargetRef = text "jobTargetRef" (field input "jobTargetRef")
        let claim = record "claim" (field input "claim")
        let claimTarget = text "claim.targetRef" (field claim "targetRef")
        let claimRebased = text "claim.rebasedCommit" (field claim "rebasedCommit")
        let claimExpected = text "claim.expectedHead" (field claim "expectedHead")
        let job = field input "record"

        if claimTarget <> jobTargetRef then
            result [ "step" ==> "Refuse"; "reason" ==> "TargetMismatch" ]
        elif isAbsent job then
            result [ "step" ==> "Refuse"; "reason" ==> "MissingRecord" ]
        else
            match rebasedOf "record.rebased" (field (record "record" job) "rebased") with
            | None -> result [ "step" ==> "Refuse"; "reason" ==> "MissingRebased" ]
            | Some rebased when rebased.Commit = claimRebased && rebased.TargetSnapshot = claimExpected ->
                result [ "step" ==> "VerifyHead" ]
            | Some _ -> result [ "step" ==> "RunLoop" ]

    /// A prepared candidate is published only when the latest rebased record pins
    /// exactly this candidate on exactly this target head; otherwise it is rebased.
    member _.admitCandidate(input: obj) : obj =
        let input = record "input" input
        let candidate = text "candidate" (field input "candidate")
        let target = text "target" (field input "target")

        match rebasedOf "rebased" (field input "rebased") with
        | Some rebased when rebased.Commit = candidate && rebased.TargetSnapshot = target ->
            result [ "step" ==> "PublishCertified" ]
        | Some _ -> result [ "step" ==> "Rebase"; "reason" ==> "TargetAdvanced" ]
        | None -> result [ "step" ==> "Rebase"; "reason" ==> "InitialRebaseRequired" ]

    /// Certified publish evidence must match the rebased pin: candidate first, then snapshot.
    member _.certify(input: obj) : obj =
        let input = record "input" input
        let candidate = text "candidate" (field input "candidate")
        let expected = text "expectedHead" (field input "expectedHead")

        match rebasedOf "rebased" (field input "rebased") with
        | None -> result [ "ok" ==> false; "code" ==> "MissingRebased" ]
        | Some rebased when candidate <> rebased.Commit -> result [ "ok" ==> false; "code" ==> "CandidatePin" ]
        | Some rebased when expected <> rebased.TargetSnapshot -> result [ "ok" ==> false; "code" ==> "SnapshotPin" ]
        | Some _ -> result [ "ok" ==> true ]

    /// Conflict ownership: a failed rebase with unmerged files is this job's
    /// conflict, recorded against its own candidate and target; without
    /// conflicted files the failure is not a conflict and the job fails.
    member _.rebaseFailed(input: obj) : obj =
        let input = record "input" input

        match texts "conflictFiles" (field input "conflictFiles") with
        | [] -> result [ "step" ==> "Fail" ]
        | files -> result [ "step" ==> "RecordConflict"; "files" ==> freeze (box (List.toArray files)) ]

    /// Integration Gate, inside the publish window: the evidence must belong to
    /// this job and target, and the target head must still be the CAS expectation.
    member _.checkPublication(input: obj) : obj =
        let input = record "input" input
        let jobId = text "jobId" (field input "jobId")
        let jobTargetRef = text "jobTargetRef" (field input "jobTargetRef")
        let evidence = record "evidence" (field input "evidence")
        let current = text "current" (field input "current")

        if text "evidence.jobId" (field evidence "jobId") <> jobId then
            result [ "ok" ==> false; "code" ==> "JobMismatch" ]
        elif text "evidence.targetRef" (field evidence "targetRef") <> jobTargetRef then
            result [ "ok" ==> false; "code" ==> "TargetMismatch" ]
        elif current <> text "evidence.expectedHead" (field evidence "expectedHead") then
            result [ "ok" ==> false; "code" ==> "CasMismatch" ]
        else
            result [ "ok" ==> true ]

    /// The fast-forward's outcome: only the pinned candidate counts as landed;
    /// the declared target-moved error is a retryable miss, never a failure.
    member _.ffMerge(input: obj) : obj =
        let input = record "input" input
        let merge = record "merge" (field input "merge")
        let candidate = text "candidate" (field input "candidate")
        let movedError = text "targetMovedError" (field input "targetMovedError")

        if flag "merge.ok" (field merge "ok") then
            let landed = text "merge.landed" (field merge "landed")

            if landed = candidate then
                result [ "outcome" ==> "Landed"; "landed" ==> landed ]
            else
                result [ "outcome" ==> "LandedMismatch"; "landed" ==> landed ]
        else
            let error = text "merge.error" (field merge "error")

            if error = movedError then
                result [ "outcome" ==> "TargetMoved" ]
            else
                result [ "outcome" ==> "Failed"; "error" ==> error ]
