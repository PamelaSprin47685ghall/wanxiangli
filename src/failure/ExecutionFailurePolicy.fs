module Wanxiangli.Failure.ExecutionFailurePolicy

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/failure: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value && (unbox<string> value).Trim() <> "" then unbox<string> value else malformed what

type private Commitment =
    | NotCommitted
    | Committed
    | Unknown
    | NoNewWrite

type private Failure =
    | LocalInvariant
    | ProtocolRejection
    | AuthorizationDenied
    | UserCancelled
    | Superseded
    | CapacityQueueFull
    | ProviderTransient
    | ProviderPermanent
    | AcceptanceUnknown
    | StreamInterruptedAfterFirstToken
    | PersistenceFailure of Commitment

type private Phase =
    | NoAcceptedFact
    | AcceptedBeforeProvider
    | ProviderStarted
    | Terminal

let private commitmentOf (value: obj) =
    match text "failure.commitment" value with
    | "NotCommitted" -> NotCommitted
    | "Committed" -> Committed
    | "Unknown" -> Unknown
    | "NoNewWrite" -> NoNewWrite
    | _ -> malformed "failure.commitment"

let private failureOf (value: obj) =
    let label =
        if isString value then text "failure" value
        elif isObject value then text "failure.kind" (field value "kind")
        else malformed "failure"

    match label with
    | "LocalInvariant" -> LocalInvariant
    | "ProtocolRejection" -> ProtocolRejection
    | "AuthorizationDenied" -> AuthorizationDenied
    | "UserCancelled" -> UserCancelled
    | "Superseded" -> Superseded
    | "CapacityQueueFull" -> CapacityQueueFull
    | "ProviderTransient" -> ProviderTransient
    | "ProviderPermanent" -> ProviderPermanent
    | "AcceptanceUnknown" -> AcceptanceUnknown
    | "StreamInterruptedAfterFirstToken" -> StreamInterruptedAfterFirstToken
    | "PersistenceFailure" when isObject value -> PersistenceFailure(commitmentOf (field value "commitment"))
    | _ -> malformed "failure"

let private phaseOf (value: obj) =
    match text "phase" value with
    | "NoAcceptedFact" -> NoAcceptedFact
    | "AcceptedBeforeProvider" -> AcceptedBeforeProvider
    | "ProviderStarted" -> ProviderStarted
    | "Terminal" -> Terminal
    | _ -> malformed "phase"

type private Provider =
    { LogicalRun: string
      ProviderRun: string
      RequestKind: string
      BudgetAvailable: bool
      BreakerClosed: bool }

let private providerOf (value: obj) : Provider option =
    if isAbsent value then
        None
    elif not (isObject value) then
        malformed "provider"
    else
        let requestKind =
            match text "provider.requestKind" (field value "requestKind") with
            | "WorkMain"
            | "InteractionRepair" as kind -> kind
            | _ -> malformed "provider.requestKind"

        let budget =
            match text "provider.retryBudget" (field value "retryBudget") with
            | "Available" -> true
            | "Exhausted" -> false
            | _ -> malformed "provider.retryBudget"

        let breaker =
            match text "provider.breaker" (field value "breaker") with
            | "Closed" -> true
            | "Open" -> false
            | _ -> malformed "provider.breaker"

        Some
            { LogicalRun = text "provider.logicalRun" (field value "logicalRun")
              ProviderRun = text "provider.providerRun" (field value "providerRun")
              RequestKind = requestKind
              BudgetAvailable = budget
              BreakerClosed = breaker }

/// Length-prefixed, so no two distinct (logical run, provider run, request kind)
/// triples share a decision id.
let private decisionId (p: Provider) =
    [ p.LogicalRun; p.ProviderRun; p.RequestKind ]
    |> List.map (fun value -> sprintf "%d:%s" value.Length value)
    |> String.concat "|"

let private authorization (p: Provider) : obj =
    freeze (
        createObj
            [ "decisionId" ==> decisionId p
              "logicalRun" ==> p.LogicalRun
              "providerRun" ==> p.ProviderRun
              "requestKind" ==> p.RequestKind ]
    )

