module Wanxiangli.Trace.Trace

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
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

module private History =
    [<Literal>]
    let ChunkBytes = 524288
    [<Emit("new TextEncoder().encode($0)")>]
    let encode (_text: string) : byte array = jsNative
    [<Emit("$0.slice($1, $2)")>]
    let sliceBytes (_bytes: byte array) (_first: int) (_last: int) : byte array = jsNative
    [<Emit("Buffer.concat($0.map(c => Buffer.from(c))).toString('utf8')")>]
    let decode (_chunks: byte array array) : string = jsNative
    [<Emit("$0[$1]")>]
    let get (_value: obj) (_name: string) : obj = jsNative
    [<Emit("$0 == null")>]
    let absent (_value: obj) : bool = jsNative
    let stringField value name = unbox<string> (get value name)
    let sequence value = unbox<int64> (get value "sequence")
    let textOption value = if absent value then None else Some(unbox<string> value)
    let result value = createObj [ "ok" ==> true; "value" ==> value ]
    let error value = createObj [ "ok" ==> false; "error" ==> value ]
    let rejected kind = error (createObj [ "kind" ==> kind ])
    let inside first last sequence = sequence >= first && sequence < last
    let endpoints range = unbox<int64> (get range "start"), unbox<int64> (get range "end")
    let range first last = createObj [ "start" ==> first; "end" ==> last ]

    type Opening = { Assignment: string; Requirements: string list }
    type Part =
        { Sequence: int64
          Role: string
          Kind: string
          ToolName: string option
          BodyRef: string
          BodyDigest: string
          Descriptor: string
          Metadata: obj }
    type Terminal = { ProviderRun: string; BodyRef: string; BodyDigest: string; Frontier: int64 }
    type State =
        { TraceId: string
          Records: string list
          OpeningCut: int
          PartCuts: (int64 * int) list
          RecordCount: int
          Opening: Opening option
          Parts: Part list
          Terminals: Terminal list }

    let private cache: obj = emitJsExpr () "new WeakMap()"
    [<Emit("$0.get($1)")>]
    let private cached (_cache: obj) (_state: State) : TraceMessages = jsNative
    [<Emit("$0.set($1, $2)")>]
    let private attach (_cache: obj) (_state: State) (_trace: TraceMessages) : unit = jsNative
    [<Emit("$0.delete($1)")>]
    let private detach (_cache: obj) (_state: State) : unit = jsNative
    let count (trace: TraceMessages) = unbox<int> (get (trace.inspect()) "cursor")
    let attachTrace state trace = attach cache state trace; state
    let newTrace traceId records = Trace traceId (box (List.rev records |> List.toArray))
    let readable state =
        let trace = cached cache state
        if not (isNull trace) && count trace = state.RecordCount then trace
        else
            let trace = newTrace state.TraceId state.Records
            attach cache state trace
            trace
    let writable state =
        let trace = cached cache state
        if not (isNull trace) && count trace = state.RecordCount then
            detach cache state
            trace
        else newTrace state.TraceId state.Records
    let empty traceId =
        let trace = Trace traceId (null: obj)
        attachTrace { TraceId = traceId; Records = []; OpeningCut = 0; PartCuts = []; RecordCount = 0; Opening = None; Parts = []; Terminals = [] } trace
    let appendRecords state trace added =
        attachTrace { state with Records = List.fold (fun records record -> record :: records) state.Records added; RecordCount = count trace } trace
    let capture (trace: TraceMessages) observation = trace.capture observation |> fun result -> stringField result "record"
    let boundedBytes raw =
        let encoded = encode raw
        if encoded.Length <= ChunkBytes then encoded else sliceBytes encoded 0 ChunkBytes
    let chunks raw =
        let bytes = encode raw
        if bytes.Length = 0 then [| bytes |]
        else Array.init ((bytes.Length + ChunkBytes - 1) / ChunkBytes) (fun index ->
            let first = index * ChunkBytes
            sliceBytes bytes first (min bytes.Length (first + ChunkBytes)))
    let captureOpening trace raw = capture trace (createObj [ "type" ==> "Opening"; "bytes" ==> boundedBytes raw ])
    let roleAndOrigin role kind run =
        match kind, role with
        | "tool_call", _ | "tool-call", _ -> "assistant", "provider", Some run
        | "tool_result", _ | "tool-result", _ -> "tool", "provider", Some run
        | _, "user" -> "user", "human", None
        | _, "system" -> "system", "host-internal", None
        | _ -> "assistant", "provider", Some run
    let partKind = function "text" -> "text" | "tool_call" | "tool-call" -> "tool-call" | "tool_result" | "tool-result" -> "tool-result" | _ -> "binary"
    let captureMessage trace message role origin run prefix kind payload =
        let started = run |> Option.map (fun id -> [ capture trace (createObj [ "type" ==> "RunStarted"; "runId" ==> id ]) ]) |> Option.defaultValue []
        let observed = capture trace (createObj [ "type" ==> "MessageObserved"; "messageId" ==> message; "role" ==> role; "origin" ==> origin; "runId" ==> (run |> Option.map box |> Option.defaultValue null) ])
        let parts = chunks payload
        let added = parts |> Array.mapi (fun index bytes ->
            capture trace (createObj [ "type" ==> "PartConfirmed"; "messageId" ==> message;
                                      "partId" ==> sprintf "%s/c:%d" prefix index; "index" ==> index; "kind" ==> kind; "bytes" ==> bytes ])) |> Array.toList
        let finished = capture trace (createObj [ "type" ==> "MessageFinished"; "messageId" ==> message; "partCount" ==> parts.Length ])
        let ended = run |> Option.map (fun id -> [ capture trace (createObj [ "type" ==> "RunFinished"; "runId" ==> id; "outcome" ==> "Completed" ]) ]) |> Option.defaultValue []
        started @ (observed :: added) @ (finished :: ended)
    let appendPartRecords (part: Part) state =
        let trace = writable state
        let run = sprintf "xrun-%d" part.Sequence
        let role, origin, run = roleAndOrigin part.Role part.Kind run
        let added = captureMessage trace (sprintf "xmsg-%d" part.Sequence) role origin run (sprintf "p:%d" part.Sequence) (partKind part.Kind) part.Descriptor
        appendRecords { state with PartCuts = (part.Sequence, count trace) :: state.PartCuts } trace added
    let appendTerminalRecords (terminal: Terminal) state =
        let trace = writable state
        let ordinal = state.RecordCount + 1
        let payload = sprintf "terminal|%s|%s|%s|%d" terminal.ProviderRun terminal.BodyRef terminal.BodyDigest terminal.Frontier
        let added = captureMessage trace (sprintf "xterm-msg-%d" ordinal) "assistant" "provider" (Some(sprintf "xterm-run-%d" ordinal)) "term" "binary" payload
        appendRecords state trace added
    let appendOpeningRecords opening state =
        let payload = sprintf "assignment:%d:%s\n%s" opening.Assignment.Length opening.Assignment (String.concat "\n" opening.Requirements)
        let trace = if List.isEmpty state.Parts && List.isEmpty state.Terminals then writable state else Trace state.TraceId (null: obj)
        let record = captureOpening trace payload
        let seeded = attachTrace { state with Records = [record]; OpeningCut = count trace; PartCuts = []; RecordCount = count trace } trace
        let withParts = List.rev state.Parts |> List.fold (fun current part -> appendPartRecords part current) seeded
        List.rev state.Terminals |> List.fold (fun current terminal -> appendTerminalRecords terminal current) withParts
    let headSequence state = match state.Parts with part :: _ -> part.Sequence | [] -> 0L
    let head state = match state.Parts with part :: _ -> part.Sequence + 1L | [] -> 0L
    let checkedCursor sequence =
        if sequence < 0L then invalidArg "sequence" "XTrace cursor sequence cannot be negative"
        sequence
    let before sequence state = state.PartCuts |> List.tryFind (fun (value, _) -> value < sequence) |> Option.map snd |> Option.defaultValue state.OpeningCut
    let cutAt sequence state =
        let position =
            if sequence <= 0L then state.OpeningCut
            else state.PartCuts |> List.tryFind (fun (value, _) -> value <= sequence) |> Option.map snd |> Option.defaultValue state.OpeningCut
        (readable state).cut(float position)
    let interval range state =
        let first, last = endpoints range
        let trace = readable state
        trace.cut(float (before first state)), trace.cut(float (before last state))
    let intervalView (after, through) = createObj [ "after" ==> after; "through" ==> through ]
    let partFrom input =
        { Sequence = sequence input; Role = stringField input "role"; Kind = stringField input "kind"
          ToolName = get input "toolName" |> textOption; BodyRef = stringField input "bodyRef"
          BodyDigest = stringField input "bodyDigest"; Descriptor = stringField input "descriptor"; Metadata = get input "metadata" }
    let partView (part: Part) = createObj [ "sequence" ==> part.Sequence; "role" ==> part.Role; "kind" ==> part.Kind;
                                         "toolName" ==> (part.ToolName |> Option.map box |> Option.defaultValue null);
                                         "bodyRef" ==> part.BodyRef; "bodyDigest" ==> part.BodyDigest; "descriptor" ==> part.Descriptor; "metadata" ==> part.Metadata ]
    let terminalView (terminal: Terminal) = createObj [ "providerRun" ==> terminal.ProviderRun; "bodyRef" ==> terminal.BodyRef; "bodyDigest" ==> terminal.BodyDigest; "frontier" ==> terminal.Frontier ]
    let openingView opening = createObj [ "assignment" ==> opening.Assignment; "requirements" ==> List.toArray opening.Requirements; "constitutiveBody" ==> "" ]
    let restate state next = attachTrace next (writable state)
    let semanticText kind text = createObj [ "kind" ==> kind; "text" ==> text ]
    let semanticTool name args = createObj [ "kind" ==> "tool_call"; "name" ==> name; "args" ==> args ]
    let semanticMedia mediaType digest = createObj [ "kind" ==> "media"; "mediaType" ==> mediaType; "digest" ==> digest ]
    let item sequence role part metadata = createObj [ "sequence" ==> sequence; "role" ==> role; "part" ==> part; "metadata" ==> metadata ]
    let itemPayload part =
        match stringField part "kind" with
        | "text" -> "text", "text", stringField part "text"
        | "reasoning" -> "binary", "reasoning", stringField part "text"
        | "tool_result" -> "tool-result", "tool_result", stringField part "text"
        | "tool_call" ->
            let name = stringField part "name"
            "tool-call", "tool_call", sprintf "%d:%s\n%s" name.Length name (stringField part "args")
        | "media" ->
            let digest = stringField part "digest"
            match get part "mediaType" |> textOption with
            | Some mediaType -> "binary", "media", sprintf "1:%d:%s\n%s" mediaType.Length mediaType digest
            | None -> "binary", "media", sprintf "0:0:\n%s" digest
        | kind -> invalidArg "part" (sprintf "Unknown semantic part kind: %s" kind)
    let decodeItem tag (raw: string) =
        match tag with
        | "tool_call" ->
            let colon = raw.IndexOf(':')
            let length = Int32.Parse(raw.Substring(0, colon))
            semanticTool (raw.Substring(colon + 1, length)) (raw.Substring(colon + length + 2))
        | "media" ->
            let firstColon = raw.IndexOf(':')
            let hasMedia = raw.Substring(0, firstColon) = "1"
            let rest = raw.Substring(firstColon + 1)
            let secondColon = rest.IndexOf(':')
            let length = Int32.Parse(rest.Substring(0, secondColon))
            let mediaType = rest.Substring(secondColon + 1, length)
            semanticMedia (if hasMedia then box mediaType else null) (rest.Substring(secondColon + length + 2))
        | "reasoning" | "tool_result" -> semanticText tag raw
        | _ -> semanticText "text" raw
    let partTag (partId: string) =
        if partId.StartsWith("k:", StringComparison.Ordinal) then
            let slash = partId.IndexOf('/')
            if slash > 2 then partId.Substring(2, slash - 2) else "text"
        else "text"
    let reconstruct (items: obj array) message =
        let messageId = stringField message "messageId"
        let parsed, ordinal =
            if messageId.StartsWith("xmsg-", StringComparison.Ordinal) then Int32.TryParse(messageId.Substring(5))
            else false, 0
        if not parsed || ordinal < 0 || ordinal >= items.Length then None
        else
            let original = items[ordinal]
            let parts = unbox<obj array> (get message "parts") |> Array.sortBy (fun part -> unbox<int> (get part "index"))
            let raw = parts |> Array.map (fun part -> unbox<byte array> (get (get part "content") "bytes")) |> decode
            let tag = if parts.Length = 0 then "text" else partTag (stringField parts[0] "partId")
            Some(item (sequence original) (stringField original "role") (decodeItem tag raw) (get original "metadata"))
    let populate traceId openingText (items: obj array) =
        let trace = Trace traceId (null: obj)
        let openingRecords, openingCut =
            match openingText with
            | Some text -> [captureOpening trace text], count trace
            | None -> [], 0
        let pairs = items |> Array.mapi (fun ordinal item ->
            let wireKind, tag, payload = itemPayload (get item "part")
            let role, origin, run = roleAndOrigin (stringField item "role") tag (sprintf "xrun-%d" ordinal)
            let added = captureMessage trace (sprintf "xmsg-%d" ordinal) role origin run (sprintf "k:%s" tag) wireKind payload
            added, (sequence item, count trace))
        let records = pairs |> Array.fold (fun records (added, _) -> List.fold (fun records record -> record :: records) records added) (List.rev openingRecords)
        let cuts = pairs |> Array.fold (fun cuts (_, cut) -> cut :: cuts) []
        let state = { TraceId = traceId; Records = records; OpeningCut = openingCut; PartCuts = cuts; RecordCount = count trace; Opening = None; Parts = []; Terminals = [] }
        attachTrace state trace, trace
    let materialized range items window =
        let first, last = endpoints range
        unbox<obj array> (get window "messages") |> Array.choose (reconstruct items) |> Array.filter (fun item -> inside first last (sequence item))
    let materializeItems range (items: obj array) =
        let first, last = endpoints range
        if items.Length = 0 || first = last then [||]
        else
            let state, trace = populate "xtrace-items" None items
            let after, through = interval range state
            trace.materialize(after, through) |> materialized range items
    let inspectItems traceId openingText range items =
        let state, trace = populate traceId openingText items
        let after, through = interval range state
        let window = trace.materialize(after, through)
        createObj [ "traceId" ==> traceId; "head" ==> trace.head(); "after" ==> after; "through" ==> through;
                    "records" ==> (List.rev state.Records |> List.toArray); "window" ==> window;
                    "materializedCount" ==> (materialized range items window).Length ]
    let readPart entry body =
        let kind = stringField entry "kind"
        match kind with
        | "text" | "reasoning" | "tool_result" -> result (semanticText kind body)
        | "tool_call" ->
            match get entry "toolName" |> textOption with
            | Some name -> result (semanticTool name body)
            | None -> error (box "XTrace tool_call is missing its tool name")
        | "media_omitted" -> result (semanticMedia (if String.IsNullOrWhiteSpace body then null else box body) "")
        | _ -> error (box (sprintf "XTrace contains an unknown semantic part kind: %s" kind))
    let readEntries (entries: obj array) (readBody: string -> Task<obj>) =
        let rec read index collected = task {
            if index = entries.Length then return result (box (List.rev collected |> List.toArray))
            else
                let entry = entries[index]
                let reference = stringField entry "bodyRef"
                let! body = readBody reference
                if not (unbox<bool> (get body "ok")) then
                    return error (box (sprintf "XTrace materialization could not read %s: %s" reference (stringField body "error")))
                else
                    let decoded = readPart entry (stringField body "value")
                    if not (unbox<bool> (get decoded "ok")) then return decoded
                    else
                        let value = item (sequence entry) (stringField entry "role") (get decoded "value") (get entry "metadata")
                        return! read (index + 1) (value :: collected)
        }
        read 0 []

