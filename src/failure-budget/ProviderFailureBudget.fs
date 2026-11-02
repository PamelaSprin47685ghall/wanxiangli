module Wanxiangli.FailureBudget.ProviderFailureBudget

open Fable.Core
open Fable.Core.JsInterop
open System.Threading.Tasks

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("Number.isSafeInteger($0)")>]
let private isSafeInteger (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Object.freeze(Array.from($0))")>]
let private frozenArray (_value: string[]) : obj = jsNative

[<Emit("Array.from($0)")>]
let private arrayOf (_value: obj) : obj[] = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/failure-budget: malformed %s" what))

/// Identities are opaque text: any string (the host never constrained their content), never a non-string.
let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private count (what: string) (value: obj) : int =
    if isSafeInteger value && unbox<int> value >= 0 then unbox<int> value else malformed what

let private flag (what: string) (value: obj) : bool =
    if isBool value then unbox<bool> value else malformed what

/// The consecutive failure limit of one Logical Run's automatic recovery.
[<Literal>]
let DefaultBudget = 10

/// How many exact attempt keys the projection remembers for deduplication.
[<Literal>]
let DedupeWindow = 32

type private State =
    { LogicalRun: string
      AuthorityRoot: string
      Failures: int
      Keys: string list
      Exhausted: bool
      LastWasSuccess: bool }

let private stateOf (value: obj) : State =
    if not (isObject value) then malformed "state"
    let keys = field value "recentFailureKeys"
    if not (isArray keys) then malformed "state.recentFailureKeys"

    { LogicalRun = text "state.logicalRun" (field value "logicalRun")
      AuthorityRoot = text "state.authorityRoot" (field value "authorityRoot")
      Failures = count "state.consecutiveFailureCount" (field value "consecutiveFailureCount")
      Keys = arrayOf keys |> Array.map (text "state.recentFailureKeys[]") |> List.ofArray
      Exhausted = flag "state.exhausted" (field value "exhausted")
      LastWasSuccess = flag "state.lastTransitionWasSuccess" (field value "lastTransitionWasSuccess") }

let private view (s: State) : obj =
    freeze (
        createObj
            [ "logicalRun" ==> s.LogicalRun
              "authorityRoot" ==> s.AuthorityRoot
              "consecutiveFailureCount" ==> s.Failures
              "recentFailureKeys" ==> frozenArray (Array.ofList s.Keys)
              "exhausted" ==> s.Exhausted
              "lastTransitionWasSuccess" ==> s.LastWasSuccess ]
    )

let private limitOf (value: obj) = count "budgetLimit" value

/// The exact attempt identity (session, logical run, authority root, provider run) joined by U+001F,
/// byte-for-byte the key the host's projection has always remembered.
let private dedupeKey (identity: obj) : string =
    if not (isObject identity) then malformed "identity"

    [ text "identity.sessionId" (field identity "sessionId")
      text "identity.logicalRun" (field identity "logicalRun")
      text "identity.authorityRoot" (field identity "authorityRoot")
      text "identity.providerRun" (field identity "providerRun") ]
    |> String.concat "\u001f"

let private forAuthority (logicalRun: obj) (authorityRoot: obj) : obj =
    view
        { LogicalRun = text "logicalRun" logicalRun
          AuthorityRoot = text "authorityRoot" authorityRoot
          Failures = 0
          Keys = []
          Exhausted = false
          LastWasSuccess = false }

let private rejected (reason: string) : obj =
    freeze (createObj [ "ok" ==> false; "rejection" ==> reason ])

/// One failure record advances the streak exactly once: an exhausted run takes nothing,
/// another run or authority root is not this budget, a remembered exact attempt is
/// already counted, and the recorded count must be the successor of the folded count.
let private applyFailure (identity: obj) (nextCount: obj) (current: obj) : obj =
    let s = stateOf current
    let key = dedupeKey identity
    let next = count "consecutiveFailureCount" nextCount

    if s.Exhausted then
        rejected "AlreadyExhausted"
    elif
        text "identity.logicalRun" (field identity "logicalRun") <> s.LogicalRun
        || text "identity.authorityRoot" (field identity "authorityRoot") <> s.AuthorityRoot
    then
        rejected "DifferentRun"
    elif List.contains key s.Keys then
        rejected "AlreadyObserved"
    elif next <> s.Failures + 1 then
        rejected "InvalidTransition"
    else
        let remembered = key :: (s.Keys |> List.filter ((<>) key)) |> List.truncate DedupeWindow

        freeze (
            createObj
                [ "ok" ==> true
                  "state" ==> view { s with Failures = next; Keys = remembered; LastWasSuccess = false } ]
        )

let private applyExhausted (current: obj) : obj =
    view { stateOf current with Exhausted = true }

/// Business-main success clears the streak and forgets the attempt keys.
let private recordSuccess (current: obj) : obj =
    view { stateOf current with Failures = 0; Keys = []; LastWasSuccess = true }

let private verdict (budgetLimit: obj) (failures: obj) : string =
    if count "consecutiveFailureCount" failures >= limitOf budgetLimit then "Exhausted" else "MayRetry"

let private mayRetry (budgetLimit: obj) (current: obj) : bool =
    let s = stateOf current
    let limit = limitOf budgetLimit
    not s.Exhausted && s.Failures < limit

/// A failure that was already counted is answered from the record, never counted again:
/// only the latest exact attempt may still be retried (if budget remains); an older one
/// belongs to a superseded episode.
let private replay (budgetLimit: obj) (identity: obj) (current: obj) : string =
    let s = stateOf current
    let key = dedupeKey identity

    match List.tryHead s.Keys with
    | Some latest when latest = key -> if mayRetry budgetLimit current then "RetryAuthorized" else "RetryExhausted"
    | _ -> "EpisodeSuperseded"

/// The single owner of one Logical Run's provider failure budget (vibe-fs CUT-14 ②):
/// exact attempt deduplication, single-step consecutive advance, exhaustion, success
/// reset and the answer to a replayed failure. Pure; the caller journals the facts.
[<AttachMembers>]
type ProviderFailureBudget() =
    member _.contractVersion: int = 1
    member _.defaultBudget: int = DefaultBudget
    member _.dedupeWindow: int = DedupeWindow
    member _.dedupeKey(identity: obj) : string = dedupeKey identity
    member _.forAuthority(logicalRun: obj, authorityRoot: obj) : obj = forAuthority logicalRun authorityRoot
    member _.applyFailure(identity: obj, consecutiveFailureCount: obj, current: obj) : obj =
        applyFailure identity consecutiveFailureCount current
    member _.applyExhausted(current: obj) : obj = applyExhausted current
    member _.recordSuccess(current: obj) : obj = recordSuccess current
    member _.verdict(budgetLimit: obj, consecutiveFailureCount: obj) : string = verdict budgetLimit consecutiveFailureCount
    member _.mayRetry(budgetLimit: obj, current: obj) : bool = mayRetry budgetLimit current
    member _.replay(budgetLimit: obj, identity: obj, current: obj) : string = replay budgetLimit identity current

[<AttachMembers>]
type DurableProviderBudget(port: obj) =
    let accepted value = createObj [ "ok" ==> true; "value" ==> value ]
    let refused error = createObj [ "ok" ==> false; "error" ==> error ]

    let event kind sessionId providerRun (current: obj) count reason =
        createObj
            [ "kind" ==> kind
              "sessionId" ==> sessionId
              "providerRun" ==> providerRun
              "logicalRun" ==> field current "logicalRun"
              "authorityRoot" ==> field current "authorityRoot"
              "count" ==> count
              "reason" ==> reason ]

    member _.recordAuthorizedFailure(sessionId: string, authorization: obj, reason: string) : Task<obj> =
        task {
            let current: obj = port?current sessionId
            if isNull current then
                return accepted "NoActiveRun"
            elif field current "logicalRun" <> field authorization "logicalRun" then
                return refused "Provider recovery licence belongs to a different logical run"
            else
                let providerRun: string = authorization?providerRun
                let identity =
                    createObj
                        [ "sessionId" ==> sessionId
                          "logicalRun" ==> field current "logicalRun"
                          "authorityRoot" ==> field current "authorityRoot"
                          "providerRun" ==> providerRun ]
                let nextCount = unbox<int> (field current "consecutiveFailureCount") + 1
                let advanced = applyFailure identity (box nextCount) current
                if not (unbox<bool> (field advanced "ok")) then
                    match unbox<string> (field advanced "rejection") with
                    | "AlreadyObserved" -> return accepted (replay (box DefaultBudget) identity current)
                    | "AlreadyExhausted" -> return accepted "RetryExhausted"
                    | "DifferentRun" -> return accepted "NoActiveRun"
                    | _ -> return refused "Provider failure advance violates validation (consecutive failure count is not the successor)"
                else
                    let! written: obj = port?append (event "FailureRecorded" sessionId providerRun current nextCount reason)
                    if not (unbox<bool> (field written "ok")) then
                        return written
                    elif verdict (box DefaultBudget) (box nextCount) = "MayRetry" then
                        return accepted "RetryAuthorized"
                    else
                        let! exhausted: obj = port?append (event "RetryExhausted" sessionId providerRun current nextCount reason)
                        return if unbox<bool> (field exhausted "ok") then accepted "RetryExhausted" else exhausted
        }

    member _.recordConfirmedSuccess(sessionId: string, providerRun: string) : Task<obj> =
        task {
            let current: obj = port?current sessionId
            if isNull current || unbox<int> (field current "consecutiveFailureCount") = 0 then
                return accepted "Recorded"
            else
                return! port?append (event "SuccessRecorded" sessionId providerRun current 0 "")
        }
