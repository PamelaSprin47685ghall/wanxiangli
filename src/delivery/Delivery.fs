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
