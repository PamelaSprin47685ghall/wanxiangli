module Wanxiangli.HandleLifecycle.HandleHistory

open System
open Fable.Core
open Fable.Core.JsInterop

open Wanxiangli.HandleLifecycle.HandleLifecycleLawCore

let private text (value: obj) name : string = value?(name)
let private flag (value: obj) name : bool = value?(name)
let private handleKey (value: obj) : int * string = value?kind, value?id
let private workKey (value: obj) = handleKey value?handle, text value "child", text value "root"
let private copy (value: obj) : obj = emitJsExpr value "Object.freeze(JSON.parse(JSON.stringify($0)))"
let private merge (value: obj) (fields: obj) : obj = emitJsExpr (value, fields) "Object.freeze({...$0,...$1})"
let private success value = createObj [ "ok" ==> true; "value" ==> value ]
let private failure reason = createObj [ "ok" ==> false; "error" ==> reason ]
let private sameCell (left: obj) (right: obj) =
    not (isNull left) && not (isNull right)
    && text left "kind" = text right "kind"
    && text left "reference" = text right "reference"
    && text left "digest" = text right "digest"
let private shape (cell: obj) =
    if isNull cell then null
    else createObj [ "kind" ==> text cell "kind"; "hasRef" ==> not (isNull cell?reference); "hasDigest" ==> not (isNull cell?digest) ]
let private values map = map |> Map.toArray |> Array.map snd
let private nullable value = value |> Option.defaultValue null

