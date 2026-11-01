namespace Wanxiangli.DelegateBatch

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private InvocationValue =
    let get<'a> (value: obj) name : 'a = unbox value?(name)
    let optional<'a> (value: obj) name : 'a option =
        let field: obj = value?(name)
        if isNullOrUndefined field then None else Some(unbox field)
    let text value name = get<string> value name
    let complete (source: TaskCompletionSource<'a>) value =
        try source.SetResult value with _ -> ()
    let source<'a> () = TaskCompletionSource<'a>(TaskCreationOptions.RunContinuationsAsynchronously)
    let error reason = createObj [ "ok" ==> false; "error" ==> reason ]
    let view value = createObj [ "ok" ==> true; "value" ==> value ]
    let merged key = createObj [ "ok" ==> true; "mergedInto" ==> key ]
    let isOk value = get<bool> value "ok"
    [<Emit("$0($1)")>]
    let invoke1 (_callback: obj) (_value: obj) : 'a = jsNative
    [<Emit("$0($1,$2)")>]
    let invoke2 (_callback: obj) (_first: obj) (_second: obj) : 'a = jsNative
    [<Emit("$0($1,$2,$3)")>]
    let invoke3 (_callback: obj) (_first: obj) (_second: obj) (_third: obj) : 'a = jsNative

open InvocationValue

[<Sealed; AttachMembers>]
type DelegateInvocation(request: obj) =
    let completionSource = source<obj> ()
    let mutable startCursor: obj = null
    member _.request = request
    member _.completion = completionSource.Task
    member _.cursor with get () = startCursor and set value = startCursor <- value
    member _.finish(result: obj) = complete completionSource result

[<Sealed; AttachMembers>]
type DelegateCall(owner: string, scope: string, role: string, session: string, agent: string, invocations: DelegateInvocation array) =
    let admissionSource = source<string> ()
    let answerSource = source<obj> ()
    let resources = ResizeArray<unit -> unit>()
    let accepted = HashSet<string>()
    let mutable closed = false
    let mutable physical: string = null
    let mutable root: string = null
    let mutable terminalScope: obj = null
    member _.owner = owner
    member _.scope = scope
    member _.role = role
    member _.session = session
    member _.agent = agent
    member _.invocations = invocations
    member _.admission = admissionSource.Task
    member _.answer = answerSource.Task
    member _.acceptedPhysical with get () = physical and set value = physical <- value
    member _.acceptedRoot with get () = root and set value = root <- value
    member _.failureScope with get () = terminalScope and set value = terminalScope <- value
    member _.attach(dispose: unit -> unit) =
        if closed then dispose () else resources.Add dispose
    member _.accept(value: string, notify: unit -> unit) =
        if not closed then
            accepted.Add value |> ignore
            notify ()
    member _.owns(value: string) = not closed && accepted.Contains value
    member _.admit(value: string) = complete admissionSource value
    member _.finish(result: obj) = complete answerSource result
    member _.close() =
        let pending =
            if closed then [||]
            else
                closed <- true
                resources.ToArray()
        complete admissionSource null
        for dispose in pending do dispose ()

[<Sealed; AttachMembers>]
type DelegateInvocationRuntime() =
    let batches = SyncDelegateBatchStore.syncDelegateBatchStore
    let retired = RetiredDelegateRegistry.retiredDelegateRegistry
    let calls = Dictionary<string, DelegateCall>()
    let callKeys = Dictionary<DelegateCall, string>(HashIdentity.Reference)
    let invocations = Dictionary<string, DelegateInvocation>()
    let invocationKeys = Dictionary<DelegateInvocation, string>(HashIdentity.Reference)

    let invocationKey invocation =
        match invocationKeys.TryGetValue invocation with
        | true, key -> key
        | false, _ ->
            let key = Guid.NewGuid().ToString("N")
            invocationKeys.[invocation] <- key
            invocations.[key] <- invocation
            key

    let removeCall key =
        match calls.TryGetValue key with
        | false, _ -> None
        | true, call ->
            calls.Remove key |> ignore
            callKeys.Remove call |> ignore
            Some call

    let popResource key =
        if isNullOrUndefined key then null
        else
            match removeCall (unbox<string> key) with
            | None -> null
            | Some call -> call.close(); box call

    let reject reason =
        let message =
            match reason with
            | "ActiveBatch" -> "dedicated delegate already has an active batch"
            | "BatchPending" -> "semantic batch already pending"
            | "InvalidBatch" -> "invalid ProviderRun batch"
            | "OtherRunPending" -> "another ProviderRun batch is pending"
            | "DuplicateCall" -> "duplicate ToolCallId in batch"
            | other -> other
        "sync delegate rejected: " + message

    let failInvocation key reason =
        match invocations.TryGetValue key with
        | false, _ -> ()
        | true, invocation ->
            invocations.Remove key |> ignore
            invocationKeys.Remove invocation |> ignore
            invocation.finish(error reason)

    let failCallKey key reason =
        match removeCall key with
        | None -> ()
        | Some call -> call.close(); call.finish(error reason)

    let settleKeys settlement reason =
        for key in get<string array> settlement "cancelledInvocations" do failInvocation key reason
        for key in get<string array> settlement "cancelledCalls" do failCallKey key reason

    let completeBatch (items: DelegateInvocation array) result =
        if not (isOk result) then
            for item in items do item.finish result
        elif items.Length > 0 then
            items.[0].finish result
            let batch = optional<obj> items.[0].request "batch"
            let siblingResult =
                match batch with
                | Some value -> merged ((get<string array> value "callOrder").[0])
                | None -> error "sync delegate protocol defect: ungrouped invocation has siblings"
            for item in items |> Array.skip 1 do item.finish siblingResult

    member _.observeProviderToolCall(owner: string, run: string, role: string, call: string) =
        batches.observeProviderToolCall(owner, run, role, call)
    member _.tryObservedBatch(owner: string, run: string, role: string, call: string) =
        batches.tryObservedBatch(owner, run, role, call)
    member _.peek(session: string) : obj =
        let key: obj = box (batches.tryPeekCallByDelegate session)
        if isNullOrUndefined key then null
        else
            match calls.TryGetValue(unbox key) with
            | true, call -> box call
            | _ -> null
    member _.pop(session: string) : obj = batches.tryPopCallByDelegate session |> box |> popResource
    member _.popExact(call: DelegateCall) : obj =
        match callKeys.TryGetValue call with
        | false, _ -> null
        | true, key -> batches.tryPopExactCall(call.session, key) |> box |> popResource
    member _.fail(call: DelegateCall, reason: string) =
        call.close()
        match callKeys.TryGetValue call with
        | false, _ -> ()
        | true, key ->
            removeCall key |> ignore
            batches.tryPopExactCall(call.session, key) |> ignore
        call.finish(error reason)
    member _.admit(invocation: DelegateInvocation) =
        let request = invocation.request
        let key = invocationKey invocation
        let verdict = batches.admit(text request "scope", text request "role", key, optional<obj> request "batch")
        match text verdict "verdict" with
        | "reject" ->
            invocations.Remove key |> ignore
            invocationKeys.Remove invocation |> ignore
            createObj [ "kind" ==> "rejected"; "error" ==> reject (text verdict "reason") ]
        | "wait" -> createObj [ "kind" ==> "waiting" ]
        | kind ->
            let ready =
                if kind = "single" then [| invocation |]
                else
                    get<string array> verdict "invocations"
                    |> Array.choose (fun invKey ->
                        match invocations.TryGetValue invKey with
                        | true, value -> Some value
                        | _ -> None)
            createObj [ "kind" ==> "ready"; "invocations" ==> ready ]
    member _.releaseAdmission(scope: string, role: string) = batches.releaseAdmission(scope, role)
    member _.cancelScope(scope: string) =
        settleKeys (batches.cancelScope scope) "Sync delegate call was cancelled"
    member this.beginCall(owner: string, scope: string, role: string, session: string, agent: string, items: DelegateInvocation array) =
        let key = Guid.NewGuid().ToString("N")
        let keys = items |> Array.map invocationKey |> Array.toList
        let result = batches.beginCall(owner, scope, role, session, agent, keys, key)
        if not (isOk result) then result
        else
            let call = DelegateCall(owner, scope, role, session, agent, items)
            calls.[key] <- call
            callKeys.[call] <- key
            let dispose () =
                let removed = removeCall key |> Option.isSome
                batches.tryPopExactCall(session, key) |> ignore
                call.close()
                if removed then this.fail(call, "Sync delegate call scope disposed")
            createObj [ "ok" ==> true; "call" ==> call; "dispose" ==> dispose ]
    member _.takeRetired(scope: string) = retired.tryTake scope
    member _.getRetired(scope: string) = retired.tryGet scope
    member _.stageRetired(scope: string, session: string) = retired.stage(scope, session)
    member _.clearRetired(scope: string) = retired.clear scope
    member _.clear() =
        settleKeys (batches.clearAll()) "SyncDelegate runtime disposed"
        retired.clearAll()

    member this.observeTerminal(session: string, observation: obj) =
        let raw = this.peek session
        if not (isNullOrUndefined raw) then
            let call = unbox<DelegateCall> raw
            let scope = call.failureScope
            let kind = text observation "kind"
            let matches =
                not (isNullOrUndefined scope)
                && text scope "kind" = "root"
                && get<obj> observation "root" = get<obj> scope "root"
            if matches && (kind = "failed" || (kind = "aborted" && not (get<bool> observation "ownAbort"))) then
                let claimed = this.popExact call
                if not (isNullOrUndefined claimed) then
                    this.fail(call, "SyncDelegate run " + kind + ": " + text observation "reason")

    member this.matches(call: DelegateCall, observation: obj) =
        call.acceptedRoot = text observation "root"
        && call.owns(text observation "physical")

    member this.settleCompleted(observation: obj, effects: obj) : bool =
        let raw = this.peek(text observation "session")
        if isNullOrUndefined raw then false
        else
            let call = unbox<DelegateCall> raw
            if not (this.matches(call, observation)) then false
            else
                let delivered: obj = invoke1 (get effects "readDelivery") observation
                let material =
                    if not (isNullOrUndefined delivered) then Some(unbox<string> delivered)
                    elif text observation "outcome" = "completed" && get<bool> observation "hasParts" then
                        Some(text observation "naturalMaterial")
                    else None
                match material with
                | None -> false
                | Some record ->
                    let claimed = this.popExact call
                    if not (isNullOrUndefined claimed) then
                        for item in call.invocations do
                            match optional<obj> item.request "captureResponse" with
                            | None -> ()
                            | Some capture -> invoke1 capture (get observation "response")
                        if get<bool> call.invocations.[0].request "noteDraft" then
                            invoke3 (get effects "noteAnswer") (box call) observation (box record)
                        call.finish(view record)
                    true

    member this.handleTurn(observation: obj, effects: obj) : Task<bool> =
        task {
            let raw = this.peek(text observation "session")
            if isNullOrUndefined raw then return false
            else
                let call = unbox<DelegateCall> raw
                let outcome = text observation "outcome"
                if outcome = "failed" then
                    if not (get<bool> observation "hasFailure") || not (this.matches(call, observation)) then return false
                    else
                        let! retried = invoke2 (get effects "retry") (box call) observation
                        if isOk retried then return true
                        else
                            let! root = call.admission
                            if root <> text observation "root" || not (this.matches(call, observation)) then return false
                            else
                                let claimed = this.popExact call
                                if isNullOrUndefined claimed then return false
                                else
                                    this.fail(call, "SyncDelegate run failed: " + text retried "error")
                                    return true
                elif outcome <> "completed" && outcome <> "aborted" then return false
                elif call.invocations |> Array.exists (fun item -> isNullOrUndefined item.cursor) then return false
                else
                    let! root = call.admission
                    if root <> text observation "root" || not (this.matches(call, observation)) then return false
                    elif outcome = "aborted" then return this.settleCompleted(observation, effects)
                    else
                        let! captured = invoke1 (get effects "captureTerminal") observation
                        if text captured "kind" = "failed" then
                            let claimed = this.popExact call
                            if not (isNullOrUndefined claimed) then this.fail(call, text captured "error")
                            return true
                        else return this.settleCompleted(observation, effects)
        }

    member this.invoke(request: obj, effects: obj) : Task<obj> =
        let invocation = DelegateInvocation request
        let scope = text request "scope"
        let role = text request "role"
        let failAdmission items reason =
            this.releaseAdmission(scope, role)
            completeBatch items (error reason)
        let runReady (items: DelegateInvocation array) =
            task {
                let first = items.[0].request
                let owner = text first "owner"
                try
                    if get<bool> first "noteDraft" then
                        let deleted: obj = box (retired.tryTake scope)
                        if not (isNullOrUndefined deleted) then
                            invoke1 (get effects "cleanupDraft") deleted
                    let! attached = invoke1 (get effects "attach") first
                    if not (isOk attached) then failAdmission items (text attached "error")
                    else
                        let session = text attached "session"
                        let estimates = items |> Array.choose (fun item -> optional<int> item.request "estimate")
                        let estimate: obj = if estimates.Length = 0 then null else box (Array.sum estimates)
                        do! invoke2 (get effects "replaceEstimate") (box session) estimate
                        let prompts = ResizeArray<obj>()
                        for item in items do
                            let prepare = get<unit -> Task<obj>> item.request "prepare"
                            let! prompt =
                                task {
                                    try return! prepare ()
                                    with error ->
                                        if get<bool> item.request "observed" then return raise error
                                        else return invoke1 (get effects "fallbackPrompt") (box (text item.request "charge"))
                                }
                            prompts.Add prompt
                        let charge = items |> Array.map (fun item -> text item.request "charge") |> String.concat "\n\n"
                        let prompt: obj = invoke1 (get effects "combinePrompts") (box (prompts.ToArray()))
                        let bound: string = invoke1 (get effects "resolveAgent") (box session)
                        let agent = if isNullOrUndefined bound then text attached "agent" else bound
                        if items |> Array.exists (fun item -> (get<unit -> bool> item.request "isCancelled")()) then
                            failAdmission items "Sync delegate call was cancelled before dispatch"
                        else
                            let begun = this.beginCall(owner, scope, role, session, agent, items)
                            if not (isOk begun) then failAdmission items (text begun "error")
                            else
                                let call = get<DelegateCall> begun "call"
                                let dispose = get<unit -> unit> begun "dispose"
                                try
                                    let unsubscribe: unit -> unit = invoke1 (get effects "subscribe") (box call)
                                    let! answered =
                                        task {
                                            try
                                                let! sent = invoke3 (get effects "send") (box call) (box charge) prompt
                                                if not (isOk sent) then return sent
                                                else
                                                    if get<bool> first "noteDraft" then
                                                        invoke2 (get effects "notePrompt") (box session) (box charge)
                                                    return! invoke2 (get effects "awaitView") (box call) (box call.answer)
                                            finally unsubscribe ()
                                        }
                                    this.releaseAdmission(scope, role)
                                    dispose ()
                                    completeBatch items answered
                                finally dispose ()
                with error -> failAdmission items error.Message
            }
        task {
            let admitted = this.admit invocation
            match text admitted "kind" with
            | "rejected" -> invocation.finish(error (text admitted "error"))
            | "ready" -> do! runReady (get admitted "invocations")
            | _ -> ()
            return! invoke2 (get effects "awaitInvocation") request (box invocation.completion)
        }
