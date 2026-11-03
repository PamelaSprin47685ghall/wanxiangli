namespace Wanxiangli.LocalEventStore

open System
open Fable.Core
open Fable.Core.JsInterop

module internal Integration =
    [<Import("CanonicalEventCodec", "wanxiangli/events")>]
    let private codecClass: obj = jsNative
    [<Import("KWayMerge", "wanxiangli/convergence")>]
    let private mergeClass: obj = jsNative
    [<Import("RuleQuarantine", "wanxiangli/quarantine")>]
    let private quarantineClass: obj = jsNative
    [<Emit("new $0()")>]
    let private create (_class: obj) : obj = jsNative
    let codec = create codecClass
    let merger = create mergeClass
    let quarantine = create quarantineClass

    [<Emit("({...$0, parents: [...new Set($0.parents)].sort(), payloadRefs: [...new Set($0.payloadRefs)].sort(), payloads: $0.payloads || {}})")>]
    let normalize (_event: obj) : obj = jsNative
    [<Emit("Object.entries($0)")>]
    let entries (_value: obj) : (string * byte[]) array = jsNative
    [<Emit("Date.now()")>]
    let now () : float = jsNative
    [<Emit("$0 === $1")>]
    let same (_left: obj) (_right: obj) : bool = jsNative
    [<Emit("JSON.stringify($0)")>]
    let describe (_value: obj) : string = jsNative
    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    let text value name = unbox<string> (field value name)
    let ok (value: obj) = createObj [ "ok" ==> true; "value" ==> value ]
    let error (reason: string) = createObj [ "ok" ==> false; "error" ==> reason ]
    let succeeded (result: obj) = unbox<bool> (field result "ok")
    let reason (result: obj) = text result "error"
    let ruleName (rule: obj) = text rule "name"
    let eventKey (event: obj) = text event "id"
    let eventType (event: obj) = text event "type"
    let eventStream (event: obj) = text event "stream"
    let business rules = rules |> Array.filter (fun rule -> ruleName rule <> "Structural")
    let matching rules (event: obj) = business rules |> Array.filter (fun rule -> let accepted: bool = rule?accepts event in accepted)
    let tryRule rules name = business rules |> Array.tryFind (fun rule -> ruleName rule = name)
    let faultScope (rule: obj) (event: obj) : string = rule?faultScope event

    type Structural = { Heads: Map<string, Set<string>> }
    type State =
        { Currents: Map<string, obj>
          Events: Map<string, obj>
          Payloads: Map<string, byte[]>
          Faults: obj }
    type FaultKey = { Rule: string; Scope: string }
    type Step = { State: State; Failed: (FaultKey * string) list }

    let initial (rules: obj array) =
        let currents = rules |> Array.map (fun rule -> ruleName rule, field rule "initial") |> Map.ofArray |> Map.add "Structural" (box { Heads = Map.empty })
        let faults: obj = quarantine?empty ()
        { Currents = currents
          Events = Map.empty; Payloads = Map.empty; Faults = faults }
    let structural state = unbox<Structural> state.Currents["Structural"]
    let heads state stream = Map.tryFind stream (structural state).Heads |> Option.defaultValue Set.empty |> Set.toArray
    let allHeads state = (structural state).Heads |> Map.toSeq |> Seq.collect (fun (_, heads) -> Set.toSeq heads) |> Seq.distinct |> Seq.toArray
    let currentFor (rule: obj) state = Map.tryFind (ruleName rule) state.Currents |> Option.defaultValue (field rule "initial")
    let keyFor rule event = { Rule = ruleName rule; Scope = faultScope rule event }
    let fault state key : obj = quarantine?fault (state.Faults, key.Rule, key.Scope)
    let structuralStep state (event: obj) =
        let current = structural state
        let stream = eventStream event
        let previous = Map.tryFind stream current.Heads |> Option.defaultValue Set.empty
        let next = unbox<string array> (field event "parents") |> Array.fold (fun heads parent -> Set.remove parent heads) previous |> Set.add (eventKey event)
        { state with Currents = Map.add "Structural" (box { Heads = Map.add stream next current.Heads }) state.Currents }

    let applyCutFor state (payload: obj) (rule: obj) key =
        let result: obj = rule?applyCut (currentFor rule state, text payload "resetJson")
        if not (succeeded result) then state
        else
            let currents = Map.add (ruleName rule) (field result "value") state.Currents
            let released: obj = quarantine?release (state.Faults, key.Rule, key.Scope)
            { state with
                Currents = currents
                Faults = released }
    let applyCut rules state (payload: obj) =
        let named = tryRule rules (text payload "rule")
        let failed = Map.tryFind (text payload "failedEventId") state.Events
        let scope = match named, failed with Some rule, Some event -> box (faultScope rule event) | _ -> null
        let canCut () : bool = quarantine?cutVerdict (named.IsSome, scope)
        match named, failed with
        | Some rule, Some event when canCut () -> applyCutFor state payload rule (keyFor rule event)
        | _ -> state
    let integrateRule (event: obj) (state, failed) (rule: obj) =
        let key = keyFor rule event
        let quarantined: bool = quarantine?isQuarantined (state.Faults, key.Rule, key.Scope)
        if quarantined then state, failed
        else
            let result: obj = rule?integrate (currentFor rule state, event)
            if succeeded result then { state with Currents = Map.add (ruleName rule) (field result "value") state.Currents }, failed
            else
                let detail = reason result
                let key = keyFor rule event
                let quarantined: obj = quarantine?quarantine (state.Faults, key.Rule, key.Scope, eventKey event, detail)
                { state with Faults = quarantined }, (key, detail) :: failed
    let semanticStep rules state (event: obj) =
        let cut: obj = quarantine?decodeCut (eventType event, field event "payload")
        if not (isNull cut) then { State = applyCut rules state cut; Failed = [] }
        else
            let next, failed = matching rules event |> Array.fold (integrateRule event) (state, [])
            { State = next; Failed = List.rev failed }
    let addEvent key (event: obj) step =
        let payloads = entries (field event "payloads") |> Array.fold (fun payloads (reference, bytes) -> Map.add reference bytes payloads) step.State.Payloads
        { step with State = { step.State with Events = Map.add key event step.State.Events; Payloads = payloads } }
    let integrateOne rules (formatError: obj -> string) allowExternalParents state event =
        let event = normalize event
        let key = eventKey event
        match Map.tryFind key state.Events with
        | Some existing ->
            let identity: obj = codec?checkIdentity (existing, event)
            if succeeded identity then Ok { State = state; Failed = [] }
            else Error("identity collision: " + formatError (field identity "error"))
        | None ->
            let missing = unbox<string array> (field event "parents") |> Array.tryFind (fun parent -> not (Map.containsKey parent state.Events))
            match missing with
            | Some parent when not allowExternalParents -> Error("missing parent during integration: " + parent)
            | _ -> semanticStep rules (structuralStep state event) event |> addEvent key event |> Ok
    let replay rules (formatError: obj -> string) (streams: obj array) =
        let tuples = streams |> Array.map (fun stream -> text stream "writerId", unbox<obj array> (field stream "events"))
        let merged: obj = merger?mergeRetained tuples
        if not (succeeded merged) then Error("writer-stream replay invalid: " + formatError (field merged "error"))
        else
            let ordered = unbox<obj array> (field merged "events")
            let mutable state = initial rules
            let mutable index = 0
            let mutable failure = None
            while index < ordered.Length && failure.IsNone do
                match integrateOne rules formatError true state ordered[index] with
                | Ok step -> state <- step.State; index <- index + 1
                | Error reason -> failure <- Some reason
            match failure with Some reason -> Error reason | None -> Ok state

    let private fullReplayGate = obj()
    let mutable private fullReplayUsed = false
    let spendFullReplay () =
        lock fullReplayGate (fun () ->
            if fullReplayUsed then false
            else fullReplayUsed <- true; true)
    let validateHistory (isKnown: string -> bool) (streams: obj array) =
        let events = streams |> Array.collect (fun stream -> unbox<obj array> (field stream "events"))
        let closure: obj = codec?checkClosure (events, Func<string, bool>(isKnown))
        if succeeded closure then Ok()
        else
            let failure = field closure "error"
            let reason =
                match text failure "code" with
                | "UnknownEventType" -> "unknown durable event type during replay: " + text failure "eventType"
                | "MissingPayload" -> "missing durable inline payload during replay: " + text failure "payloadRef"
                | "PayloadDigestMismatch" -> "durable inline payload digest mismatch during replay: " + text failure "payloadRef"
                | "UnreferencedPayload" -> "unreferenced durable inline payload during replay: " + text failure "payloadRef"
                | _ -> describe failure
            Error reason
    let readStreams directory prefix (formatError: obj -> string) =
        let read = Physical.readStreams directory (now())
        if succeeded read then Ok(unbox<obj array> (field read "streams"))
        else Error(prefix + formatError (field read "error"))

