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

    [<Emit("$0 != null && typeof $0 === 'object' && Object.keys($0).sort().join(',') === 'reason,revision,status' && typeof $0.status === 'string' && Number.isSafeInteger($0.revision) && $0.revision >= 0 && ($0.reason === null || typeof $0.reason === 'string')")>]
    let isAcknowledgement (_value: obj): bool = jsNative

    let require condition message = if not condition then invalidOp message

    let create (workId: string) (records: string array): WorkMessages =
        createNew work (workId, records) |> unbox

    let response (status: string) (revision: float) (result: obj) (reason: obj): obj =
        createObj [ "status" ==> status; "revision" ==> revision; "result" ==> result; "reason" ==> reason ]

let DurableWork (workId: string) (journal: Journal): WorkMessages =
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

    let recover (): obj =
        guard (fun () ->
            match unknownRequest with
            | Some requestId -> createObj [ "next" ==> "ObserveCommit"; "requestId" ==> requestId; "state" ==> (null: obj) ]
            | None -> (load ()).recover())

    let execute (requestId: string, input: obj): obj =
        guard (fun () ->
            let candidate = load ()
            let proposal = candidate.execute(requestId, input)
            let status: string = proposal?status
            let revision: float = proposal?revision
            let result: obj = proposal?result
            if status <> "Applied" then
                Protocol.response status revision result (null: obj)
            else
                // Work 已验证输入；组合者保留自己的消息副本供竞争后的重放使用。
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
                        let replayRevision: float = replay?revision
                        let replayResult: obj = replay?result
                        Protocol.response "Replayed" replayRevision replayResult (null: obj)
                    | "Conflict" | "NotWritten" -> Protocol.response outcome expected (null: obj) reason
                    | "Unknown" -> unknown reason
                    | _ -> unknown (box "Unknown journal acknowledgement")
                with error -> unknown (box error.Message))

    { new WorkMessages with
        member _.inspect() = inspect ()
        member _.history() = history ()
        member _.records() = records ()
        member _.recover() = recover ()
        member _.execute(requestId, input) = execute (requestId, input) }
