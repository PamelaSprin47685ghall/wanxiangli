module Wanxiangli.Delivery.Delivery

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// 交付视图格的公开消息。视图本身不透明：本对象不解析、不渲染它。
[<AllowNullLiteral>]
type DeliveryMessages =
    abstract stage: sessionId: string * view: obj -> unit
    abstract deliver: sessionId: string * fence: obj * view: obj -> unit
    abstract take: sessionId: string -> obj
    abstract peek: sessionId: string -> obj
    abstract peekCached: sessionId: string -> obj
    abstract fence: sessionId: string -> obj
    abstract returned: sessionId: string -> string array
    abstract claim: sessionId: string * request: obj -> obj
    abstract handOff: ticket: obj * candidates: obj array -> obj array
    abstract clear: sessionId: string -> unit
    abstract clearReturned: sessionId: string -> unit
    abstract clearAll: unit -> unit

type private Fence =
    { ProviderRun: string
      ToolCallId: string }

/// 格由本对象创建；Id 让凭据知道自己指向哪一个格。
type private Cell =
    { Id: int
      View: obj
      Fence: Fence option }

type private Piece = { Key: string; Text: string }

/// 凭据只公开冻结的声明与围栏；消费状态留在签发实例里。
type private Ticket =
    { SessionId: string
      CellId: int
      Advance: bool
      Consume: bool
      Epoch: int
      Generation: int
      mutable Spent: bool }

[<Emit("new WeakMap()")>]
let private weakMap () : obj = jsNative

[<Emit("$0.get($1)")>]
let private weakGet (_map: obj) (_key: obj) : Ticket = jsNative

[<Emit("$0.set($1, $2)")>]
let private weakSet (_map: obj) (_key: obj) (_value: Ticket) : unit = jsNative

let private fail (message: string) : 'a = raise (ArgumentException message)

let private isAbsent (value: obj) =
    isNull value || jsTypeof value = "undefined"

let private text (name: string) (value: obj) : string =
    match value with
    | :? string as value when value.Length > 0 -> value
    | _ -> fail (name + " must be a non-empty string")