[<Sealed; AttachMembers>]
type LocalIntegrator(options: obj) =
    let rules = unbox<obj array> (Integration.field options "rules") |> Array.copy
    let isKnown (name: string) : bool = options?isKnownEventType name
    let formatError detail =
        if isNullOrUndefined (Integration.field options "formatStorageError") then Integration.describe detail
        else
            let formatted: string = options?formatStorageError detail
            formatted
    let mutable state = Integration.initial rules
    let mutable loadedDirectory: obj option = None

    let validatePlan (rule: obj) (current: obj) (plan: obj) =
        let applied: obj = rule?applyCut (current, Integration.text plan "resetJson")
        if Integration.succeeded applied then Ok plan else Error(Integration.reason applied)
    let inferPlan (rule: obj) (current: obj) (failed: obj) (fault: obj) afterFullReplay =
        let planned: obj = rule?planCut (current, failed, Integration.text fault "reason", afterFullReplay)
        if Integration.succeeded planned then validatePlan rule current (Integration.field planned "value")
        else Error(Integration.reason planned)
    let retryAfterReplay rule failed fault firstReason =
        match loadedDirectory with
        | Some directory when Integration.spendFullReplay () ->
            Integration.readStreams directory "cut-tail full replay read failed: " formatError
            |> Result.bind (fun streams -> Integration.validateHistory isKnown streams |> Result.map (fun () -> streams))
            |> Result.bind (Integration.replay rules formatError)
            |> Result.bind (fun replayed ->
                inferPlan rule (Integration.currentFor rule replayed) failed fault true
                |> Result.mapError (fun secondReason -> sprintf "cut-tail inference failed before and after the one full replay: %s; %s" firstReason secondReason))
        | _ -> Error("cut-tail inference failed and full replay budget is unavailable: " + firstReason)
    let planCut (current: Integration.State) (rule: obj) (fault: obj) =
        let failedId = Integration.text fault "failedEventId"
        match Map.tryFind failedId current.Events with
        | None -> Error("cut-tail lost failed event: " + failedId)
        | Some failed ->
            match inferPlan rule (Integration.currentFor rule current) failed fault false with
            | Ok plan -> Ok plan
            | Error firstReason -> retryAfterReplay rule failed fault firstReason
    let cutEnvelope current (rule: obj) (fault: obj) (plan: obj) =
        let name = Integration.ruleName rule
        let stream = "integrator/cut-tail/" + name
        let payload: obj = Integration.quarantine?encodeCut (createObj [ "rule" ==> name; "failedEventId" ==> Integration.text fault "failedEventId"; "reason" ==> Integration.text fault "reason"; "resetJson" ==> Integration.text plan "resetJson" ])
        createObj
            [ "id" ==> Guid.NewGuid().ToString("N")
              "stream" ==> stream; "type" ==> "ProjectionCutTail"
              "parents" ==> Array.append [| Integration.text fault "failedEventId" |] (Integration.heads current stream)
              "payload" ==> payload; "payloadRefs" ==> ([||]: string array); "payloads" ==> createObj [] ]
        |> Integration.normalize
    let ensureReset current (rule: obj) key =
        let fault = Integration.fault current key
        if isNull fault then Ok(current, [], [])
        else
            planCut current rule fault
            |> Result.bind (fun plan ->
                let cut = cutEnvelope current rule fault plan
                Integration.integrateOne rules formatError false current cut
                |> Result.map (fun integrated ->
                    let receipt = createObj [ "rule" ==> Integration.ruleName rule; "failedEventId" ==> Integration.text fault "failedEventId"; "reason" ==> Integration.text fault "reason"; "cutEventId" ==> Integration.eventKey cut ]
                    integrated.State, [cut], [receipt]))
    let ensureMatching current event =
        Integration.matching rules event
        |> Array.fold (fun aggregate rule ->
            aggregate |> Result.bind (fun (state, cuts, receipts) ->
                ensureReset state rule (Integration.keyFor rule event)
                |> Result.map (fun (next, added, received) -> next, cuts @ added, receipts @ received))) (Ok(current, [], []))
    let closeFailures current failed =
        failed |> List.fold (fun aggregate (key: Integration.FaultKey, _) ->
            aggregate |> Result.bind (fun (state, events, receipts) ->
                match Integration.tryRule rules key.Rule with
                | None -> Ok(state, events, receipts)
                | Some rule ->
                    ensureReset state rule key
                    |> Result.map (fun (next, added, received) -> next, events @ added, receipts @ received))) (Ok(current, [], []))
    let prepareLive start events =
        let rec loop current durable cuts = function
            | [] -> Ok(current, durable, cuts)
            | raw :: tail ->
                let event = Integration.normalize raw
                ensureMatching current event
                |> Result.bind (fun (before, resetEvents, resetCuts) ->
                    Integration.integrateOne rules formatError false before event
                    |> Result.bind (fun step ->
                        closeFailures step.State step.Failed
                        |> Result.bind (fun (after, postEvents, postCuts) ->
                            loop after (durable @ resetEvents @ [event] @ postEvents) (cuts @ resetCuts @ postCuts) tail)))
        loop start [] [] events

    member _.reload(directory: obj) : obj =
        let reloaded =
            Integration.readStreams directory "local event history read failed: " formatError
            |> Result.bind (fun streams -> Integration.validateHistory isKnown streams |> Result.map (fun () -> streams))
            |> Result.bind (Integration.replay rules formatError)
        match reloaded with
        | Error reason -> Integration.error reason
        | Ok replayed ->
            state <- replayed
            loadedDirectory <- Some directory
            Integration.ok (null: obj)
    member _.prepare(events: obj array) : obj =
        match prepareLive state (Array.toList events) with
        | Error reason -> Integration.error reason
        | Ok(prepared, durable, cuts) ->
            let expected = state
            let commit () =
                if not (Integration.same (box state) (box expected)) then
                    failwith "CanonicalIntegrator Current changed between prepare and durable append"
                state <- prepared
            Integration.ok (createObj [ "durableEvents" ==> List.toArray durable; "cuts" ==> List.toArray cuts; "commit" ==> commit ])
    member _.isKnownEventType(eventType: string) = isKnown eventType
    member _.current(key: string) = Map.tryFind key state.Currents |> Option.defaultValue null
    member _.event(key: string) = Map.tryFind key state.Events |> Option.defaultValue null
    member _.payload(reference: string) = Map.tryFind reference state.Payloads |> Option.map box |> Option.defaultValue null
    member _.heads(stream: string) = Integration.heads state stream
    member _.head(stream: string) = match Integration.heads state stream with [|head|] -> box head | _ -> null
    member _.allHeads() = Integration.allHeads state
