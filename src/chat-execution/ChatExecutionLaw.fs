module Wanxiangli.ChatExecution.ChatExecutionLaw

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBoolean (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'number' && Number.isSafeInteger($0)")>]
let private isInteger (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/chat-execution: malformed %s" what))

let private text (value: obj) = if isString value then unbox<string> value else ""

let private flag (what: string) (value: obj) : bool =
    if isBoolean value then unbox<bool> value else malformed what

type private Disposition =
    | Completed
    | Cancelled
    | Rejected
    | Failed

let private disposition (value: obj) =
    match text value with
    | "Completed" -> Completed
    | "Cancelled" -> Cancelled
    | "Rejected" -> Rejected
    | "Failed" -> Failed
    | _ -> malformed "disposition"

let private dispositionName =
    function
    | Completed -> "Completed"
    | Cancelled -> "Cancelled"
    | Rejected -> "Rejected"
    | Failed -> "Failed"

/// The four legal phases. The terminal phases carry their single-assigned
/// disposition; a pre-start terminal can never be Completed.
type private Phase =
    | Accepted
    | Started
    | EndedBeforeStart of Disposition
    | EndedAfterStart of Disposition

let private phaseOf (value: obj) : Phase option =
    if isAbsent value then
        None
    elif not (isObject value) then
        malformed "current"
    else
        match text (field value "phase") with
        | "Accepted" -> Some Accepted
        | "ProviderStarted" -> Some Started
        | "EndedBeforeStart" ->
            match disposition (field value "disposition") with
            | Completed -> malformed "current (a pre-start terminal cannot be Completed)"
            | d -> Some(EndedBeforeStart d)
        | "EndedAfterStart" -> Some(EndedAfterStart(disposition (field value "disposition")))
        | _ -> malformed "current.phase"

let private phaseValue (phase: Phase) : obj =
    match phase with
    | Accepted -> freeze (createObj [ "phase" ==> "Accepted" ])
    | Started -> freeze (createObj [ "phase" ==> "ProviderStarted" ])
    | EndedBeforeStart d -> freeze (createObj [ "phase" ==> "EndedBeforeStart"; "disposition" ==> dispositionName d ])
    | EndedAfterStart d -> freeze (createObj [ "phase" ==> "EndedAfterStart"; "disposition" ==> dispositionName d ])

let private set phase : obj =
    freeze (createObj [ "verdict" ==> "set"; "next" ==> phaseValue phase ])

let private keep () : obj = freeze (createObj [ "verdict" ==> "keep" ])

let private reject (reason: string) : obj =
    freeze (createObj [ "verdict" ==> "reject"; "reason" ==> reason ])

let private verdict (name: string) : obj = freeze (createObj [ "verdict" ==> name ])

let private verdictWith (name: string) (key: string) (value: obj) : obj =
    freeze (createObj [ "verdict" ==> name; key ==> value ])

let private establishedDisposition =
    function
    | EndedBeforeStart d
    | EndedAfterStart d -> Some d
    | Accepted
    | Started -> None

let private foldAccepted current sameAccepted =
    match current with
    | None -> set Accepted
    | Some _ when sameAccepted -> keep ()
    | Some _ -> reject "InvalidFact: Accepted conflicts with the execution's established evidence"

let private foldStarted current sameAccepted sameStarted =
    match current with
    | None -> reject "InvalidFact: ProviderStarted has no preceding Accepted fact"
    | Some(EndedBeforeStart _)
    | Some(EndedAfterStart _) -> reject "InvalidFact: ProviderStarted cannot follow a Terminal fact"
    | Some Accepted when sameAccepted -> set Started
    | Some Started when sameStarted -> keep ()
    | Some Accepted
    | Some Started ->
        reject "InvalidFact: ProviderStarted evidence does not match Accepted evidence or established provider run"

let private foldTerminal current afterStart sameAccepted sameStarted disposition =
    match current, afterStart with
    | None, _ -> reject "InvalidFact: Terminal has no preceding Accepted fact"
    | Some Accepted, false when sameAccepted && disposition <> Completed -> set (EndedBeforeStart disposition)
    | Some Accepted, false -> reject "InvalidFact: Pre-provider Terminal evidence mismatches Accepted or attempts Completed"
    | Some Accepted, true -> reject "InvalidFact: After-provider Terminal has no preceding ProviderStarted fact"
    | Some Started, true when sameStarted -> set (EndedAfterStart disposition)
    | Some Started, true -> reject "InvalidFact: Terminal evidence does not match ProviderStarted evidence"
    | Some Started, false -> reject "InvalidFact: Pre-provider Terminal cannot follow ProviderStarted"
    | Some(EndedBeforeStart established), false when sameAccepted && established = disposition -> keep ()
    | Some(EndedAfterStart established), true when sameStarted && established = disposition -> keep ()
    | Some(EndedBeforeStart _), _
    | Some(EndedAfterStart _), _ ->
        reject "InvalidFact: Terminal conflicts with the execution's established evidence or disposition"

let private decision (name: string) (extra: (string * obj) list) : obj =
    freeze (createObj ([ "decision" ==> name ] @ extra))

let private ignore' (reason: string) = decision "ignore" [ "reason" ==> reason ]
let private manual (reason: string) = decision "manual" [ "reason" ==> reason ]

let private flagOf (input: obj) (name: string) = flag ("recovery." + name) (field input name)

/// Restart recovery of one exact execution (crash-reconciliation): which single
/// next step the durable phase, the physical provider/resource observations,
/// the persistence commitment and the failure-policy resolution authorize.
let private recover (input: obj) : obj =
    if not (isObject input) then malformed "recovery"
    let phase =
        match phaseOf (field input "current") with
        | Some p -> p
        | None -> malformed "recovery.current"
    let provider = text (field input "provider")
    let resource = text (field input "resource")
    let persistence = text (field input "persistence")
    let stale =
        not (flagOf input "providerKeySame")
        || not (flagOf input "resourceKeySame")
        || not (flagOf input "providerAcceptedSame")
    let providerResolution () =
        let policy = field input "policy"
        if isAbsent policy then
            manual "NoAuthorizedProviderDisposition"
        elif not (isObject policy) then
            malformed "recovery.policy"
        else
            let matches = flag "recovery.policy.matches" (field policy "matches")
            match text (field policy "resolution") with
            | "RetryFreshAttempt" when matches -> ignore' "ProviderRecoveryOwned"
            | "TerminalizeProviderStarted" when matches -> decision "finalize" [ "from" ==> "policy" ]
            | "RetryFreshAttempt"
            | "TerminalizeProviderStarted" -> ignore' "StalePolicyEvidence"
            | "PreserveCurrentFact"
            | "AwaitAcceptanceReconciliation"
            | "TerminalizeAcceptedPreProvider" -> manual "NoAuthorizedProviderDisposition"
            | _ -> malformed "recovery.policy.resolution"
    let terminal () =
        match resource with
        | "Held" -> decision "releaseTerminalResource" []
        | "Absent"
        | "Released" -> ignore' "DurableTerminalAlreadySettled"
        | "Unknown" -> manual "PhysicalOutcomeUnknown"
        | _ -> malformed "recovery.resource"
    let accepted () =
        match provider with
        | "ReceiptMissing" -> manual "MissingExternalReceipt"
        | "ReceiptAmbiguous" -> manual "AmbiguousExternalReceipt"
        | "Absent" -> decision "resumePreProvider" []
        | "Alive" -> decision "persistProviderStarted" []
        | "Terminal" -> decision "persistProviderStartedAndTerminal" []
        | _ -> malformed "recovery.provider"
    let started () =
        let same () = flagOf input "providerSameAsStarted"
        match provider with
        | "ReceiptMissing" -> manual "MissingExternalReceipt"
        | "ReceiptAmbiguous" -> manual "AmbiguousExternalReceipt"
        | "Alive" when same () -> ignore' "ProviderStillAlive"
        | "Terminal" when same () -> decision "finalize" [ "from" ==> "observation" ]
        | "Absent" -> providerResolution ()
        | "Alive"
        | "Terminal" -> ignore' "StalePhysicalEvidence"
        | _ -> malformed "recovery.provider"
    match resource with
    | "Absent" | "Held" | "Released" | "Unknown" -> ()
    | _ -> malformed "recovery.resource"
    if stale then
        ignore' "StalePhysicalEvidence"
    else
        match phase with
        | EndedBeforeStart _
        | EndedAfterStart _ -> terminal ()
        | Accepted
        | Started ->
            match persistence with
            | "Unknown"
            | "NoNewWrite" -> manual "PersistenceOutcomeUnknown"
            | "Committed" -> ignore' "RecoveryAlreadyCommitted"
            | "NotCommitted" ->
                match phase with
                | Accepted -> accepted ()
                | _ -> started ()
            | _ -> malformed "recovery.persistence"

/// managed-chat-execution: the single-assignment law of one exact chat
/// execution (Accepted → ProviderStarted → Terminal). Pure: the caller keeps
/// the evidence and the durable projection, compares evidence by value and
/// hands this law only the current phase and the two equality facts.
[<AttachMembers>]
type ChatExecutionLaw() =
    member _.contractVersion: int = 1

    /// The only durable fact schema this law folds.
    member _.schemaVersion: int = 1

    /// null when the durable fact schema is folded by this law, otherwise the
    /// rejection reason. The schema is judged before any evidence is examined.
    member _.schemaRejection(schemaVersion: obj) : obj =
        if not (isInteger schemaVersion) then malformed "schemaVersion"
        elif unbox<int> schemaVersion = 1 then null
        else box (sprintf "UnsupportedSchema: expected 1, received %d" (unbox<int> schemaVersion))

    /// Fold one durable fact onto the current phase (null when the exact key
    /// has no execution yet). `set` replaces the phase, `keep` is an idempotent
    /// replay of the established fact, `reject` names why the fact is invalid.
    member _.fold(current: obj, fact: obj) : obj =
        if not (isObject fact) then malformed "fact"
        let phase = phaseOf current
        let schema = field fact "schemaVersion"
        if not (isInteger schema) then malformed "fact.schemaVersion"
        let kind = text (field fact "kind")
        let sameAccepted () = flag "fact.sameAccepted" (field fact "sameAccepted")
        let sameStarted () = flag "fact.sameStarted" (field fact "sameStarted")
        match kind with
        | "Accepted"
        | "ProviderStarted"
        | "Terminal" when unbox<int> schema <> 1 ->
            reject (sprintf "UnsupportedSchema: expected 1, received %d" (unbox<int> schema))
        | "Accepted" -> foldAccepted phase (sameAccepted ())
        | "ProviderStarted" -> foldStarted phase (sameAccepted ()) (sameStarted ())
        | "Terminal" ->
            let afterStart =
                match text (field fact "evidence") with
                | "PreProvider" -> false
                | "AfterProviderStart" -> true
                | _ -> malformed "fact.evidence"
            foldTerminal phase afterStart (sameAccepted ()) (sameStarted ()) (disposition (field fact "disposition"))
        | _ -> malformed "fact.kind"

    /// Provider start on an execution whose accepted evidence the caller has
    /// already matched: append the first start, return the established start on
    /// an exact replay, never start after a terminal or under another run.
    member _.decideStart(current: obj, sameStarted: obj) : obj =
        let same = flag "sameStarted" sameStarted
        match phaseOf current with
        | None -> malformed "current (provider start needs an accepted execution)"
        | Some Accepted -> verdict "append"
        | Some Started when same -> verdict "existing"
        | Some Started -> verdict "providerRunConflict"
        | Some(EndedBeforeStart d)
        | Some(EndedAfterStart d) -> verdictWith "startedAfterTerminal" "established" (dispositionName d)

    /// After-provider terminal on an execution whose accepted evidence the
    /// caller has already matched. Exactly one terminal disposition is ever
    /// assigned; an exact replay returns the established terminal.
    member _.decideTerminal(current: obj, sameStarted: obj, attempted: obj) : obj =
        let same = flag "sameStarted" sameStarted
        let attempted = disposition attempted
        match phaseOf current with
        | None -> malformed "current (a terminal needs an accepted execution)"
        | Some Accepted -> verdict "providerNotStarted"
        | Some Started when same -> verdict "append"
        | Some Started -> verdict "providerRunConflict"
        | Some(EndedBeforeStart _) -> verdict "projectionConflict"
        | Some(EndedAfterStart _) when not same -> verdict "providerRunConflict"
        | Some(EndedAfterStart d) when d = attempted -> verdict "existing"
        | Some(EndedAfterStart d) -> verdictWith "terminalConflict" "established" (dispositionName d)

    /// Settle an execution that never reached its provider. Completed is not a
    /// pre-start outcome; a started execution is not settled here; a terminal is
    /// single-assigned and an exact replay is idempotent.
    member _.settlePreProvider(current: obj, sameAccepted: obj, attempted: obj) : obj =
        let attempted = disposition attempted
        let phase = phaseOf current
        if attempted = Completed then
            verdict "invalidDisposition"
        else
            match phase with
            | None -> verdict "missingAccepted"
            | Some _ when not (flag "sameAccepted" sameAccepted) -> verdict "evidenceConflict"
            | Some Accepted -> verdict "append"
            | Some Started -> verdict "providerAlreadyStarted"
            | Some(EndedBeforeStart d) when d = attempted -> verdict "existing"
            | Some p ->
                verdictWith "terminalConflict" "established" (dispositionName (Option.get (establishedDisposition p)))

    /// Restart recovery of one exact execution: the single next step the durable
    /// phase, the physical observations, the persistence commitment and the
    /// failure-policy resolution authorize. Unknown physical or persistence
    /// outcomes are never settled by guess: they go to manual intervention.
    member _.recover(input: obj) : obj = recover input
