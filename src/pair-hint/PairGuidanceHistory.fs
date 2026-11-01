module Wanxiangli.PairHint.PairGuidanceHistory

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.PairHint.PairGuidanceMemoryStore

type private Entry =
    { Ordinal: int64
      CallId: string
      MarkerText: string
      PlacementKey: string
      Metadata: obj }

let private entryObject entry =
    createObj
        [ "ordinal" ==> entry.Ordinal
          "callId" ==> entry.CallId
          "markerText" ==> entry.MarkerText
          "placementKey" ==> entry.PlacementKey
          "metadata" ==> entry.Metadata ]

let private success (value: obj) = createObj [ "ok" ==> true; "value" ==> value ]
let private failure (error: obj) = createObj [ "ok" ==> false; "error" ==> error ]
let private field (value: obj) (key: string) : obj = value?(key)

[<AttachMembers>]
type PairGuidanceHistory(?snapshot: obj) =
    let entries, calls, placements, floor : Entry list * Set<string> * Set<string> * int64 =
        match snapshot with
        | None -> [], Set.empty, Set.empty, 1L
        | Some value -> unbox value

    member _.history() = entries |> List.rev |> List.map entryObject |> List.toArray
    member _.visible() = entries |> List.rev |> List.filter (fun entry -> entry.Ordinal >= floor) |> List.map entryObject |> List.toArray
    member _.callIds() = calls |> Set.toArray
    member _.placementCount() = placements.Count
    member _.visibleFromOrdinal() = floor

    member _.nextOrdinal() =
        match entries with
        | [] -> 1L
        | latest :: _ -> latest.Ordinal + 1L

    member this.reanchor() = PairGuidanceHistory(box (entries, calls, Set.empty<string>, this.nextOrdinal()))

    member _.restoreVisibilityFloor(value: int64) =
        let nextFloor = max 1L value
        let nextPlacements = entries |> List.filter (fun entry -> entry.Ordinal >= nextFloor) |> List.map (fun entry -> entry.PlacementKey) |> Set.ofList
        PairGuidanceHistory(box (entries, calls, nextPlacements, nextFloor))

    member this.append(input: obj) =
        let ordinal: int64 = input?ordinal
        let callId: string = input?callId
        let placement: string = input?placementKey
        let expected = this.nextOrdinal()

        if ordinal <> expected then
            failure (createObj [ "kind" ==> "NonSequentialOrdinal"; "expected" ==> expected; "actual" ==> ordinal ])
        elif calls.Contains callId then
            failure (createObj [ "kind" ==> "DuplicateCallId"; "callId" ==> callId ])
        elif placements.Contains placement then
            failure (createObj [ "kind" ==> "DuplicatePlacement" ])
        else
            let entry =
                { Ordinal = ordinal
                  CallId = callId
                  MarkerText = input?markerText
                  PlacementKey = placement
                  Metadata = field input "metadata" }

            PairGuidanceHistory(box (entry :: entries, calls.Add callId, placements.Add placement, floor)) |> box |> success

[<AttachMembers>]
type PairGuidanceOccurrences() =
    let memory = PairGuidanceMemoryStore()

    member _.occur(input: obj, render: Func<obj array, obj>, append: Func<obj, Task<obj>>) : Task<obj> =
        task {
            let history: obj array = input?history
            let visible: obj array = input?visible
            let synthetic: string array = input?syntheticCallIds
            let orphaned = memory.findOrphanedCallIds(box history, box synthetic)

            if orphaned.Length > 0 then
                return failure (createObj [ "kind" ==> "Orphaned"; "callIds" ==> orphaned ])
            else
                let placement: obj = input?placement

                if not (isNull placement) && not (unbox<bool> (field placement "ok")) then
                    return failure (createObj [ "kind" ==> "Placement"; "cause" ==> field placement "error" ])
                else
                    let location: obj = if isNull placement then null else placement?value
                    let occupied =
                        not (isNull location)
                        && memory.isOccupied(field input "occupied", location?callGapKey, location?resultGapKey)
                    let skip = not (isNull location) && not occupied && unbox<bool> (field input "skipNew")

                    if isNull location || occupied || skip then
                        let rendered = render.Invoke visible
                        if unbox<bool> (field rendered "ok") then
                            return success (createObj [ "wire" ==> field rendered "value"; "appended" ==> false ])
                        else
                            return failure (createObj [ "kind" ==> "Render"; "cause" ==> field rendered "error" ])
                    else
                        let ordinal = memory.nextOrdinal(box history)
                        let candidate =
                            createObj
                                [ "ordinal" ==> ordinal
                                  "callId" ==> memory.stableCallId(input?sessionKey, ordinal)
                                  "markerText" ==> field input "markerText"
                                  "callGapKey" ==> field location "callGapKey"
                                  "resultGapKey" ==> field location "resultGapKey"
                                  "metadata" ==> field location "metadata" ]
                        let rendered = render.Invoke(Array.append visible [| candidate |])

                        if not (unbox<bool> (field rendered "ok")) then
                            return failure (createObj [ "kind" ==> "Render"; "cause" ==> field rendered "error" ])
                        else
                            let! written = append.Invoke candidate
                            if unbox<bool> (field written "ok") then
                                return success (createObj [ "wire" ==> field rendered "value"; "appended" ==> true ])
                            else
                                return failure (createObj [ "kind" ==> "Append"; "cause" ==> field written "error" ])
        }
