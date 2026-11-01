namespace Wanxiangli.LocalEventStore

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

type private StoreIntegrator =
    abstract reload: obj -> obj
    abstract prepare: obj array -> obj
    abstract isKnownEventType: string -> bool
    abstract current: string -> obj
    abstract event: string -> obj
    abstract payload: string -> obj
    abstract heads: string -> string array
    abstract head: string -> obj
    abstract allHeads: unit -> string array

type private StoreCodec =
    abstract checkIdentity: obj * obj -> obj
    abstract checkClosure: obj array * Func<string, bool> -> obj

module private StoreOperations =
    let codec: StoreCodec = unbox Integration.codec
    let absent: obj = null

    [<Emit("Object.keys($0)")>]
    let keys (_value: obj) : string array = jsNative

    [<Emit("$0[$1]")>]
    let field (_value: obj) (_key: string) : obj = jsNative

    let text value key = unbox<string> (field value key)
    let truth value key = unbox<bool> (field value key)
    let array value key = unbox<obj array> (field value key)
    let strings value key = unbox<string array> (field value key)

    [<Emit("$0.commit()")>]
    let commit (_prepared: obj) : unit = jsNative

    [<Emit("$0.release()")>]
    let release (_lease: obj) : Task<unit> = jsNative

    [<Emit("$0[$1] = $2")>]
    let setField (_value: obj) (_key: string) (_item: obj) : unit = jsNative

    let ok (value: obj) = createObj [ "ok" ==> true; "value" ==> value ]
    let error (value: obj) = createObj [ "ok" ==> false; "error" ==> value ]
    let fault (phase: string) (cause: exn) = createObj [ "phase" ==> phase; "cause" ==> cause ]
    let invalid (code: string) (fields: (string * obj) list) = createObj (List.append [ "code" ==> code ] fields)
    let storageInvalid (detail: obj) = createObj [ "kind" ==> "StorageInvalid"; "invalid" ==> detail ]
    let refused (reason: string) = createObj [ "kind" ==> "PreparationRejected"; "reason" ==> reason ]
    let receipt (cuts: obj array) = createObj [ "cuts" ==> cuts ]
    let prepared (events: obj array) (cuts: obj array) = createObj [ "durableEvents" ==> events; "cuts" ==> cuts ]

    let notAttempted (requested: obj array) (prepared: obj) (primary: obj) (cleanup: obj array) (prior: obj) =
        createObj
            [ "kind" ==> "AppendNotAttempted"
              "requested" ==> requested; "prepared" ==> prepared
              "primary" ==> primary; "cleanupFailures" ==> cleanup
              "priorRejection" ==> prior ]

    let unknown (requested: obj array) (prepared: obj) (primary: obj) (cleanup: obj array) =
        createObj
            [ "kind" ==> "CommitUnknown"
              "requested" ==> requested; "prepared" ==> prepared
              "primary" ==> primary; "cleanupFailures" ==> cleanup ]

    let attempt phase action =
        try Ok(action ())
        with cause -> Error(fault phase cause)

    let normalizeClosureError (detail: obj) =
        match text detail "code" with
        | "PayloadDigestMismatch" | "UnreferencedPayload" ->
            invalid "MissingPayload" [ "payloadRef" ==> field detail "payloadRef" ]
        | _ -> detail

    let checkDag (events: obj array) =
        let identities = events |> Array.map (fun event -> text event "id") |> Set.ofArray
        let parentsById =
            events
            |> Array.map (fun event ->
                text event "id",
                (strings event "parents" |> Array.filter (fun parent -> Set.contains parent identities)))
            |> Map.ofArray

        let rec visit key visiting visited =
            if Set.contains key visited then Ok visited
            elif Set.contains key visiting then Error(invalid "CyclicParents" [])
            else
                let nextVisiting = Set.add key visiting
                let parents = Map.tryFind key parentsById |> Option.defaultValue [||]
                parents
                |> Array.fold (fun result parent -> result |> Result.bind (visit parent nextVisiting)) (Ok visited)
                |> Result.map (Set.add key)

        Set.toList identities
        |> List.fold (fun result key -> result |> Result.bind (visit key Set.empty)) (Ok Set.empty)
        |> Result.map ignore

    let freshEvents (integrator: StoreIntegrator) (events: obj array) =
        let mutable seen: Map<string, obj> = Map.empty
        let fresh = ResizeArray<obj>()
        let mutable failure: obj option = None

        for raw in events do
            if failure.IsNone then
                let event = Integration.normalize raw
                let key = text event "id"
                let existing = Map.tryFind key seen |> Option.defaultWith (fun () -> integrator.event key)
                if isNull existing then
                    seen <- Map.add key event seen
                    fresh.Add event
                else
                    let identity = codec.checkIdentity (event, existing)
                    if truth identity "ok" then seen <- Map.add key event seen
                    else failure <- Some(field identity "error")

        match failure with Some detail -> Error detail | None -> Ok(fresh.ToArray())

    let validateParents (integrator: StoreIntegrator) (events: obj array) =
        let identities = events |> Array.map (fun event -> text event "id") |> Set.ofArray
        events
        |> Array.tryPick (fun event ->
            strings event "parents"
            |> Array.tryFind (fun parent -> not (Set.contains parent identities) && isNull (integrator.event parent))
            |> Option.map (fun parent -> invalid "MissingParent" [ "eventId" ==> parent ]))
        |> function Some detail -> Error detail | None -> Ok()

    let validate (integrator: StoreIntegrator) (events: obj array) =
        let unknownType =
            events |> Array.tryFind (fun event -> not (integrator.isKnownEventType (text event "type")))
        match unknownType with
        | Some event -> Error(invalid "UnknownEventType" [ "eventType" ==> field event "type" ])
        | None ->
            freshEvents integrator events
            |> Result.bind (fun fresh ->
                if fresh.Length = 0 then Ok fresh
                else
                    validateParents integrator fresh
                    |> Result.bind (fun () -> checkDag fresh)
                    |> Result.bind (fun () ->
                        let closure = codec.checkClosure (fresh, Func<string, bool>(fun _ -> true))
                        if truth closure "ok" then Ok fresh
                        else Error(normalizeClosureError (field closure "error"))))

    type Work =
        | Rejected of obj
        | NotAttempted of obj
        | Unknown of obj
        | NoNewWrite of receipt: obj * prepared: obj
        | NewWrite of receipt: obj * prepared: obj

    let settle = function
        | Rejected value when text value "kind" = "PreparationRejected" ->
            error(createObj [ "kind" ==> "AppendFailed"; "reason" ==> field value "reason" ])
        | Rejected value | NotAttempted value | Unknown value -> error value
        | NoNewWrite(value, _) | NewWrite(value, _) -> ok value

    let appendCleanup (evidence: obj) release =
        let cleanup = array evidence "cleanupFailures"
        let copied = createObj (keys evidence |> Array.map (fun key -> key, field evidence key) |> Array.toList)
        setField copied "cleanupFailures" (box (Array.append cleanup [| release |]))
        copied

    let releaseFailed requested work cause =
        let release = fault "StoreRelease" cause
        match work with
        | Rejected rejection -> error(notAttempted requested absent release [||] rejection)
        | NotAttempted evidence | Unknown evidence -> error(appendCleanup evidence release)
        | NoNewWrite(_, prepared) ->
            error(createObj [ "kind" ==> "NoNewWriteReleaseFailed"; "requested" ==> requested; "prepared" ==> prepared; "cause" ==> cause ])
        | NewWrite(_, prepared) -> error(unknown requested prepared release [||])