/// (resolution, terminal disposition, carries the execution key, authorization)
type private Resolution = string * string option * bool * obj

let private preserve: Resolution = "PreserveCurrentFact", None, false, null

let private terminal (disposition: string) (phase: Phase) : Resolution =
    match phase with
    | NoAcceptedFact
    | Terminal -> preserve
    | AcceptedBeforeProvider -> "TerminalizeAcceptedPreProvider", Some disposition, true, null
    | ProviderStarted -> "TerminalizeProviderStarted", Some disposition, true, null

let private providerResolution (phase: Phase) (provider: Provider option) : Resolution =
    match phase with
    | ProviderStarted ->
        match provider with
        | None -> malformed "provider (a started provider failure needs its recovery facts)"
        | Some p when p.BreakerClosed && p.BudgetAvailable -> "RetryFreshAttempt", None, false, authorization p
        | Some _ -> terminal "Failed" ProviderStarted
    | _ -> terminal "Failed" phase

let private resolve (failure: Failure) (phase: Phase) (provider: Provider option) : Resolution =
    match failure with
    | LocalInvariant
    | CapacityQueueFull
    | StreamInterruptedAfterFirstToken -> terminal "Failed" phase
    | ProtocolRejection
    | AuthorizationDenied -> terminal "Rejected" phase
    | UserCancelled
    | Superseded -> terminal "Cancelled" phase
    | ProviderTransient
    | ProviderPermanent -> providerResolution phase provider
    | AcceptanceUnknown
    | PersistenceFailure Unknown -> "AwaitAcceptanceReconciliation", None, true, null
    | PersistenceFailure NotCommitted
    | PersistenceFailure Committed
    | PersistenceFailure NoNewWrite -> preserve

let private breaker =
    function
    | ProviderTransient -> "RecordProviderTransientFailure"
    | ProviderPermanent -> "RecordProviderPermanentFailure"
    | _ -> "NoBreakerTransition"

/// Unknown or uncommitted outcomes keep the exact fence; everything else
/// releases it, except that nothing accepted means nothing to release.
let private capacity (failure: Failure) (phase: Phase) (owned: bool) =
    if not owned then
        "NoCapacitySettlement"
    else
        match failure with
        | AcceptanceUnknown
        | PersistenceFailure NotCommitted
        | PersistenceFailure Unknown
        | PersistenceFailure NoNewWrite -> "RetainExactFence"
        | _ when phase = NoAcceptedFact -> "NoCapacitySettlement"
        | _ -> "ReleaseExactFence"

let private fatality =
    function
    | LocalInvariant
    | PersistenceFailure Committed
    | PersistenceFailure Unknown
    | PersistenceFailure NoNewWrite -> "FatalAfterSettlement"
    | _ -> "NoFatality"

let private decide (input: obj) : obj =
    if not (isObject input) then malformed "input"
    let failure = failureOf (field input "failure")
    let phase = phaseOf (field input "phase")
    let key = field input "executionKey"
    if isAbsent key then malformed "executionKey"
    let fence = field input "capacityFence"
    let owned = not (isAbsent fence)
    let provider = providerOf (field input "provider")
    let resolution, disposition, carriesKey, auth = resolve failure phase provider
    let settlement = capacity failure phase owned

    freeze (
        createObj
            [ "resolution" ==> resolution
              "executionKey" ==> (if carriesKey then key else null)
              "terminalDisposition" ==> (match disposition with Some d -> box d | None -> null)
              "authorization" ==> auth
              "breaker" ==> breaker failure
              "capacitySettlement" ==> settlement
              "capacityFence" ==> (if settlement = "NoCapacitySettlement" then null else fence)
              "fatality" ==> fatality failure ]
    )

/// The single decision of one exact execution failure (vibe-fs CUT-14 ①):
/// given the classified failure, the durable lifecycle phase, the exact fence it
/// owns and the provider recovery facts, which resolution is allowed next, which
/// breaker transition is recorded, what happens to the exact fence and whether
/// the process must stop after settlement. Pure; the caller executes and confirms.
[<AttachMembers>]
type ExecutionFailurePolicy() =
    member _.contractVersion: int = 1
    member _.decide(input: obj) : obj = decide input