[<AllowNullLiteral>]
type TraceHistoryMessages =
    abstract appendOpening: input: obj -> obj
    abstract appendPart: input: obj * ?prepareMetadata: (unit -> obj) -> obj
    abstract appendTerminal: input: obj -> obj
    abstract entries: unit -> obj array
    abstract terminals: unit -> obj array
    abstract opening: unit -> obj
    abstract latestTerminal: unit -> obj
    abstract terminalFor: providerRun: string -> obj
    abstract headSequence: unit -> int64
    abstract head: unit -> int64
    abstract latestSequence: unit -> obj
    abstract rangeFrom: start: int64 -> obj
    abstract slice: range: obj -> obj array
    abstract interval: range: obj -> obj
    abstract afterCoverage: sequence: int64 -> obj
    abstract cutAt: sequence: int64 -> obj
    abstract headCut: unit -> obj
    abstract records: unit -> string array
    abstract read: entries: obj array * readBody: (string -> Task<obj>) -> Task<obj>
    abstract materialize: range: obj * readBody: (string -> Task<obj>) -> Task<obj>

let rec private historyFrom (state: History.State) : TraceHistoryMessages =
    let entries () = state.Parts |> List.rev |> List.map History.partView |> List.toArray
    let selected range =
        let first, last = History.endpoints range
        entries () |> Array.filter (fun entry -> History.inside first last (History.sequence entry))
    let next bridge updated = History.restate bridge updated |> historyFrom |> box |> History.result
    { new TraceHistoryMessages with
        member this.appendOpening input =
            let opening: History.Opening = { Assignment = History.stringField input "assignment"; Requirements = History.get input "requirements" |> unbox<string array> |> Array.toList }
            match state.Opening with
            | Some existing when existing = opening -> History.result (box this)
            | Some _ -> History.rejected "OpeningAlreadyCaptured"
            | None ->
                let bridge = History.appendOpeningRecords opening state
                next bridge { bridge with Opening = Some opening }
        member _.appendPart(input, prepareMetadata) =
            let sequence = History.sequence input
            let head = History.headSequence state
            if sequence <= head then History.error (createObj [ "kind" ==> "CursorNotAfterHead"; "expected" ==> head; "actual" ==> sequence ])
            else
                let part = History.partFrom input
                let part = match prepareMetadata with Some prepare -> { part with Metadata = prepare () } | None -> part
                let bridge = History.appendPartRecords part state
                next bridge { bridge with Parts = part :: state.Parts }
        member this.appendTerminal input =
            let providerRun = History.stringField input "providerRun"
            let reference, digest = History.stringField input "bodyRef", History.stringField input "bodyDigest"
            match state.Terminals |> List.tryFind (fun terminal -> terminal.ProviderRun = providerRun) with
            | Some existing when existing.BodyRef = reference && existing.BodyDigest = digest -> History.result (box this)
            | Some _ -> History.rejected "TerminalAlreadyCaptured"
            | None ->
                let terminal: History.Terminal = { ProviderRun = providerRun; BodyRef = reference; BodyDigest = digest; Frontier = History.head state |> History.checkedCursor }
                let bridge = History.appendTerminalRecords terminal state
                next bridge { bridge with Terminals = terminal :: state.Terminals }
        member _.entries() = entries ()
        member _.terminals() = state.Terminals |> List.rev |> List.map History.terminalView |> List.toArray
        member _.opening() = state.Opening |> Option.map History.openingView |> Option.defaultValue null
        member _.latestTerminal() = state.Terminals |> List.tryHead |> Option.map History.terminalView |> Option.defaultValue null
        member _.terminalFor providerRun = state.Terminals |> List.tryFind (fun terminal -> terminal.ProviderRun = providerRun) |> Option.map History.terminalView |> Option.defaultValue null
        member _.headSequence() = History.headSequence state
        member _.head() = History.head state |> History.checkedCursor
        member _.latestSequence() = state.Parts |> List.tryHead |> Option.map (fun part -> box part.Sequence) |> Option.defaultValue null
        member _.rangeFrom first =
            let last = History.head state |> History.checkedCursor
            History.range (min first last) last
        member _.slice range =
            let after, through = History.interval range state
            (History.readable state).read(after, through) |> ignore
            selected range
        member _.interval range = History.interval range state |> History.intervalView
        member _.afterCoverage sequence =
            let trace = History.readable state
            let after = History.cutAt sequence state
            let through = state.PartCuts |> List.tryHead |> Option.map snd |> Option.defaultValue state.OpeningCut |> float |> trace.cut
            let after = if unbox<int> (History.get after "cursor") > unbox<int> (History.get through "cursor") then through else after
            History.intervalView (after, through)
        member _.cutAt sequence = History.cutAt sequence state
        member _.headCut() = (History.readable state).head()
        member _.records() = List.rev state.Records |> List.toArray
        member _.read(entries, readBody) = History.readEntries entries readBody
        member _.materialize(range, readBody) = task {
            History.interval range state |> ignore
            let! result = History.readEntries (selected range) readBody
            if unbox<bool> (History.get result "ok") then
                return History.materializeItems range (unbox<obj array> (History.get result "value")) |> box |> History.result
            else return result
        } }

let TraceHistory (traceId: string) = History.empty traceId |> historyFrom

let materializeTraceItems range items = History.materializeItems range items

let inspectTraceItems traceId openingText range items = History.inspectItems traceId (History.textOption openingText) range items