[<AttachMembers>]
type HandleHistory(?state: obj) =
    let bindingMap, workMap, legacy, nextOrder : Map<int * string, obj> * Map<(int * string) * string * string, obj> * Set<int * string> * int =
        match state with
        | Some state -> unbox state
        | None -> Map.empty, Map.empty, Set.empty, 0

    member _.bindings() = values bindingMap |> Array.map copy
    member _.works() = values workMap |> Array.map copy
    member _.legacyHandles() = legacy |> Set.toArray |> Array.map (fun (kind, id) -> createObj [ "kind" ==> kind; "id" ==> id ])
    member _.nextCreationOrder = nextOrder
    member _.isLegacy(handle: obj) = Set.contains (handleKey handle) legacy
    member _.binding(handle: obj) = Map.tryFind (handleKey handle) bindingMap |> Option.map copy |> nullable
    member _.work(work: obj) = Map.tryFind (workKey work) workMap |> Option.map copy |> nullable

    member this.link(binding: obj) =
        let key = handleKey binding?handle
        match Map.tryFind key bindingMap with
        | Some prior ->
            let matches =
                [ "child"; "target"; "byname"; "role" ] |> List.forall (fun name -> text prior name = text binding name)
            if matches && flag prior "parentVisible" = flag binding "parentVisible" then success this
            else failure "HandleIdentityConflict"
        | None ->
            let record = merge (copy binding) (createObj [ "phase" ==> "Active"; "reason" ==> null; "completion" ==> null; "lastCompletion" ==> null; "work" ==> null; "creationOrder" ==> nextOrder ])
            success (HandleHistory(box (Map.add key record bindingMap, workMap, legacy, nextOrder + 1)))

    member this.transition(request: obj) =
        let key = handleKey request?handle
        let found = Map.tryFind key bindingMap
        let phase: obj = found |> Option.map (fun record -> record?phase: obj) |> nullable
        let event = text request "event"
        let cell: obj = request?completion
        let matches = found |> Option.exists (fun record -> text record "phase" = "CompletedAwaitingJoin" && sameCell record?completion cell)
        let law = HandleLifecycleLaw()
        let verdict: obj = law.handle(createObj [ "event" ==> event; "phase" ==> phase; "cellMatches" ==> matches ])
        match text verdict "verdict", found with
        | "reject", _ -> failure (text verdict "rejection")
        | "keep", _ -> success this
        | _, Some record ->
            let nextPhase = text verdict "phase"
            let fields =
                [ "phase" ==> nextPhase
                  "completion" ==> (if nextPhase = "CompletedAwaitingJoin" then copy cell else null)
                  "reason" ==> (if nextPhase = "Abandoned" then request?reason else null)
                  "lastCompletion" ==> (if event = "complete" then copy cell else record?lastCompletion) ]
            let updated = Map.add key (merge record (createObj fields)) bindingMap
            let nextLegacy = if event = "complete" then Set.add key legacy else legacy
            success (HandleHistory(box (updated, workMap, nextLegacy, nextOrder)))
        | _ -> failure "UnknownHandle"

    member this.admit(request: obj) =
        let handle: obj = request?handle
        let key = handleKey handle
        let profile: obj = request?profile
        match Map.tryFind key bindingMap with
        | None -> failure "UnknownHandle"
        | Some _ when isNull profile -> failure "WorkNotAdmitted"
        | Some binding ->
            let landing: obj = request?landing
            let exact =
                not (isNull landing)
                && text landing "child" = text binding "child"
                && text landing "identity" = text profile "identity"
                && flag landing "ownerRoot"
                && text profile "owner" = text request "parent"
            if not exact then failure "WorkNotAdmitted"
            elif text profile "child" <> text binding "child" || text profile "role" <> text binding "role" || text profile "target" <> text binding "target" then failure "HandleIdentityConflict"
            elif Set.contains key legacy then failure "LegacyWorkAmbiguous"
            else
                let work = createObj [ "handle" ==> handle; "child" ==> text profile "child"; "root" ==> text profile "root" ]
                let workId = workKey work
                match Map.tryFind workId workMap, text binding "phase" with
                | _, "Abandoned" -> failure "AlreadyAbandoned"
                | Some prior, _ when text prior "logicalRun" = text profile "logicalRun" -> success this
                | Some _, _ -> failure "HandleIdentityConflict"
                | None, _ when workMap |> Map.exists (fun (owner, _, _) value -> owner = key && text value "phase" = "Active") -> failure "WorkStillActive"
                | None, _ ->
                    let record = createObj [ "work" ==> copy work; "logicalRun" ==> text profile "logicalRun"; "phase" ==> "Active"; "reason" ==> null; "completion" ==> null; "lastCompletion" ==> null; "consumptionId" ==> null ]
                    success (HandleHistory(box (bindingMap, Map.add workId record workMap, legacy, nextOrder)))

    member this.admitted(work: obj) =
        if Set.contains (handleKey work?handle) legacy then failure "LegacyWorkAmbiguous"
        else
            match Map.tryFind (workKey work) workMap with
            | Some record when text record "phase" = "Active" -> success (copy record)
            | Some _ -> failure "HandleIsRetired"
            | None -> failure "WorkNotAdmitted"

    member this.transitionWork(request: obj) =
        let work: obj = request?work
        let key = workKey work
        let found = Map.tryFind key workMap
        let phase: obj = found |> Option.map (fun record -> record?phase: obj) |> nullable
        let event = text request "event"
        let cell: obj = request?completion
        let matches = found |> Option.exists (fun record -> text record "phase" = "CompletedAwaitingJoin" && sameCell record?completion cell)
        let law = HandleLifecycleLaw()
        let verdict: obj = law.work(createObj [ "event" ==> event; "phase" ==> phase; "legacy" ==> Set.contains (handleKey work?handle) legacy; "completion" ==> shape cell; "expected" ==> shape cell; "cellEqualsExpected" ==> matches; "consumptionId" ==> request?consumptionId ])
        match text verdict "verdict", found with
        | "reject", _ -> failure (text verdict "rejection")
        | "keep", _ -> success this
        | _, Some record ->
            let nextPhase = text verdict "phase"
            let fields = createObj [ "phase" ==> nextPhase; "completion" ==> (if nextPhase = "CompletedAwaitingJoin" then copy cell else null); "reason" ==> (if nextPhase = "Abandoned" then request?reason else null); "lastCompletion" ==> (if event = "complete" then copy cell else record?lastCompletion); "consumptionId" ==> (if event = "consume" then request?consumptionId else record?consumptionId) ]
            success (HandleHistory(box (bindingMap, Map.add key (merge record fields) workMap, legacy, nextOrder)))
        | _ -> failure "WorkNotAdmitted"

    member _.workBindings() =
        workMap |> Map.toArray |> Array.choose (fun (_, work) ->
            Map.tryFind (handleKey work?work?handle) bindingMap
            |> Option.map (fun binding -> merge binding (createObj [ "work" ==> work?work; "phase" ==> work?phase; "reason" ==> work?reason; "completion" ==> work?completion; "lastCompletion" ==> work?lastCompletion ]))) |> Array.map copy

    member this.summary(handle: obj) =
        let binding = this.binding handle
        if isNull binding || Set.contains (handleKey handle) legacy then binding
        else
            let candidates = this.workBindings() |> Array.filter (fun record -> handleKey record?handle = handleKey handle)
            candidates |> Array.tryFind (fun record -> text record "phase" = "Active")
            |> Option.orElseWith (fun () -> candidates |> Array.tryFind (fun record -> text record "phase" <> "Retired"))
            |> Option.orElseWith (fun () -> Array.tryHead candidates)
            |> Option.defaultValue binding

    member this.summaries() = this.bindings() |> Array.map (fun binding -> this.summary binding?handle)
    member this.byname(byname: string, summarized: bool) =
        if String.IsNullOrWhiteSpace byname then null
        else
            let records = if summarized then this.summaries() else this.bindings()
            records |> Array.tryFind (fun record -> flag record "parentVisible" && String.Equals(text record "byname", byname.Trim(), StringComparison.OrdinalIgnoreCase)) |> nullable
    member this.forChild(child: string) = this.bindings() |> Array.tryFind (fun record -> text record "child" = child) |> Option.map (fun record -> this.summary record?handle) |> nullable
    member this.deliveryRecords() = Array.append (this.bindings()) (this.workBindings())

    member this.filterBindings(accept: obj -> bool) =
        HandleHistory(box (bindingMap |> Map.filter (fun _ binding -> accept (this.summary binding?handle)), workMap, legacy, nextOrder))

    member this.orderedCandidates() =
        let records = this.deliveryRecords()
        Array.append (records |> Array.filter (fun record -> text record "phase" = "Abandoned")) (records |> Array.filter (fun record -> text record "phase" = "CompletedAwaitingJoin"))
        |> Array.filter (fun record -> flag record "parentVisible")
        |> Array.sortBy (fun record -> unbox<int> record?creationOrder, text record "target")