[<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
let private descriptorOf (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
let private hasOwn (_value: obj) (_name: string) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

/// 只读数据字段；accessor 在读取前就被拒绝，调用方代码无法借 getter 重入。
let private ownField (value: obj) (name: string) : obj =
    if isAbsent value || jsTypeof value <> "object" then
        fail ("Expected an object with field " + name)
    else
        let descriptor = descriptorOf value name

        if isAbsent descriptor || not (hasOwn descriptor "value") then
            fail ("Missing field or accessor: " + name)
        else
            descriptor?value

let private fenceOf (value: obj) : Fence =
    { ProviderRun = text "providerRun" (ownField value "providerRun")
      ToolCallId = text "toolCallId" (ownField value "toolCallId") }

let private fenceValue (fence: Fence) : obj =
    freeze (createObj [ "providerRun" ==> fence.ProviderRun; "toolCallId" ==> fence.ToolCallId ])

let private pieceOf (value: obj) : Piece =
    { Key = text "key" (ownField value "key")
      Text =
        match ownField value "text" with
        | :? string as value -> value
        | _ -> fail "text must be a string" }

let private pieceValue (piece: Piece) : obj =
    freeze (createObj [ "key" ==> piece.Key; "text" ==> piece.Text ])

let private stored (view: obj) : obj = if isAbsent view then null else view

let Delivery () : DeliveryMessages =
    let cells = Dictionary<string, Cell>()
    let returnedKeys = Dictionary<string, HashSet<string>>()
    let epochs = Dictionary<string, int>()
    let tickets = weakMap ()
    let mutable busy = false
    let mutable generation = 0
    let mutable nextCellId = 0

    let guard action =
        if busy then
            invalidOp "Delivery does not allow reentrant messages"

        busy <- true

        try
            action ()
        finally
            busy <- false

    let returnedOf sessionId =
        match returnedKeys.TryGetValue sessionId with
        | true, keys -> keys
        | false, _ ->
            let keys = HashSet<string>()
            returnedKeys[sessionId] <- keys
            keys

    let hasReturned sessionId key =
        match returnedKeys.TryGetValue sessionId with
        | true, keys -> keys.Contains key
        | false, _ -> false

    let tryCell sessionId =
        match cells.TryGetValue sessionId with
        | true, cell -> Some cell
        | false, _ -> None

    /// 会话纪元：clear 与 clearReturned 让该会话已签发的凭据失效。
    let epochOf sessionId =
        match epochs.TryGetValue sessionId with
        | true, epoch -> epoch
        | false, _ -> 0

    let bumpEpoch sessionId =
        epochs[sessionId] <- epochOf sessionId + 1

    let newCell view fence =
        nextCellId <- nextCellId + 1
        { Id = nextCellId
          View = stored view
          Fence = fence }

    let issue sessionId (cell: Cell) advance consume =
        let ticket =
            freeze (
                createObj
                    [ "view" ==> cell.View
                      "fence" ==> (cell.Fence |> Option.map fenceValue |> Option.defaultValue null) ]
            )

        weakSet
            tickets
            ticket
            { SessionId = sessionId
              CellId = cell.Id
              Advance = advance
              Consume = consume
              Epoch = epochOf sessionId
              Generation = generation
              Spent = false }

        ticket

    let claimOk (ticket: obj) : obj = createObj [ "ok" ==> true; "ticket" ==> ticket ]

    let claimFail (reason: string) : obj =
        createObj [ "ok" ==> false; "reason" ==> reason ]

    /// claim 只观察与预留，不消费：围栏的完整判断在本对象内一次完成。
    let claim sessionId (request: obj) : obj =
        let mode = text "mode" (ownField request "mode")

        match mode with
        | "peek" ->
            // 只读观察：不比较围栏，不取走，不推进游标。
            match tryCell sessionId with
            | Some cell -> claimOk (issue sessionId cell false false)
            | None -> claimFail "no-cell"
        | "observe" ->
            // 只读观察：只认带着同一完整围栏的交付格。
            let fence = fenceOf (ownField request "fence")

            match tryCell sessionId with
            | Some cell ->
                match cell.Fence with
                | Some cellFence when cellFence = fence -> claimOk (issue sessionId cell false false)
                | Some _ -> claimFail "fence-mismatch"
                | None -> claimFail "fence-mismatch"
            | None -> claimFail "no-cell"
        | "cache" ->
            // 取走暂存格；暂存格没有围栏，只能由暂存这一个动作产生。
            match tryCell sessionId with
            | Some cell when cell.Fence.IsNone -> claimOk (issue sessionId cell true true)
            | Some _ -> claimFail "not-staged"
            | None -> claimFail "no-cell"
        | "run" ->
            // 取走交付格：providerRun 与 toolCallId 必须同时相同。
            let fence = fenceOf (ownField request "fence")

            match tryCell sessionId with
            | Some cell ->
                match cell.Fence with
                | Some cellFence when cellFence = fence -> claimOk (issue sessionId cell true true)
                | Some _ -> claimFail "fence-mismatch"
                | None -> claimFail "fence-mismatch"
            | None -> claimFail "no-cell"
        | other -> fail ("Unknown claim mode: " + other)

    let handOff (ticket: obj) (candidates: obj array) : obj array =
        let ticket =
            match
                if isAbsent ticket || jsTypeof ticket <> "object" then
                    None
                else
                    Option.ofObj (box (weakGet tickets ticket))
            with
            | Some state -> unbox<Ticket> state
            | None -> fail "Ticket was not issued by this delivery"

        if ticket.Spent then
            invalidOp "Ticket is already spent"

        if ticket.Generation <> generation then
            invalidOp "Ticket was invalidated by clearAll"

        if ticket.Epoch <> epochOf ticket.SessionId then
            invalidOp "Ticket was invalidated by clear"

        if isNull candidates then
            fail "candidates must be an array"

        // 先把选材校验完：校验失败时格与游标都不动，材料不丢。
        let pieces = candidates |> Array.map pieceOf |> Array.toList

        match tryCell ticket.SessionId with
        | Some cell when cell.Id = ticket.CellId -> ()
        | _ -> invalidOp "Ticket is no longer valid: the cell was taken or replaced"

        let sessionId = ticket.SessionId

        let fresh =
            pieces |> List.filter (fun piece -> not (hasReturned sessionId piece.Key))

        ticket.Spent <- true

        if ticket.Advance then
            let keys = returnedOf sessionId
            fresh |> List.iter (fun piece -> keys.Add piece.Key |> ignore)

        if ticket.Consume then
            cells.Remove sessionId |> ignore

        fresh |> List.map pieceValue |> List.toArray

    { new DeliveryMessages with
        member _.stage(sessionId, view) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId

                match tryCell sessionId with
                | Some { Fence = Some _ } -> ()
                | _ -> cells[sessionId] <- newCell view None)

        member _.deliver(sessionId, fence, view) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId
                let fence = fenceOf fence

                cells[sessionId] <- newCell view (Some fence))

        member _.take(sessionId) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId

                match tryCell sessionId with
                | Some({ Fence = Some _ } as cell) ->
                    cells.Remove sessionId |> ignore
                    cell.View
                | _ -> null)

        member _.peek(sessionId) =
            guard (fun () ->
                match tryCell (text "sessionId" sessionId) with
                | Some({ Fence = Some _ } as cell) -> cell.View
                | _ -> null)

        member _.peekCached(sessionId) =
            guard (fun () ->
                match tryCell (text "sessionId" sessionId) with
                | Some cell -> cell.View
                | None -> null)

        member _.fence(sessionId) =
            guard (fun () ->
                match tryCell (text "sessionId" sessionId) with
                | Some { Fence = Some fence } -> fenceValue fence
                | _ -> null)

        member _.returned(sessionId) =
            guard (fun () ->
                match returnedKeys.TryGetValue(text "sessionId" sessionId) with
                | true, keys -> keys |> Seq.toArray
                | false, _ -> [||])

        member _.claim(sessionId, request) =
            guard (fun () -> claim (text "sessionId" sessionId) request)

        member _.handOff(ticket, candidates) =
            guard (fun () -> handOff ticket candidates)

        member _.clear(sessionId) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId
                cells.Remove sessionId |> ignore
                bumpEpoch sessionId)

        member _.clearReturned(sessionId) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId
                returnedKeys.Remove sessionId |> ignore
                bumpEpoch sessionId)

        member _.clearAll() =
            guard (fun () ->
                cells.Clear()
                returnedKeys.Clear()
                epochs.Clear()
                generation <- generation + 1) }
