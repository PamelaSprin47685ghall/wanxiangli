namespace Wanxiangli.FissionGroup

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private FissionEffects =
    let field (value: obj) (name: string) : obj = value?(name)
    let text value name : string = unbox (field value name)
    let number value name : int = unbox (field value name)
    let ok value : bool = unbox (field value "ok")
    let success value = createObj [ "ok" ==> true; "value" ==> value ]
    let failure kind reason = createObj [ "ok" ==> false; "kind" ==> kind; "error" ==> reason ]
    let unavailable reason = failure "RuntimeUnavailable" reason
    let items value name : obj array = unbox (field value name)
    let entries value name = items value name |> Array.map (fun pair -> let pair = unbox<obj array> pair in pair[0], pair[1])
    let find key value name = entries value name |> Array.tryFind (fun (held, _) -> held = key) |> Option.map snd
    let absent value = isNullOrUndefined value
    let report (effects: obj) (kind: string) (group: obj) (detail: obj) : unit =
        let callback: obj = field effects "report"
        emitJsStatement (callback, kind, group, detail) "$0($1,$2,$3)"
    [<Emit("$0()")>]
    let call0<'a> (_callback: obj) : 'a = jsNative
    [<Emit("$0($1)")>]
    let call1<'a> (_callback: obj) (_arg: obj) : 'a = jsNative
    [<Emit("$0($1,$2)")>]
    let call2<'a> (_callback: obj) (_first: obj) (_second: obj) : 'a = jsNative
    [<Emit("$0($1,$2,$3)")>]
    let call3<'a> (_callback: obj) (_first: obj) (_second: obj) (_third: obj) : 'a = jsNative
    [<Emit("$0($1,$2,$3,$4)")>]
    let call4<'a> (_callback: obj) (_a: obj) (_b: obj) (_c: obj) (_d: obj) : 'a = jsNative

open FissionEffects

