module Wanxiangli.FissionGroup.FissionGroupLaw

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("Number.isInteger($0)")>]
let private isInt (_value: obj) : bool = jsNative

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
    raise (System.ArgumentException(sprintf "wanxiangli/fission-group: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private flag (what: string) (value: obj) : bool =
    if isBool value then unbox<bool> value else malformed what

let private int' (what: string) (value: obj) : int =
    if isInt value then unbox<int> value else malformed what

let private ints (what: string) (value: obj) : int list =
    if not (isArrayValue value) then malformed what
    unbox<obj array> value |> Array.map (int' (what + "[]")) |> Array.toList

/// null | "same" | "different": what the group already holds in the cell the event writes.
type private Held =
    | Nothing
    | Same
    | Different

let private held (what: string) (value: obj) =
    if isAbsent value then
        Nothing
    else
        match text what value with
        | "same" -> Same
        | "different" -> Different
        | _ -> malformed what

let private set () = freeze (createObj [ "verdict" ==> "set" ])
let private keep () = freeze (createObj [ "verdict" ==> "keep" ])
let private reject (rejection: string) = freeze (createObj [ "verdict" ==> "reject"; "rejection" ==> rejection ])

/// INTRA-PARALLEL: a group may converge only when every lane has materialized its work
/// and every pre-Fission completion has been delivered to every lane.
let private ready (laneCount: int) (progress: obj) =
    if not (isObject progress) then malformed "progress"
    let worked = ints "progress.workedLanes" (field progress "workedLanes")
    let deliveries = field progress "deliveries"
    if not (isArrayValue deliveries) then malformed "progress.deliveries"
    let all = [ 0 .. laneCount - 1 ]

    List.length worked = laneCount
    && worked |> List.forall (fun lane -> lane >= 0 && lane < laneCount)
    && unbox<obj array> deliveries
       |> Array.forall (fun delivered -> List.sort (List.distinct (ints "progress.deliveries[]" delivered)) = all)

[<AttachMembers>]
type FissionGroupLaw() =

    /// Whether the group's convergence preconditions hold (see `ready`).
    member _.convergenceReady(input: obj) : bool =
        if not (isObject input) then malformed "input"
        ready (int' "laneCount" (field input "laneCount")) (field input "progress")

    /// One Fission fact against one group. `laneCount` is null when the group
    /// is unknown. The caller compares values (sessions, refs, digests, runs)
    /// and passes the comparison; the law decides set / keep / reject and the
    /// rejection order. A `set` on converged/failed also closes the owner's
    /// active group.
    member _.judge(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let event = text "event" (field input "event")

        if event = "admitted" then
            let existing = held "existing" (field input "existing")
            let laneCount = int' "laneCount" (field input "laneCount")
            let valid =
                laneCount >= 2
                && int' "sessionCount" (field input "sessionCount") = laneCount
                && int' "promptCount" (field input "promptCount") = laneCount

            match existing with
            | Same -> keep ()
            | Different -> reject "ConflictingGroup"
            | Nothing when not valid -> reject "ConflictingGroup"
            | Nothing when flag "ownerActive" (field input "ownerActive") -> reject "DuplicateOwnerActive"
            | Nothing -> set ()
        else
            let laneCountValue = field input "laneCount"

            if isAbsent laneCountValue then
                reject "UnknownGroup"
            else
                let laneCount = int' "laneCount" laneCountValue
                let outOfRange () =
                    let lane = int' "laneIndex" (field input "laneIndex")
                    lane < 0 || lane >= laneCount

                let laneSession () = text "laneSession" (field input "laneSession")

                match event with
                | "laneMaterialized" ->
                    if outOfRange () then
                        reject "InvalidLane"
                    else
                        match laneSession () with
                        | "match" ->
                            match held "work" (field input "work") with
                            | Same -> keep ()
                            | Different -> reject "ConflictingLaneWork"
                            | Nothing -> set ()
                        | "mismatch"
                        | "absent" -> reject "LaneSessionMismatch"
                        | _ -> malformed "laneSession"
                | "completionCaptured" ->
                    if not (flag "preFission" (field input "preFission")) then
                        reject "ConflictingGroup"
                    else
                        match held "captured" (field input "captured") with
                        | Same -> keep ()
                        | Different -> reject "ConflictingGroup"
                        | Nothing -> set ()
                | "completionDelivered" ->
                    if outOfRange () then reject "InvalidLane"
                    elif not (flag "captured" (field input "captured")) then reject "ConflictingGroup"
                    else set ()
                | "externalAffinityBound" ->
                    if outOfRange () then
                        reject "InvalidLane"
                    else
                        match held "bound" (field input "bound") with
                        | Same -> keep ()
                        | Different -> reject "ConflictingGroup"
                        | Nothing -> set ()
                | "takeover" ->
                    if outOfRange () then reject "InvalidLane"
                    elif laneSession () <> "match" then reject "LaneSessionMismatch"
                    elif not (ready laneCount (field input "progress")) then reject "ConvergenceIncomplete"
                    else
                        match held "takeover" (field input "takeover") with
                        | Same -> keep ()
                        | Different -> reject "ConflictingTakeover"
                        | Nothing -> set ()
                | "converged" ->
                    match text "terminal" (field input "terminal") with
                    | "Converged" when flag "terminalSame" (field input "terminalSame") -> keep ()
                    | "Converged"
                    | "Failed" -> reject "TerminalAlreadySet"
                    | "Open" ->
                        if not (ready laneCount (field input "progress")) then
                            reject "ConvergenceIncomplete"
                        else
                            match field input "takeoverLane" with
                            | v when isAbsent v -> set ()
                            | v ->
                                match text "takeoverLane" v with
                                | "match" -> set ()
                                | "mismatch" -> reject "ConflictingTakeover"
                                | _ -> malformed "takeoverLane"
                    | _ -> malformed "terminal"
                | "failed" ->
                    match text "terminal" (field input "terminal") with
                    | "Failed" when flag "terminalSame" (field input "terminalSame") -> keep ()
                    | "Open" -> set ()
                    | "Converged"
                    | "Failed" -> reject "TerminalAlreadySet"
                    | _ -> malformed "terminal"
                | _ -> malformed "event"