[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("typeof $0")>]
let private valueType (value: obj) : string = jsNative

[<Emit("/^\\s*$/.test($0)")>]
let private isBlankText (text: string) : bool = jsNative

[<Emit("$0.startsWith('turn:') || $0.startsWith('prose:')")>]
let private isBodyKey (key: string) : bool = jsNative

[<Emit("$0 && $0.ok === true ? $0.ticket : null")>]
let private extractTicket (outcome: obj) : obj = jsNative

let private isAbsentObj (value: obj) : bool =
    isNull value || jsTypeof value = "undefined"

let private historyPiece (text: string) : Piece =
    { Key = "material:" + JS.JSON.stringify text
      Text = text }

let private historyEntryPiece (entry: obj) : Piece =
    if isAbsentObj entry then historyPiece ""
    elif valueType entry = "string" then historyPiece (unbox<string> entry)
    elif not (isAbsentObj entry?text) then historyPiece (string entry?text)
    else historyPiece ""

let private selectPieces (view: obj) (alreadySet: HashSet<string>) : Piece list =
    if not (isArray view) then []
    else
        let items: obj array = unbox view
        items
        |> Array.toList
        |> List.map historyEntryPiece
        |> List.filter (fun piece -> not (alreadySet.Contains piece.Key))

let private currentPieceKey (sessionId: string) (providerRun: string option) (toolCallId: string option) (prose: string) : string =
    match providerRun, toolCallId with
    | Some run, Some call ->
        "turn:" + JS.JSON.stringify [| sessionId; run; call |]
    | _ ->
        "prose:" + JS.JSON.stringify [| sessionId; prose |]

let private makeCurrentPiece (sessionId: string) (providerRun: string option) (toolCallId: string option) (prose: string) : Piece option =
    if isBlankText prose then None
    else
        let key = currentPieceKey sessionId providerRun toolCallId prose
        Some { Key = key; Text = prose }

let private splitPieces (pieces: Piece list) : (string array * string array) =
    let body, carry = pieces |> List.partition (fun piece -> isBodyKey piece.Key)
    let bodyTexts = body |> List.map (fun p -> p.Text) |> List.toArray
    let carryTexts = carry |> List.map (fun p -> p.Text) |> List.toArray
    (bodyTexts, carryTexts)

let private createHandoffResult (body: string array) (carry: string array) : obj =
    createObj [ "body" ==> body; "carry" ==> carry ]

let private appendCurrentIfNew (pieces: Piece list) (alreadySet: HashSet<string>) (currentOpt: Piece option) : Piece list =
    match currentOpt with
    | Some current when not (alreadySet.Contains current.Key) -> pieces @ [ current ]
    | _ -> pieces

let private resolveCurrentOpt (sessionId: string) (runOpt: string option) (callOpt: string option) (assistantOpt: string option) : Piece option =
    match assistantOpt with
    | Some prose -> makeCurrentPiece sessionId runOpt callOpt prose
    | None -> None