[<Sealed; AttachMembers>]
type FissionLifecycle() =
    let admission = FissionAdmissionRegistry.fissionAdmissionRegistry
    let runtime = FissionRuntime.fissionRuntime
    let law = FissionGroupLawCore.FissionGroupLaw()
    let history effects : FissionHistory = call0 (field effects "history")
    let event group kind fields =
        createObj ([ "kind" ==> kind; "groupId" ==> text group "id"; "owner" ==> text group "owner" ] @ fields)
    let append effects fact : Task<obj> = call1 (field effects "append") fact
    let releaseGroup group =
        admission.release (text group "owner")
        runtime.clearOwner (text group "owner") |> ignore
    let sharedAccounted group lane =
        items group "before" |> Array.forall (fun completion ->
            find completion group "delivered" |> Option.exists (fun lanes -> unbox<int array> lanes |> Array.contains lane))

    let appendBlock effects (blocks: ResizeArray<string>) heading pair =
        task {
            let pair = unbox<obj array> pair
            let! read = call2<Task<obj>> (field effects "readBlob") pair[0] pair[1]
            if ok read then
                blocks.Add ""
                blocks.Add heading
                blocks.Add(text read "value")
            return read
        }

    let rec appendLaneBlocks effects group blocks indexes =
        task {
            match indexes with
            | [] -> return success ()
            | lane :: rest ->
                match find (box lane) group "work" with
                | None -> return unavailable (sprintf "missing lane work %d" lane)
                | Some pair ->
                    let! read = appendBlock effects blocks (sprintf "[lane.%d]" lane) pair
                    if not (ok read) then return read
                    else return! appendLaneBlocks effects group blocks rest
        }

    let rec appendSharedBlocks effects group blocks completions =
        task {
            match completions with
            | [] -> return success ()
            | completion :: rest ->
                match find (box completion) group "captured" with
                | None -> return unavailable ("missing captured shared completion: " + completion)
                | Some pair ->
                    let heading = "[shared_completion.\"" + completion.Replace("\"", "\\\"") + "\"]"
                    let! read = appendBlock effects blocks heading pair
                    if not (ok read) then return read
                    else return! appendSharedBlocks effects group blocks rest
        }

    let aggregate effects group =
        task {
            let! owner = call2<Task<obj>> (field effects "readBlob") (field group "ownerReference") (field group "ownerDigest")
            if not (ok owner) then return owner
            else
                let blocks = ResizeArray [ "[[fission_convergence]]"; sprintf "lane_count = %d" (number group "count"); ""; "[owner_before_fission]"; text owner "value" ]
                let order = unbox<int array> (law.mergeOrder(box (number group "count"))) |> Array.toList
                let! lanes = appendLaneBlocks effects group blocks order
                if not (ok lanes) then return lanes
                else
                    let completions = items group "before" |> Array.map unbox<string> |> Array.sort |> Array.toList
                    let! shared = appendSharedBlocks effects group blocks completions
                    if not (ok shared) then return shared
                    else return success (System.String.Join("\n", blocks))
        }

    let rec retirePredecessors effects group completions =
        task {
            match completions with
            | [] -> return true
            | completion :: rest ->
                let! retired = call2<Task<bool>> (field effects "retireCompletion") (field group "owner") (box completion)
                if not retired then return false
                else return! retirePredecessors effects group rest
        }

    let sendTakeover effects group authority aggregate blob =
        task {
            let lane = law.finalLane(box (number group "count"))
            match find lane group "sessions" with
            | None -> return false
            | Some session ->
                let! sent = call3<Task<obj>> (field effects "sendTakeover") session authority (box aggregate)
                if not (ok sent) then
                    report effects "takeover-send" group (createObj [ "lane" ==> lane; "session" ==> session; "error" ==> text sent "error" ])
                    return false
                else
                    let fact = event group "takeover" [ "laneIndex" ==> lane; "session" ==> session; "prompt" ==> field sent "value"; "physical" ==> (null: obj); "reference" ==> field blob "reference"; "digest" ==> field blob "digest" ]
                    let! claimed = append effects fact
                    if not (ok claimed) then report effects "takeover-append" group (createObj [ "lane" ==> lane; "session" ==> session; "error" ==> text claimed "error" ])
                    return ok claimed
        }

    let writeTakeover effects group authority =
        task {
            let! assembled = aggregate effects group
            if not (ok assembled) then
                report effects "aggregate-read" group assembled
                return false
            else
                let! written = call1<Task<obj>> (field effects "writeBlob") (field assembled "value")
                if not (ok written) then
                    report effects "aggregate-write" group written
                    return false
                else return! sendTakeover effects group authority (text assembled "value") (field written "value")
        }

    let claimTakeover effects group =
        task {
            let id = text group "id"
            if not (runtime.tryBeginTakeover id) then return false
            else
                try
                    let authority: obj = call1 (field effects "ownerAuthority") (field group "owner")
                    if absent authority then return false
                    else return! writeTakeover effects group authority
                finally runtime.endTakeover id
        }

    let convergeOwner effects owner =
        task {
            let current = history effects
            let group = current.latestForOwner owner
            if absent group then return false
            else
                match text (field group "terminal") "kind" with
                | "Failed" -> return false
                | "Converged" -> return true
                | _ when not (absent (field group "takeover")) -> return true
                | _ when not (current.convergenceReady(text group "id")) -> return false
                | _ ->
                    let completions = items group "before" |> Array.map unbox<string> |> Array.sort |> Array.toList
                    let! retired = retirePredecessors effects group completions
                    if not retired then return false
                    else return! claimTakeover effects group
        }

    let failGroup effects group (reason: string) =
        task {
            if text (field group "terminal") "kind" = "Open" then
                let! failed = append effects (event group "failed" [ "reason" ==> reason ])
                if not (ok failed) then report effects "failure-append" group failed
                else
                    for _, session in entries group "sessions" do
                        let! aborted = call1<Task<obj>> (field effects "abortSession") session
                        if not (ok aborted) then report effects "lane-abort" group (createObj [ "session" ==> session; "error" ==> text aborted "error" ])
                    let notified: bool = call2 (field effects "notifyFailed") (field group "owner") (box reason)
                    if not notified then report effects "failure-unobserved" group null
                    releaseGroup group
        }

    let completeTakeover effects group observation =
        task {
            let! published = call2<Task<obj>> (field effects "publishOwner") group observation
            if not (ok published) then do! failGroup effects group (text published "error")
            else
                let takeover = field group "takeover"
                let fact = event group "converged" [ "session" ==> field observation "session"; "run" ==> field observation "run"; "reference" ==> field takeover "reference"; "digest" ==> field takeover "digest" ]
                let! converged = append effects fact
                if ok converged then releaseGroup group
                else do! failGroup effects group (text converged "error")
            return true
        }

    let materialize effects group lane observation =
        task {
            let material: obj = call1 (field effects "readDelivery") observation
            if absent material then
                let! nudge = call4<Task<obj>> (field effects "nudge") group (box lane) observation (box false)
                if text nudge "kind" = "failed" then do! failGroup effects group ("fission undelivered lane nudge failed: " + text nudge "error")
            else
                let! written = call1<Task<obj>> (field effects "writeBlob") material
                if not (ok written) then do! failGroup effects group (text written "error")
                else
                    let blob = field written "value"
                    let fact = event group "laneMaterialized" [ "laneIndex" ==> lane; "session" ==> field observation "session"; "run" ==> field observation "run"; "reference" ==> field blob "reference"; "digest" ==> field blob "digest" ]
                    let! recorded = append effects fact
                    if not (ok recorded) then do! failGroup effects group (text recorded "error")
                    else let! _ = convergeOwner effects (text group "owner") in ()
            return true
        }

    let observeCompleted effects group lane observation =
        task {
            let outstanding = entries group "affinities" |> Array.exists (fun (external, affinity) ->
                unbox<int> affinity = lane && not (call2<bool> (field effects "isExternalRetired") (field group "owner") external))
            if outstanding then
                if unbox<bool> (field observation "canNudge") then
                    let! _ = call4<Task<obj>> (field effects "nudge") group (box lane) observation (box true)
                    ()
                return true
            elif not (sharedAccounted group lane) then return true
            else return! materialize effects group lane observation
        }

    let recordDelivery effects request lane =
        task {
            let fact = event request "completionDelivered" [ "completion" ==> field request "completion"; "laneIndex" ==> number lane "index" ]
            let! recorded = append effects fact
            if not (ok recorded) then report effects "delivery-append" request (createObj [ "lane" ==> number lane "index"; "error" ==> text recorded "error" ])
        }

    let captureCompletion effects request =
        task {
            let group = (history effects).group(text request "id")
            let captured = not (absent group) && (find (field request "completion") group "captured" |> Option.isSome)
            if not captured then
                let! written = call1<Task<obj>> (field effects "writeBlob") (field request "payload")
                if not (ok written) then report effects "capture-write" request written
                else
                    let blob = field written "value"
                    let fact = event request "completionCaptured" [ "completion" ==> field request "completion"; "reference" ==> field blob "reference"; "digest" ==> field blob "digest" ]
                    let! recorded = append effects fact
                    if not (ok recorded) then report effects "capture-append" request recorded
        }

    let deliverShared effects request lane =
        task {
            let group = (history effects).group(text request "id")
            let laneIndex = number lane "index"
            let completion = text request "completion"
            let delivered = absent group || (find (box completion) group "delivered" |> Option.exists (fun lanes -> unbox<int array> lanes |> Array.contains laneIndex))
            let closed = absent group || (find (box laneIndex) group "work" |> Option.isSome)
            let id = text request "id"
            if not delivered && runtime.tryBeginDelivery(id, completion, laneIndex) then
                try
                    if closed then do! recordDelivery effects request lane
                    else
                        let! sent = call2<Task<obj>> (field effects "sendShared") request lane
                        if not (ok sent) then report effects "shared-send" request (createObj [ "lane" ==> laneIndex; "session" ==> field lane "session"; "error" ==> text sent "error" ])
                        elif unbox<bool> (field sent "value") then do! recordDelivery effects request lane
                finally runtime.endDelivery(id, completion, laneIndex)
        }

    let convergeAfterBroadcast effects request =
        task {
            if unbox<bool> (field effects "canConverge") then
                let revision: obj = call0 (field effects "revision")
                let! converged = call1<Task<bool>> (field effects "converge") (field request "owner")
                if not converged && (history effects).convergenceReady(text request "id") then
                    do! call1<Task<unit>> (field effects "awaitChange") revision
                    let! _ = call1<Task<bool>> (field effects "converge") (field request "owner")
                    ()
        }

    let rollback effects owner (lanes: obj array) =
        task {
            for lane in lanes do
                try do! call1<Task<unit>> (field effects "abortLane") (field lane "session")
                with _ -> ()
            admission.release owner
        }

    let rec createLanes effects owner parent (remaining: obj list) (created: obj list) =
        task {
            match remaining with
            | [] -> return success (created |> List.rev |> List.toArray)
            | lane :: rest ->
                let! result = call3<Task<obj>> (field effects "createLane") (box owner) parent lane
                if not (ok result) then
                    do! rollback effects owner (created |> List.rev |> List.toArray)
                    return unavailable ("lane create failed: " + text result "error")
                else
                    let started = createObj [ "index" ==> number lane "index"; "prompt" ==> text lane "prompt"; "session" ==> field result "value" ]
                    return! createLanes effects owner parent rest (started :: created)
        }

    let rec startLanes effects count ownerView (remaining: obj list) =
        task {
            match remaining with
            | [] -> return success ()
            | lane :: rest ->
                let prompt: obj = call3 (field effects "renderStartup") (box count) lane ownerView
                let! result = call2<Task<obj>> (field effects "startLane") (field lane "session") prompt
                if not (ok result) then return result
                else return! startLanes effects count ownerView rest
        }

    let failStarted effects owner lanes reason =
        task {
            do! call2<Task<unit>> (field effects "onFailed") (box owner) (box reason)
            do! rollback effects owner lanes
            return unavailable reason
        }

    let startCommitted effects owner parent count ownerView lanes =
        task {
            let! started = startLanes effects count ownerView (Array.toList lanes)
            if not (ok started) then return! failStarted effects owner lanes ("lane start failed: " + text started "error")
            else
                let! interrupted = call1<Task<obj>> (field effects "interruptOwner") (box owner)
                if not (ok interrupted) then return! failStarted effects owner lanes ("silent owner interrupt failed: " + text interrupted "error")
                else
                    return success (createObj [ "owner" ==> owner; "parent" ==> parent; "ownerView" ==> ownerView; "lanes" ==> lanes ])
        }

    let commitCreated effects owner parent count ownerView lanes =
        task {
            let material = if isNullOrUndefined ownerView then box "" else ownerView
            let! committed = call4<Task<obj>> (field effects "onLanesCreated") (box owner) parent material (box lanes)
            if not (ok committed) then
                do! rollback effects owner lanes
                return unavailable ("fission admission commit failed: " + text committed "error")
            else return! startCommitted effects owner parent count ownerView lanes
        }

    let admitReserved effects owner parent count lanes =
        task {
            let! view = call1<Task<obj>> (field effects "ownerView") (box owner)
            if not (ok view) then
                admission.release owner
                return unavailable ("owner view materialization failed: " + text view "error")
            else
                let! created = createLanes effects owner parent (Array.toList lanes) []
                if not (ok created) then return created
                else return! commitCreated effects owner parent count (field view "value") (unbox<obj array> (field created "value"))
        }

    member _.isActive(owner: string) = admission.isActive owner
    member _.release(owner: string) = admission.release owner

    member _.converge(owner: string, effects: obj) = convergeOwner effects owner

    member _.fail(group: obj, reason: string, effects: obj) = failGroup effects group reason

    member _.broadcast(request: obj, effects: obj) : Task<unit> =
        task {
            let id = text request "id"
            let completion = text request "completion"
            if runtime.tryBeginDelivery(id, completion, -1) then
                try
                    do! captureCompletion effects request
                    for lane in items request "lanes" |> Array.sortBy (fun lane -> number lane "index") do
                        do! deliverShared effects request lane
                    do! convergeAfterBroadcast effects request
                with ex -> report effects "broadcast" request (createObj [ "error" ==> ex.Message ])
                runtime.endDelivery(id, completion, -1)
        }

    member _.observe(observation: obj, effects: obj) : Task<bool> =
        task {
            let session = text observation "session"
            let current = history effects
            if runtime.isSilentInterrupt session || not (absent (current.activeForOwner session)) then return true
            else
                let membership = current.membership session
                if absent membership then return false
                else
                    let group = field membership "group"
                    let takeover = field group "takeover"
                    if text (field group "terminal") "kind" <> "Open" then return true
                    elif not (absent takeover) && text takeover "session" <> session then return true
                    else
                        let stage = if absent takeover then "lane" else "takeover"
                        let decision = law.settle(createObj [ "stage" ==> stage; "observation" ==> text observation "outcome" ])
                        match text decision "decision" with
                        | "yield" -> return false
                        | "fail" ->
                            do! failGroup effects group (text observation "reason")
                            return true
                        | "complete" -> return! completeTakeover effects group observation
                        | _ -> return! observeCompleted effects group (number membership "laneIndex") observation
        }

    member _.admit(request: obj, effects: obj) : Task<obj> =
        task {
            let count = number request "count"
            let owner = text request "owner"
            if count < 2 then return failure "TooFewLanes" ""
            else
                let! parent = call1<Task<obj>> (field effects "parentOf") (box owner)
                if not (ok parent) then return unavailable ("physical parent lookup failed: " + text parent "error")
                elif isNullOrUndefined (field parent "value") then return failure "InvalidOrigin" ""
                elif not (admission.reserve owner) then return failure "AlreadyFissioned" ""
                else return! admitReserved effects owner (field parent "value") count (unbox<obj array> (field request "lanes"))
        }
