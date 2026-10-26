module Wanxiangli.Assembly.DurableWork

open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type Journal =
    abstract read: stream: string -> string array
    abstract append: stream: string * expectedRevision: float * requestId: string * body: string -> obj

[<AllowNullLiteral>]
type WorkMessages =
    abstract execute: requestId: string * command: obj -> obj
    abstract inspect: unit -> obj
    abstract history: unit -> obj array
    abstract records: unit -> string array
    abstract recover: unit -> obj

module private Protocol =
    [<Import("Work", "wanxiangli/work")>]
    let work: obj = jsNative

    [<Emit("JSON.parse(JSON.stringify($0))")>]
    let copy (_value: obj): obj = jsNative

    [<Emit("$0 != null && typeof $0.read === 'function' && typeof $0.append === 'function'")>]
    let isJournal (_value: obj): bool = jsNative

    [<Emit("$0 == null")>]
    let missing (_value: obj): bool = jsNative

    [<Emit("$0 != null && typeof $0 === 'object' && Object.keys($0).sort().join(',') === 'reason,revision,status' && typeof $0.status === 'string' && Number.isSafeInteger($0.revision) && $0.revision >= 0 && ($0.reason === null || typeof $0.reason === 'string')")>]
    let isAcknowledgement (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'string' && $0.length > 0")>]
    let isText (_value: obj): bool = jsNative

    [<Emit("$0.type")>]
    let commandType (_value: obj): string = jsNative

    [<Emit("$0.kind")>]
    let kind (_value: obj): string = jsNative

    [<Emit("$0.phase")>]
    let phase (_value: obj): string = jsNative

    [<Emit("$0.id")>]
    let effectId (_value: obj): string = jsNative

    [<Emit("$0 != null && (typeof $0 === 'object' || typeof $0 === 'function') && typeof $0.then === 'function'")>]
    let isThenable (_value: obj): bool = jsNative

    [<Emit("$0.then($1)")>]
    let continueWith (_promise: obj) (_step: obj -> obj): obj = jsNative

    let require condition message = if not condition then invalidOp message

    /// A synchronous port result continues immediately. A thenable is awaited,
    /// and a thenable returned by the continuation is flattened by Promise.
    let flatten (produced: obj) (step: obj -> obj): obj =
        if isThenable produced then continueWith produced step else step produced

    let create (workId: string) (records: string array): WorkMessages =
        createNew work (workId, records) |> unbox

    let response (status: string) (revision: float) (result: obj) (reason: obj): obj =
        createObj [ "status" ==> status; "revision" ==> revision; "result" ==> result; "reason" ==> reason ]

    let confirmId effectId outcome session =
        match session with
        | Some value -> "confirm:" + effectId + ":" + outcome + ":" + value
        | None -> "confirm:" + effectId + ":" + outcome

    let confirmCommand effectId outcome session reason =
        let fields =
            [ "type" ==> "Confirm"; "effectId" ==> effectId; "outcome" ==> outcome ]
            @ match session with Some value -> [ "execSessionId" ==> value ] | None -> []
            @ match reason with Some value -> [ "reason" ==> value ] | None -> []
        createObj fields

let DurableWork (workId: string) (journal: Journal) (effects: obj): WorkMessages =
    do
        Protocol.require (Protocol.isJournal (box journal)) "A journal is required by the composition"
        Protocol.create workId [||] |> ignore

    let mutable busy = false
    let mutable unknownRequest: string option = None

    let guard action =
        Protocol.require (not busy) "DurableWork does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let requireKnown () =
        Protocol.require unknownRequest.IsNone "Previous commit is unknown; reopen the journal and composition before reconciliation"

    let load () =
        requireKnown ()
        Protocol.create workId (journal.read workId)

    let inspect () = guard (fun () -> (load ()).inspect())
    let history () = guard (fun () -> (load ()).history())
    let records () = guard (fun () -> (load ()).records())

    let commit (requestId: string, input: obj): obj =
        guard (fun () ->
            let candidate = load ()
            let proposal = candidate.execute(requestId, input)
            let status: string = proposal?status
            let revision: float = proposal?revision
            let result: obj = proposal?result
            if status <> "Applied" then
                let reason: obj = if status = "Conflict" then proposal?reason else null
                Protocol.response status revision result reason
            else
                let command = Protocol.copy input
                let body: string = proposal?record
                let expected = revision - 1.
                let unknown (reason: obj) =
                    unknownRequest <- Some requestId
                    Protocol.response "Unknown" expected (null: obj) reason
                try
                    let acknowledgement = journal.append(workId, expected, requestId, body)
                    Protocol.require (Protocol.isAcknowledgement acknowledgement) "Invalid journal acknowledgement"
                    let outcome: string = acknowledgement?status
                    let committedRevision: float = acknowledgement?revision
                    let reason: obj = acknowledgement?reason
                    match outcome with
                    | "Committed" ->
                        Protocol.require (committedRevision = revision) "Unexpected commit revision"
                        Protocol.response "Committed" revision result (null: obj)
                    | "Replayed" ->
                        let records = journal.read workId
                        Protocol.require (committedRevision >= 1. && committedRevision <= float records.Length) "Replay revision is absent"
                        Protocol.require (records[int committedRevision - 1] = body) "Replay record differs"
                        let replay = (Protocol.create workId records).execute(requestId, command)
                        let replayStatus: string = replay?status
                        Protocol.require (replayStatus = "Replayed") "Replay receipt is absent"
                        Protocol.response "Replayed" (unbox<float> replay?revision) replay?result (null: obj)
                    | "Conflict" | "NotWritten" -> Protocol.response outcome expected (null: obj) reason
                    | "Unknown" -> unknown reason
                    | _ -> unknown (box "Unknown journal acknowledgement")
                with error -> unknown (box error.Message))

    let accepted reply =
        let status: string = reply?status
        status = "Committed" || status = "Replayed"

    let confirm effectId outcome session reason =
        accepted (commit (Protocol.confirmId effectId outcome session, Protocol.confirmCommand effectId outcome session reason))

    let textOf value name =
        Protocol.require (Protocol.isText value) name
        unbox<string> value

    let useText (produced: obj) (name: string) (allowed: string -> bool) (refusal: string) (apply: string -> obj): obj =
        Protocol.flatten produced (fun value ->
            let outcome = textOf value name
            Protocol.require (allowed outcome) refusal
            apply outcome)

    let perform effect =
        let id = Protocol.effectId effect

        let finish outcome session reason =
            box (confirm id outcome session reason)

        match Protocol.kind effect with
        | "Ask" ->
            useText (effects?ask effect) "Ask outcome must be text" (fun outcome -> outcome = "Parked" || outcome = "Unknown") "Ask outcome is not Parked or Unknown" (fun outcome ->
                finish outcome None None)
        | "Dispatch" ->
            useText (effects?dispatch effect) "Dispatch outcome must be text" (fun outcome -> outcome = "Sent" || outcome = "Unknown") "Dispatch outcome is not Sent or Unknown" (fun outcome ->
                finish outcome None None)
        | "Stop" ->
            useText (effects?stop effect) "Stop outcome must be text" (fun outcome -> outcome = "Requested" || outcome = "Unknown") "Stop outcome is not Requested or Unknown" (fun outcome ->
                finish outcome None None)
        | "Launch" ->
            match Protocol.phase effect with
            | "Create" ->
                Protocol.flatten (effects?createSession effect) (fun receipt ->
                    Protocol.require (not (isNull receipt)) "createSession receipt is missing"

                    match unbox<string> receipt?status with
                    | "SessionCreated" ->
                        let session = textOf receipt?execSessionId "Session id must be text"

                        if not (confirm id "SessionCreated" (Some session) None) then
                            box false
                        else
                            let pending: obj = ((load ()).recover())?effect
                            Protocol.require (not (isNull pending) && Protocol.effectId pending = id && Protocol.phase pending = "Send") "Bound launch did not become sendable"

                            useText (effects?sendDraft pending) "Admission outcome must be text" (fun sent -> sent = "Admitted" || sent = "Unknown") "Admission outcome is not Admitted or Unknown" (fun sent ->
                                if sent = "Admitted" then
                                    finish "Admitted" (Some session) None
                                else
                                    finish "Unknown" None None)
                    | "Unknown" -> finish "Unknown" None None
                    | "NotStarted" ->
                        let reason = textOf receipt?reason "Refusal reason must be text"
                        finish "NotStarted" None (Some reason)
                    | _ ->
                        Protocol.require false "Unknown session receipt"
                        box false)
            | "Send" ->
                useText (effects?sendDraft effect) "Admission outcome must be text" (fun sent -> sent = "Admitted" || sent = "Unknown") "Admission outcome is not Admitted or Unknown" (fun sent ->
                    if sent = "Admitted" then
                        finish "Admitted" (Some(textOf effect?execSessionId "Bound session id must be text")) None
                    else
                        finish "Unknown" None None)
            | _ ->
                Protocol.require false "Launch phase is not executable"
                box false
        | _ ->
            Protocol.require false "Unknown effect"
            box false

    let unchanged previous current =
        not (isNull previous) && not (isNull current)
        && Protocol.effectId previous = Protocol.effectId current
        && Protocol.kind previous = Protocol.kind current
        && Protocol.phase previous = Protocol.phase current

    let rec fill effect =
        Protocol.flatten (perform effect) (fun ok ->
            if unbox<bool> ok then
                let next: obj = (guard (fun () -> (load ()).recover()))?effect
                if isNull next || unchanged effect next then box true else fill next
            else
                box false)

    let committedEffect reply input =
        if Protocol.missing effects then None
        elif unbox<string> reply?status <> "Committed" then None
        elif isNull reply?result || Protocol.commandType input = "Confirm" then None
        else
            let effect: obj = reply?result?effect
            if isNull effect then None else Some effect

    let afterFill reply ok =
        if unbox<bool> ok then
            reply
        else
            Protocol.response "Unknown" (unbox<float> reply?revision - 1.) (null: obj) (box "Effect confirmation is unknown")

    let execute (requestId: string, input: obj): obj =
        let reply = commit (requestId, input)

        match committedEffect reply input with
        | None -> reply
        | Some effect -> Protocol.flatten (fill effect) (afterFill reply)

    let recover (): obj =
        let current =
            guard (fun () ->
                match unknownRequest with
                | Some requestId -> createObj [ "next" ==> "ObserveCommit"; "requestId" ==> requestId; "state" ==> (null: obj) ]
                | None -> (load ()).recover())

        if unknownRequest.IsSome || Protocol.missing effects then
            current
        else
            let effect: obj = current?effect

            if isNull effect then
                current
            else
                Protocol.flatten (fill effect) (fun ok ->
                    if unbox<bool> ok then
                        guard (fun () -> (load ()).recover())
                    else
                        createObj [ "next" ==> "ObserveCommit"; "requestId" ==> defaultArg unknownRequest ""; "state" ==> (null: obj) ])

    { new WorkMessages with
        member _.inspect() = inspect ()
        member _.history() = history ()
        member _.records() = records ()
        member _.recover() = recover ()
        member _.execute(requestId, input) = execute (requestId, input) }