let private materialPieces (sessionId: string) (view: obj) (runOpt: string option) (callOpt: string option) (assistantOpt: string option) (alreadySet: HashSet<string>) : Piece list =
    let history = selectPieces view alreadySet
    let currentOpt = resolveCurrentOpt sessionId runOpt callOpt assistantOpt
    appendCurrentIfNew history alreadySet currentOpt

let private pieceToObj (piece: Piece) : obj =
    createObj [ "key" ==> piece.Key; "text" ==> piece.Text ]

let private objToPiece (item: obj) : Piece =
    { Key = string item?key; Text = string item?text }

let private handOffCandidates (delivery: DeliveryMessages) (ticket: obj) (candidates: Piece list) : obj =
    let candidateObjs = candidates |> List.map pieceToObj |> List.toArray
    let returnedObjs = delivery.handOff (ticket, candidateObjs)
    let returnedPieces = returnedObjs |> Array.map objToPiece |> Array.toList
    let bodyTexts, carryTexts = splitPieces returnedPieces
    createHandoffResult bodyTexts carryTexts

let private claimTicket (delivery: DeliveryMessages) (sessionId: string) (request: obj) : obj option =
    let outcome = delivery.claim (sessionId, request)
    let ticket = extractTicket outcome
    if isAbsentObj ticket then None else Some ticket

let private fenceFromTicket (ticket: obj) : (string option * string option) =
    let fence = ticket?fence
    if isAbsentObj fence then (None, None)
    else (Some (string fence?providerRun), Some (string fence?toolCallId))

let private runHandoffCandidates (delivery: DeliveryMessages) (sessionId: string) (ticket: obj) (assistant: string option) : obj =
    let view = ticket?view
    if isAbsentObj view then
        handOffCandidates delivery ticket [] |> ignore
        null
    else
        let runOpt, callOpt = fenceFromTicket ticket
        let alreadyArr = delivery.returned sessionId
        let alreadySet = HashSet<string>(alreadyArr)
        let candidates = materialPieces sessionId view runOpt callOpt assistant alreadySet
        handOffCandidates delivery ticket candidates

let private performHandoff (delivery: DeliveryMessages) (sessionId: string) (request: obj) (assistant: string option) : obj =
    let ticketOpt = claimTicket delivery sessionId request
    match ticketOpt with
    | None -> null
    | Some ticket -> runHandoffCandidates delivery sessionId ticket assistant

let private buildBodyPiece (currentOpt: Piece option) (bodyLastIndex: int) (index: int) (text: string) : Piece =
    match currentOpt with
    | Some current when index = bodyLastIndex && current.Text = text -> current
    | _ -> historyPiece text

let private witnessCandidates (sessionId: string) (ticket: obj) (bodyTexts: string array) (carryTexts: string array) (assistant: string) : Piece list =
    let bodyList = bodyTexts |> Array.toList
    let carryList = carryTexts |> Array.toList
    let runOpt, callOpt = fenceFromTicket ticket
    let currentOpt = makeCurrentPiece sessionId runOpt callOpt assistant
    let bodyLastIndex = List.length bodyList - 1
    let bodyPieces = bodyList |> List.mapi (buildBodyPiece currentOpt bodyLastIndex)
    let carryPieces = carryList |> List.map historyPiece
    carryPieces @ bodyPieces

let private runWitnessHandoff (delivery: DeliveryMessages) (sessionId: string) (ticket: obj) (bodyTexts: string array) (carryTexts: string array) (assistant: string) : obj =
    let candidates = witnessCandidates sessionId ticket bodyTexts carryTexts assistant
    handOffCandidates delivery ticket candidates

let private performWitnessHandoff (delivery: DeliveryMessages) (sessionId: string) (providerRun: string) (toolCallId: string) (bodyTexts: string array) (carryTexts: string array) (assistant: string) : obj =
    let fenceObj = createObj [ "providerRun" ==> providerRun; "toolCallId" ==> toolCallId ]
    let request = createObj [ "mode" ==> "run"; "fence" ==> fenceObj ]
    let ticketOpt = claimTicket delivery sessionId request
    match ticketOpt with
    | None -> null
    | Some ticket -> runWitnessHandoff delivery sessionId ticket bodyTexts carryTexts assistant

let private performRunHandoff (delivery: DeliveryMessages) (sessionId: string) (providerRun: string) (toolCallId: string) (assistant: string option) : obj =
    let fenceObj = createObj [ "providerRun" ==> providerRun; "toolCallId" ==> toolCallId ]
    let request = createObj [ "mode" ==> "run"; "fence" ==> fenceObj ]
    performHandoff delivery sessionId request assistant