open StoreOperations

[<Sealed; AttachMembers>]
type LocalEventStore(options: obj) =
    let integrator: StoreIntegrator = unbox (field options "integrator")
    let directory = field options "directory"
    let lockTarget = field options "lockTarget"
    let writer = Physical.createWriter options
    let staged = Collections.Generic.Dictionary<string, byte[]>()
    let mutable inventory: string option = None
    let mutable pending = false

    let currentInventory () = Physical.inventory directory

    let bootReload () =
        let before = currentInventory ()
        let loaded = integrator.reload directory
        if truth loaded "ok" then
            let after = currentInventory ()
            inventory <- if before = after then Some after else None
        else inventory <- None
        loaded

    let refresh () =
        let current = currentInventory ()
        if inventory = Some current then Ok false
        else
            let loaded = integrator.reload directory
            if truth loaded "ok" then
                inventory <- Some(currentInventory ())
                Ok true
            else
                inventory <- None
                Error(Exception(text loaded "error"))

    let tryStaged key =
        match staged.TryGetValue key with true, bytes -> Some bytes | _ -> None

    let attachInline (event: obj) =
        let payloads = createObj []
        for key in strings event "payloadRefs" do
            let content =
                tryStaged key
                |> Option.filter (fun bytes -> Physical.digest bytes = key)
                |> Option.orElseWith (fun () ->
                    let bytes = integrator.payload key
                    if isNull bytes then None else Some(unbox<byte[]> bytes))
                |> Option.filter (fun bytes -> Physical.digest bytes = key)
            content |> Option.iter (fun bytes -> StoreOperations.setField payloads key (box bytes))
        if (StoreOperations.keys payloads).Length = 0 then event
        else
            let result = createObj (StoreOperations.keys event |> Array.map (fun key -> key, StoreOperations.field event key) |> Array.toList)
            StoreOperations.setField result "payloads" payloads
            result

    let commit requested (integration: obj) =
        let prepared = StoreOperations.prepared (array integration "durableEvents") (array integration "cuts")
        let physical = Physical.append writer (array integration "durableEvents")
        if truth physical "ok" then
            let written = text physical "completion" = "durable"
            match StoreOperations.attempt "CurrentCommit" (fun () -> StoreOperations.commit integration) with
            | Ok _ ->
                let receipt = StoreOperations.receipt (array integration "cuts")
                if written then StoreOperations.NewWrite(receipt, prepared)
                else StoreOperations.NoNewWrite(receipt, prepared)
            | Error primary ->
                if written then StoreOperations.Unknown(StoreOperations.unknown requested prepared primary [||])
                else StoreOperations.NotAttempted(StoreOperations.notAttempted requested prepared primary [||] absent)
        else
            if text physical "kind" = "before-append" then
                StoreOperations.NotAttempted(StoreOperations.notAttempted requested prepared (field physical "primary") [||] absent)
            else
                StoreOperations.Unknown(StoreOperations.unknown requested prepared (field physical "primary") (array physical "cleanupFailures"))

    let prepare requested fresh refuseSelfCut =
        match StoreOperations.attempt "Preparation" (fun () -> integrator.prepare fresh) with
        | Error primary -> StoreOperations.NotAttempted(StoreOperations.notAttempted requested absent primary [||] absent)
        | Ok integration when not (truth integration "ok") ->
            StoreOperations.Rejected(StoreOperations.refused ("integration preparation failed: " + text integration "error"))
        | Ok integration ->
            let prepared = field integration "value"
            let requestedIds = fresh |> Array.map (fun event -> text event "id") |> Set.ofArray
            let selfCut =
                array prepared "cuts"
                |> Array.tryFind (fun cut -> Set.contains (text cut "failedEventId") requestedIds)
            match selfCut with
            | Some cut when refuseSelfCut ->
                StoreOperations.Rejected(StoreOperations.refused ("freshness conflict with committed facts: " + text cut "reason"))
            | _ -> commit requested prepared

    let validate requested refuseSelfCut =
        match StoreOperations.attempt "Preparation" (fun () -> StoreOperations.validate integrator requested) with
        | Error primary -> StoreOperations.NotAttempted(StoreOperations.notAttempted requested absent primary [||] absent)
        | Ok(Error detail) -> StoreOperations.Rejected(StoreOperations.storageInvalid detail)
        | Ok(Ok fresh) when fresh.Length = 0 -> StoreOperations.NoNewWrite(StoreOperations.receipt [||], absent)
        | Ok(Ok fresh) -> prepare requested fresh refuseSelfCut

    do
        let loaded = bootReload ()
        if not (truth loaded "ok") then failwith ("local EventStore boot failed: " + text loaded "error")

    member _.append(events: obj array) : Task<obj> =
        let requested = Array.map attachInline events
        task {
            let! acquired =
                task {
                    try
                        let! lease = Physical.acquire lockTarget
                        return Ok lease
                    with cause -> return Error(StoreOperations.fault "GateAcquire" cause)
                }
            match acquired with
            | Error primary -> return StoreOperations.notAttempted requested absent primary [||] absent |> StoreOperations.error
            | Ok lease ->
                let work =
                    match refresh () with
                    | Error cause -> StoreOperations.NotAttempted(StoreOperations.notAttempted requested absent (StoreOperations.fault "Preparation" cause) [||] absent)
                    | Ok refreshed ->
                        let wasPending = pending
                        pending <- false
                        let refuseSelfCut = refreshed || wasPending
                        pending <- refreshed
                        let work = validate requested refuseSelfCut
                        match work with
                        | StoreOperations.NewWrite _ -> inventory <- Some(currentInventory ())
                        | StoreOperations.NoNewWrite _ | StoreOperations.Rejected _ -> pending <- false
                        | StoreOperations.NotAttempted _ | StoreOperations.Unknown _ ->
                            inventory <- None
                            pending <- true
                        work
                let! released =
                    task {
                        try
                            do! StoreOperations.release lease
                            return Ok()
                        with cause -> return Error cause
                    }
                return
                    match released with
                    | Ok() -> StoreOperations.settle work
                    | Error cause -> StoreOperations.releaseFailed requested work cause
        }

    member _.writePayload(content: byte[]) : Task<obj> =
        let key = Physical.digest content
        staged[key] <- content
        Task.FromResult(StoreOperations.ok (box key))

    member _.readPayload(key: string) : Task<obj> =
        let content = tryStaged key |> Option.map box |> Option.defaultWith (fun () -> integrator.payload key)
        Task.FromResult(StoreOperations.ok content)

    member _.current(key: string) : obj = integrator.current key
    member _.event(key: string) : obj = integrator.event key
    member _.heads(stream: string) : string array = integrator.heads stream
    member _.head(stream: string) : obj = integrator.head stream
    member _.allHeads() : string array = integrator.allHeads ()
    member _.reload() : obj = bootReload ()
