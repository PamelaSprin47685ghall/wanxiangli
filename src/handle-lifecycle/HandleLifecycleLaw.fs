module Wanxiangli.HandleLifecycle.HandleLifecycleLaw

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/handle-lifecycle: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private flag (what: string) (value: obj) : bool =
    if isBool value then unbox<bool> value else malformed what

type private Phase =
    | Active
    | CompletedAwaitingJoin
    | Abandoned
    | Retired

let private phaseName =
    function
    | Active -> "Active"
    | CompletedAwaitingJoin -> "CompletedAwaitingJoin"
    | Abandoned -> "Abandoned"
    | Retired -> "Retired"

/// The cell's current phase, or None when there is no cell.
let private phaseOf (value: obj) : Phase option =
    if isAbsent value then
        None
    else
        match text "phase" value with
        | "Active" -> Some Active
        | "CompletedAwaitingJoin" -> Some CompletedAwaitingJoin
        | "Abandoned" -> Some Abandoned
        | "Retired" -> Some Retired
        | _ -> malformed "phase"

type private Completion =
    { Kind: string
      HasRef: bool
      HasDigest: bool }

let private completionOf (what: string) (value: obj) : Completion =
    if not (isObject value) then
        malformed what
    else
        let kind = text (what + ".kind") (field value "kind")

        if kind <> "Terminal" && kind <> "SendFailure" && kind <> "Cancelled" then
            malformed (what + ".kind")

        { Kind = kind
          HasRef = flag (what + ".hasRef") (field value "hasRef")
          HasDigest = flag (what + ".hasDigest") (field value "hasDigest") }

let private set (phase: Phase) : obj =
    freeze (createObj [ "verdict" ==> "set"; "phase" ==> phaseName phase ])

let private keep () : obj = freeze (createObj [ "verdict" ==> "keep" ])

let private reject (rejection: string) : obj =
    freeze (createObj [ "verdict" ==> "reject"; "rejection" ==> rejection ])

/// EXEC-004 / EXEC-009: the single-winner lifecycle of one delegation handle and
/// of one admitted work under it. Pure: the caller holds the cells, answers the
/// lookups and the value equalities, and writes the phase a `set` verdict names
/// together with its own payload (completion, reason, consumption id).
[<AttachMembers>]
type HandleLifecycleLaw() =
    member _.contractVersion: int = 1

    /// One handle cell. `event` is complete | abandon | retire |
    /// rejectFalseCompletion; `phase` is the cell's phase (null: no such handle);
    /// rejectFalseCompletion also needs `cellMatches`: the cell's completion ref
    /// and digest are both present and equal the expected ones.
    member _.handle(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let event = text "event" (field input "event")
        let phase = phaseOf (field input "phase")

        match event with
        | "complete" ->
            match phase with
            | None -> reject "UnknownHandle"
            | Some Retired -> reject "HandleIsRetired"
            | Some Abandoned -> reject "AlreadyAbandoned"
            | Some CompletedAwaitingJoin -> reject "AlreadyCompleted"
            | Some Active -> set CompletedAwaitingJoin
        | "abandon" ->
            match phase with
            | None -> reject "UnknownHandle"
            | Some Retired -> reject "HandleIsRetired"
            | Some Abandoned -> reject "AlreadyAbandoned"
            | Some Active
            | Some CompletedAwaitingJoin -> set Abandoned
        | "retire" ->
            match phase with
            | None -> reject "UnknownHandle"
            | Some Retired -> reject "HandleIsRetired"
            | Some Active -> reject "NotCompleted"
            | Some CompletedAwaitingJoin
            | Some Abandoned -> set Retired
        | "rejectFalseCompletion" ->
            match phase with
            | None -> reject "UnknownHandle"
            | Some Retired -> reject "HandleIsRetired"
            | Some Abandoned -> reject "AlreadyAbandoned"
            | Some Active -> keep ()
            | Some CompletedAwaitingJoin ->
                if flag "cellMatches" (field input "cellMatches") then
                    set Active
                else
                    reject "AlreadyCompleted"
        | _ -> malformed "event"

    /// One admitted work cell. `event` is complete | abandon | void | consume;
    /// `phase` is the work's phase (null: not admitted); `legacy` says the handle
    /// still carries a pre-work completion. complete needs `completion`
    /// {kind, hasRef, hasDigest}; consume needs `consumptionId`, `expected`
    /// {kind, hasRef, hasDigest} and `cellEqualsExpected`.
    member _.work(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let event = text "event" (field input "event")
        let phase = phaseOf (field input "phase")
        let legacy = flag "legacy" (field input "legacy")

        if event <> "complete" && event <> "abandon" && event <> "void" && event <> "consume" then
            malformed "event"

        match phase with
        | None -> reject "WorkNotAdmitted"
        | Some _ when legacy -> reject "LegacyWorkAmbiguous"
        | Some phase ->
            match event with
            | "complete" ->
                let completion = completionOf "completion" (field input "completion")

                match phase with
                | Active when completion.Kind <> "Cancelled" && completion.HasRef && completion.HasDigest ->
                    set CompletedAwaitingJoin
                | Active -> reject "NotCompleted"
                | CompletedAwaitingJoin -> reject "AlreadyCompleted"
                | Abandoned -> reject "AlreadyAbandoned"
                | Retired -> reject "HandleIsRetired"
            | "abandon"
            | "void" ->
                match phase with
                | Active -> set (if event = "abandon" then Abandoned else Retired)
                | CompletedAwaitingJoin -> reject "AlreadyCompleted"
                | Abandoned -> reject "AlreadyAbandoned"
                | Retired -> reject "HandleIsRetired"
            | _ ->
                let consumptionId =
                    match field input "consumptionId" with
                    | v when isAbsent v -> ""
                    | v -> text "consumptionId" v
                let expected = completionOf "expected" (field input "expected")
                let cellEqualsExpected = flag "cellEqualsExpected" (field input "cellEqualsExpected")

                if System.String.IsNullOrWhiteSpace consumptionId then
                    reject "ConsumptionMismatch"
                else
                    match phase with
                    | CompletedAwaitingJoin when cellEqualsExpected -> set Retired
                    | Abandoned when expected.Kind = "Cancelled" && not expected.HasRef && not expected.HasDigest ->
                        set Retired
                    | CompletedAwaitingJoin -> reject "ConsumptionMismatch"
                    | Retired -> reject "HandleIsRetired"
                    | Active -> reject "NotCompleted"
                    | Abandoned -> reject "ConsumptionMismatch"