let private performCacheHandoff (delivery: DeliveryMessages) (sessionId: string) (assistant: string option) : obj =
    let request = createObj [ "mode" ==> "cache" ]
    performHandoff delivery sessionId request assistant

let private performPeekHandoff (delivery: DeliveryMessages) (sessionId: string) (assistant: string option) : obj =
    let request = createObj [ "mode" ==> "peek" ]
    performHandoff delivery sessionId request assistant

let private performObserveClaim (delivery: DeliveryMessages) (sessionId: string) (providerRun: string) (toolCallId: string) : bool =
    let fenceObj = createObj [ "providerRun" ==> providerRun; "toolCallId" ==> toolCallId ]
    let request = createObj [ "mode" ==> "observe"; "fence" ==> fenceObj ]
    let ticketOpt = claimTicket delivery sessionId request
    ticketOpt.IsSome

let private cleanAssistant (assistant: obj) : string option =
    if isAbsentObj assistant then None
    elif jsTypeof assistant <> "string" then None
    elif isBlankText (unbox<string> assistant) then None
    else Some (unbox<string> assistant)

let private cleanAssistantOpt (assistant: string) : string option =
    if isBlankText assistant then None else Some assistant

let private extractFenceOptions (fence: obj) : (string option * string option) =
    if isAbsentObj fence then (None, None)
    else (Some (string fence?providerRun), Some (string fence?toolCallId))

[<AttachMembers>]
type JsDeliveredValues() =
    let delivery = Delivery()

    member _.recordView(sessionId: string, view: obj) : unit =
        delivery.stage(sessionId, view)

    member _.recordFencedView(sessionId: string, providerRun: string, toolCallId: string, view: obj) : unit =
        let fence = createObj [ "providerRun" ==> providerRun; "toolCallId" ==> toolCallId ]
        delivery.deliver(sessionId, fence, view)

    member _.take(sessionId: string) : obj =
        delivery.take(sessionId)

    member _.peek(sessionId: string) : obj =
        delivery.peek(sessionId)

    member _.peekCached(sessionId: string) : obj =
        delivery.peekCached(sessionId)

    member _.peekView(sessionId: string) : obj =
        delivery.peekCached(sessionId)

    member _.peekFence(sessionId: string) : obj =
        delivery.fence(sessionId)

    member _.alreadyReturned(sessionId: string) : string array =
        delivery.returned(sessionId)

    member _.ownsCell(sessionId: string, providerRun: string, toolCallId: string) : bool =
        performObserveClaim delivery sessionId providerRun toolCallId

    member _.select(sessionId: string, view: obj, already: string array) : obj array =
        let alreadySet = HashSet<string>(already)
        let pieces = selectPieces view alreadySet
        pieces |> List.map pieceToObj |> List.toArray

    member _.materialize(sessionId: string, carry: obj, fence: obj, assistant: string) : obj =
        let runOpt, callOpt = extractFenceOptions fence
        let assistantOpt = cleanAssistantOpt assistant
        let pieces = materialPieces sessionId carry runOpt callOpt assistantOpt (HashSet<string>())
        let bodyTexts, carryTexts = splitPieces pieces
        createHandoffResult bodyTexts carryTexts

    member _.tryTakeMaterialForCall(sessionId: string, providerRun: string, toolCallId: string, assistant: obj) : obj =
        let assistantOpt = cleanAssistant assistant
        performRunHandoff delivery sessionId providerRun toolCallId assistantOpt

    member _.tryTakeWitnessMaterial(sessionId: string, providerRun: string, toolCallId: string, bodyTexts: string array, carryTexts: string array, assistant: string) : obj =
        performWitnessHandoff delivery sessionId providerRun toolCallId bodyTexts carryTexts assistant

    member _.tryTakeMaterialWith(sessionId: string, assistant: obj) : obj =
        let assistantOpt = cleanAssistant assistant
        performCacheHandoff delivery sessionId assistantOpt

    member _.tryTakeMaterial(sessionId: string) : obj =
        performCacheHandoff delivery sessionId None

    member _.tryPeekMaterial(sessionId: string) : obj =
        performPeekHandoff delivery sessionId None

    member _.tryPeekMaterialWith(sessionId: string, assistant: obj) : obj =
        let assistantOpt = cleanAssistant assistant
        performPeekHandoff delivery sessionId assistantOpt

    member _.clear(sessionId: string) : unit =
        delivery.clear(sessionId)

    member _.clearReturned(sessionId: string) : unit =
        delivery.clearReturned(sessionId)

    member _.clearAll() : unit =
        delivery.clearAll()

let jsDeliveredValues = JsDeliveredValues()
