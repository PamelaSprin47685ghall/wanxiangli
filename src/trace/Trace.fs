module Wanxiangli.Trace.Trace

open System.Collections.Generic
open Fable.Core
open Wanxiangli.Trace
open Wire

[<AllowNullLiteral>]
type TraceMessages =
    abstract capture: observation: obj -> obj
    abstract inspect: unit -> obj
    abstract records: unit -> string array
    abstract head: unit -> obj
    abstract cut: cursor: float -> obj
    abstract read: after: obj * through: obj -> obj array
    abstract materialize: after: obj * through: obj -> obj

type private Message(info: MessageInfo, cursor: int) =
    let parts = ResizeArray<int * PartInfo>()
    member _.Info = info
    member _.Cursor = cursor
    member _.Parts = parts
    member val Finished: int option = None with get, set

type private Run() =
    let messages = ResizeArray<Message>()
    member _.Messages = messages
    member val Finished: (int * string) option = None with get, set

type private Entry =
    { Fact: Observation; Encoded: string; Record: string; Digest: string }

let Trace (traceId: string) (initialRecords: obj): TraceMessages =
    let traceId = identifier (box traceId)
    let genesis = sha256 (stringify (box [| "trace-origin-v1"; traceId |]))
    let entries = ResizeArray<Entry>()
    let seen = Dictionary<string, int>()
    let messages = Dictionary<string, Message>()
    let messageOrder = ResizeArray<Message>()
    let runs = Dictionary<string, Run>()
    let mutable opening: string option = None
    let mutable byteCount = 0.
    let mutable busy = false

    let guard action =
        require (not busy) "Trace does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let digestAt cursor = if cursor = 0 then genesis else entries[cursor - 1].Digest
    let cutAt cursor = make [ "traceId", box traceId; "cursor", box cursor; "digest", box (digestAt cursor) ]

    let findMessage id =
        match messages.TryGetValue id with
        | true, message -> message
        | _ -> invalidOp "Message has not been observed"

    let findRun id =
        match runs.TryGetValue id with
        | true, run -> run
        | _ -> invalidOp "Run has not been started"

    let requireActive (message: Message) =
        require message.Finished.IsNone "Message is already finished"
        match message.Info.Run with
        | Some id -> require (findRun id).Finished.IsNone "Run is already finished"
        | None -> ()

    // 先验证所有条件，最后才执行这一个内存提交；没有外部回调或服务。
    let prepare fact cursor =
        match fact with
        | Observation.Opening data ->
            require (entries.Count = 0 && opening.IsNone) "Opening must be the first observation"
            fun () ->
                opening <- Some data
                byteCount <- byteCount + float (bytes data).Length
        | Observation.RunStarted id ->
            require (not (runs.ContainsKey id)) "Run identity already exists"
            let run = Run()
            fun () -> runs.Add(id, run)
        | Observation.MessageObserved info ->
            require (not (messages.ContainsKey info.Id)) "Message identity already exists"
            let run = info.Run |> Option.map findRun
            run |> Option.iter (fun value -> require value.Finished.IsNone "Run is already finished")
            let message = Message(info, cursor)
            fun () ->
                messages.Add(info.Id, message)
                messageOrder.Add message
                run |> Option.iter (fun value -> value.Messages.Add message)
        | Observation.PartConfirmed part ->
            let message = findMessage part.Message
            requireActive message
            require (part.Index = float message.Parts.Count) "Part index must be the next consecutive index"
            require (part.Kind <> "tool-call" || message.Info.Role = "assistant") "Tool calls belong to assistant messages"
            require (part.Kind <> "tool-result" || message.Info.Role = "tool") "Tool results belong to tool messages"
            fun () ->
                message.Parts.Add(cursor, part)
                byteCount <- byteCount + float (bytes part.Base64).Length
        | Observation.MessageFinished(id, count) ->
            let message = findMessage id
            requireActive message
            require (count = float message.Parts.Count) "Message part count does not match"
            fun () -> message.Finished <- Some cursor
        | Observation.RunFinished(id, outcome) ->
            let run = findRun id
            require run.Finished.IsNone "Run is already finished"
            require (run.Messages |> Seq.forall (fun message -> message.Finished.IsSome)) "Run has unfinished messages"
            fun () -> run.Finished <- Some(cursor, outcome)

    let envelope fact cursor previous =
        make [ "traceId", box traceId; "cursor", box cursor; "previous", box previous; "observation", Observation.encode fact ]

    let fullRecord unsigned digest =
        make [ "traceId", field unsigned "traceId"; "cursor", field unsigned "cursor"
               "previous", field unsigned "previous"; "observation", field unsigned "observation"; "digest", box digest ]
        |> canonical

    let accept fact encoded record digest apply =
        apply ()
        entries.Add { Fact = fact; Encoded = encoded; Record = record; Digest = digest }
        seen.Add(Observation.key fact, entries.Count)

    let restore record =
        let record = text record
        require (byteLength record <= 1048576) "Trace record exceeds 1 MiB"
        let frame = parse record
        exact [ "traceId"; "cursor"; "previous"; "observation"; "digest" ] frame
        require (canonical frame = record) "Noncanonical trace record"
        require (identifier (field frame "traceId") = traceId) "Foreign trace record"
        let cursor = index (field frame "cursor")
        require (cursor = float (entries.Count + 1)) "Trace cursor gap"
        require (text (field frame "previous") = digestAt entries.Count) "Trace chain mismatch"
        let fact = Observation.decode true (field frame "observation")
        require (not (seen.ContainsKey (Observation.key fact))) "Duplicate observation in history"
        let unsigned = envelope fact (entries.Count + 1) (digestAt entries.Count)
        let digest = sha256 (canonical unsigned)
        require (text (field frame "digest") = digest && fullRecord unsigned digest = record) "Trace digest mismatch"
        let apply = prepare fact (entries.Count + 1)
        accept fact (canonical (Observation.encode fact)) record digest apply

    do
        if not (Fable.Core.JsInterop.isNullOrUndefined initialRecords) then
            initialRecords |> array |> Array.iter restore

    let capture input =
        guard (fun () ->
            let fact = Observation.decode false input
            let encoded = canonical (Observation.encode fact)
            match seen.TryGetValue (Observation.key fact) with
            | true, cursor ->
                let entry = entries[cursor - 1]
                require (entry.Encoded = encoded) "Observation identity conflict"
                make [ "status", box "Replayed"; "cursor", box cursor; "record", box entry.Record ]
            | _ ->
                require (entries.Count < 2147483646) "Trace cursor capacity exceeded"
                let cursor = entries.Count + 1
                let apply = prepare fact cursor
                let unsigned = envelope fact cursor (digestAt entries.Count)
                let digest = sha256 (canonical unsigned)
                let record = fullRecord unsigned digest
                require (byteLength record <= 1048576) "Trace record exceeds 1 MiB"
                accept fact encoded record digest apply
                make [ "status", box "Appended"; "cursor", box cursor; "record", box record ])

    let checkedIndex value =
        let position = index value
        require (position <= float entries.Count) "Cut is beyond the trace head"
        int position

    let checkedCut value =
        exact [ "traceId"; "cursor"; "digest" ] value
        require (text (field value "traceId") = traceId) "Foreign trace cut"
        let cursor = checkedIndex (field value "cursor")
        require (text (field value "digest") = digestAt cursor) "Cut does not match this trace prefix"
        cursor

    let interval after through =
        let first, last = checkedCut after, checkedCut through
        require (first <= last) "Trace interval is reversed"
        first, last

    let readRange first last =
        Array.init (last - first) (fun offset ->
            let cursor = first + offset + 1
            make [ "cursor", box cursor; "observation", Observation.view entries[cursor - 1].Fact ])

    let messageView through (message: Message) =
        let parts =
            message.Parts
            |> Seq.filter (fun (cursor, _) -> cursor <= through)
            |> Seq.map (fun (cursor, part) ->
                make [ "partId", box part.Id; "index", box part.Index; "kind", box part.Kind
                       "cursor", box cursor; "content", content part.Base64 ])
            |> Seq.toArray
        make [ "messageId", box message.Info.Id; "role", box message.Info.Role; "origin", box message.Info.Origin
               "runId", message.Info.Run |> Option.map box |> Option.defaultValue null
               "firstCursor", box message.Cursor; "finished", box (message.Finished |> Option.exists (fun cursor -> cursor <= through))
               "parts", box parts ]

    let materialize after through =
        guard (fun () ->
            let first, last = interval after through
            let selected = messageOrder |> Seq.filter (fun message -> message.Cursor > first && message.Cursor <= last) |> Seq.toArray
            let originals = messageOrder |> Seq.filter (fun message -> message.Cursor <= last && message.Info.Origin = "human") |> Seq.map (messageView last) |> Seq.toArray
            let statement =
                selected |> Array.rev |> Array.tryPick (fun message ->
                    if message.Info.Role <> "assistant" || not (message.Finished |> Option.exists (fun cursor -> cursor <= last)) then None
                    else
                        let texts = message.Parts |> Seq.choose (fun (cursor, part) -> if cursor <= last && part.Kind = "text" then Some(bytes part.Base64) else None) |> Seq.toArray
                        if texts.Length = 0 then None
                        else
                            let raw = Array.concat texts
                            // 散文可能超过单个部件上限；这里只合并视图，不重新捕获事实。
                            let data =
                                [ "messageId", box message.Info.Id
                                  "partIds", box (message.Parts |> Seq.choose (fun (_, part) -> if part.Kind = "text" then Some part.Id else None) |> Seq.toArray)
                                  "content", contentBytes raw ]
                            Some(make data))
            make [ "after", cutAt first; "through", cutAt last
                   "opening", (if last = 0 then null else opening |> Option.map content |> Option.defaultValue null)
                   "messages", box (selected |> Array.map (messageView last))
                   "originals", box originals; "statement", statement |> Option.defaultValue null ])

    { new TraceMessages with
        member _.capture(input) = capture input
        member _.inspect() = guard (fun () -> make [ "traceId", box traceId; "cursor", box entries.Count; "messages", box messages.Count; "runs", box runs.Count; "bytes", box byteCount ])
        member _.records() = guard (fun () -> entries |> Seq.map (fun entry -> entry.Record) |> Seq.toArray)
        member _.head() = guard (fun () -> cutAt entries.Count)
        member _.cut(cursor) = guard (fun () -> checkedIndex (box cursor) |> cutAt)
        member _.read(after, through) = guard (fun () -> let first, last = interval after through in readRange first last)
        member _.materialize(after, through) = materialize after through }
