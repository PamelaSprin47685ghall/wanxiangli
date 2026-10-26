module Wanxiangli.PairHint.PairGuidanceMemoryStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Import("createHash", "node:crypto")>]
let private createHash (alg: string) : obj = jsNative

[<Emit("$0.update($1, 'utf8').digest('hex')")>]
let private hashHex (hash: obj) (text: string) : string = jsNative

let private sha256 (text: string) : string =
    hashHex (createHash "sha256") text

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("Array.isArray($0) ? Array.from($0) : []")>]
let private copyArray (x: obj) : obj array = jsNative

[<AttachMembers>]
type PairGuidanceMemoryEntry =
    { ordinal: int64
      callId: string
      markerText: string
      callGapKey: string
      resultGapKey: string
      raw: obj }

let pairGuidanceSource = "pair-programming-auto-injected"
let pairGuidanceIdPrefix = "pair-programming-auto-injected-"

let private normalizeKey (sessionKey: string) : string =
    if isNull sessionKey then "" else sessionKey

let private extractOrdinal (item: obj) : int64 =
    if isNull item then 0L
    elif not (isNull item?ordinal) then int64 (string item?ordinal)
    elif not (isNull item?Ordinal) then int64 (string item?Ordinal)
    else 0L

let private extractCallId (item: obj) : string =
    if isNull item then ""
    elif not (isNull item?callId) then string item?callId
    elif not (isNull item?CallId) then string item?CallId
    else ""

let private extractMarkerText (item: obj) : string =
    if isNull item then ""
    elif not (isNull item?markerText) then string item?markerText
    elif not (isNull item?MarkerText) then string item?MarkerText
    else ""

let private extractCallGapKey (item: obj) : string =
    if isNull item then ""
    elif not (isNull item?callGapKey) then string item?callGapKey
    elif not (isNull item?CallGapKey) then string item?CallGapKey
    elif not (isNull item?callGap) then string item?callGap
    elif not (isNull item?CallGap) then string item?CallGap
    else ""

let private extractResultGapKey (item: obj) : string =
    if isNull item then ""
    elif not (isNull item?resultGapKey) then string item?resultGapKey
    elif not (isNull item?ResultGapKey) then string item?ResultGapKey
    elif not (isNull item?resultGap) then string item?resultGap
    elif not (isNull item?ResultGap) then string item?ResultGap
    else ""

let private toObjArray (value: obj) : obj array =
    if isNull value then [||]
    elif isArray value then copyArray value
    elif emitJsExpr value "typeof $0[Symbol.iterator] === 'function'" then
        copyArray (emitJsExpr value "Array.from($0)")
    else [||]

let private toStringArray (value: obj) : string array =
    let arr = toObjArray value
    arr |> Array.map (fun x -> if isNull x then "" else string x)

[<AttachMembers>]
type PairGuidanceMemoryStore() =

    let entries = Dictionary<string, ResizeArray<obj>>()

    member _.source = pairGuidanceSource
    member _.idPrefix = pairGuidanceIdPrefix

    member _.read(sessionKey: string) : obj array =
        let key = normalizeKey sessionKey
        match entries.TryGetValue key with
        | true, list -> list.ToArray()
        | false, _ -> [||]

    member _.append(sessionKey: string, occurrence: obj) : unit =
        let key = normalizeKey sessionKey
        let list =
            match entries.TryGetValue key with
            | true, l -> l
            | false, _ ->
                let l = ResizeArray<obj>()
                entries.[key] <- l
                l
        let entry: PairGuidanceMemoryEntry =
            { ordinal = extractOrdinal occurrence
              callId = extractCallId occurrence
              markerText = extractMarkerText occurrence
              callGapKey = extractCallGapKey occurrence
              resultGapKey = extractResultGapKey occurrence
              raw = occurrence }
        list.Add(box entry)

    member _.clear(sessionKey: string) : unit =
        let key = normalizeKey sessionKey
        entries.Remove key |> ignore

    member _.clearAll() : unit =
        entries.Clear()

    member _.nextOrdinal(history: obj) : int64 =
        let items = toObjArray history
        if items.Length = 0 then 1L
        else
            let lastItem = items.[items.Length - 1]
            (extractOrdinal lastItem) + 1L

    member _.isOccupied(visible: obj, callGapKey: string, resultGapKey: string) : bool =
        let items = toObjArray visible
        let targetCall = if isNull callGapKey then "" else callGapKey
        let targetResult = if isNull resultGapKey then "" else resultGapKey
        items
        |> Array.exists (fun item ->
            let c = extractCallGapKey item
            let r = extractResultGapKey item
            c = targetCall && r = targetResult)

    member _.findOrphanedCallIds(history: obj, syntheticCallIds: obj) : string array =
        let histItems = toObjArray history
        let synItems = toStringArray syntheticCallIds
        let known = HashSet<string>()
        for item in histItems do
            let cid = extractCallId item
            if not (String.IsNullOrEmpty cid) then
                known.Add cid |> ignore
        synItems
        |> Array.filter (fun id -> not (String.IsNullOrEmpty id) && not (known.Contains id))

    member _.stableCallId(sessionId: string, ordinal: int64) : string =
        let key = normalizeKey sessionId
        let digest = sha256 (key + pairGuidanceSource + string ordinal)
        pairGuidanceIdPrefix + digest.Substring(0, 24)

let pairGuidanceMemoryStore = PairGuidanceMemoryStore()
