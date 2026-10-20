module Wanxiangli.Association.SessionAssociationLaw

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
    raise (System.ArgumentException(sprintf "wanxiangli/association: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private optionalText (what: string) (value: obj) : string option =
    if isAbsent value then None else Some(text what value)

/// One durable association entry as the caller holds it.
type private Entry =
    | Work of parent: string option
    | Satellite of owner: string * kind: string

let private entryOf (what: string) (value: obj) : Entry option =
    if isAbsent value then
        None
    elif not (isObject value) then
        malformed what
    else
        match field value "kind" with
        | k when isString k && unbox<string> k = "Work" ->
            Some(Work(optionalText (what + ".parent") (field value "parent")))
        | k when isString k && unbox<string> k = "Satellite" ->
            Some(
                Satellite(
                    text (what + ".owner") (field value "owner"),
                    text (what + ".satelliteKind") (field value "satelliteKind")
                )
            )
        | _ -> malformed (what + ".kind")

let private reject (rejection: string) (extra: (string * obj) list) : obj =
    freeze (createObj ([ "verdict" ==> "reject"; "rejection" ==> rejection ] @ extra))

/// managed-session-lifecycle / HOST-008 / COMPANION-002: the Work ↔ Satellite
/// link law. Pure: the caller owns the association map, answers the keyed
/// lookups and writes both entries of an accepted link together.
[<AttachMembers>]
type SessionAssociationLaw() =
    member _.contractVersion: int = 1

    /// Judge one link of `satellite` (of `satelliteKind`) to the Work session
    /// `main`. `mainEntry` / `satelliteEntry` are the current entries of the two
    /// sessions (null when absent); `existingSatellite` is the satellite of that
    /// kind main already has (null when none); `parentOfMain` is the parent the
    /// caller proposes for main. An accepted link names main's parent: the
    /// proposed one, else the one main already records.
    member _.link(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let main = text "main" (field input "main")
        let satellite = text "satellite" (field input "satellite")
        let kind = text "satelliteKind" (field input "satelliteKind")
        let mainEntry = entryOf "mainEntry" (field input "mainEntry")
        let satelliteEntry = entryOf "satelliteEntry" (field input "satelliteEntry")
        let existing = optionalText "existingSatellite" (field input "existingSatellite")
        let proposedParent = optionalText "parentOfMain" (field input "parentOfMain")

        if main = satellite then
            reject "SelfLink" [ "session" ==> main ]
        else
            match mainEntry with
            | Some(Satellite _) -> reject "CompanionWouldRecurse" [ "companion" ==> main ]
            | _ ->
                match existing, satelliteEntry with
                | Some other, _ when other <> satellite ->
                    reject "AlreadyLinkedToOther" [ "existing" ==> other; "proposed" ==> satellite ]
                | _, Some(Satellite(owner, _)) when owner <> main ->
                    reject "CompanionClaimedByOther" [ "owner" ==> owner; "proposed" ==> satellite ]
                | _, Some(Work _) -> reject "SatelliteKindConflict" [ "proposed" ==> satellite ]
                | _, Some(Satellite(_, existingKind)) when existingKind <> kind ->
                    reject "SatelliteKindConflict" [ "proposed" ==> satellite ]
                | _ ->
                    let parent =
                        match proposedParent, mainEntry with
                        | Some parent, _ -> Some parent
                        | None, Some(Work parent) -> parent
                        | None, _ -> None

                    freeze (
                        createObj
                            [ "verdict" ==> "link"
                              "mainParent" ==> (match parent with
                                                 | Some p -> box p
                                                 | None -> null) ]
                    )
