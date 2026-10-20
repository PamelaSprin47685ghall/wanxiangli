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
    abstract handOff: ticket: obj * candidates: obj array * assistant: obj -> obj array
    abstract clear: sessionId: string -> unit
    abstract clearReturned: sessionId: string -> unit
    abstract clearAll: unit -> unit

type private Fence = { ProviderRun: string; ToolCallId: string }

type private Cell = { View: obj; Fence: Fence option }

type private Piece = { Key: string; Text: string }

/// 一次 claim 的凭据状态。凭据本身只是冻结的 `{ view }`；状态留在签发实例里，调用方改不到。
type private Ticket =
    { SessionId: string
      View: obj
      Advance: bool
      mutable Spent: bool }

[<Emit("new WeakMap()")>]
let private weakMap () : obj = jsNative

[<Emit("$0.get($1)")>]
let private weakGet (_map: obj) (_key: obj) : Ticket = jsNative

[<Emit("$0.set($1, $2)")>]
let private weakSet (_map: obj) (_key: obj) (_value: Ticket) : unit = jsNative

let private fail (message: string) : 'a = raise (ArgumentException message)

let private isAbsent (value: obj) = isNull value || jsTypeof value = "undefined"

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
    freeze (
        createObj [ "providerRun" ==> fence.ProviderRun; "toolCallId" ==> fence.ToolCallId ]
    )

let private pieceOf (value: obj) : Piece =
    { Key = text "key" (ownField value "key")
      Text =
        match ownField value "text" with
        | :? string as value -> value
        | _ -> fail "text must be a string" }

let private pieceValue (piece: Piece) : obj =
    freeze (createObj [ "key" ==> piece.Key; "text" ==> piece.Text ])

let private stored (view: obj) : obj = if isAbsent view then null else view

/// 散文游标键沿用宿主原定义：会话、UTF-16 长度与前 24 个码元。
let private proseKey (sessionId: string) (prose: string) =
    "prose:"
    + sessionId
    + ":"
    + string prose.Length
    + ":"
    + prose.Substring(0, min 24 prose.Length)

let Delivery () : DeliveryMessages =
    let cells = Dictionary<string, Cell>()
    let returnedKeys = Dictionary<string, HashSet<string>>()
    let tickets = weakMap ()
    let mutable busy = false

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

    let issue sessionId (cell: Cell) advance =
        let ticket = freeze (createObj [ "view" ==> cell.View ])

        weakSet
            tickets
            ticket
            { SessionId = sessionId
              View = cell.View
              Advance = advance
              Spent = false }

        ticket

    let claim sessionId (request: obj) : obj =
        let mode = text "mode" (ownField request "mode")

        match mode with
        | "peek" ->
            match tryCell sessionId with
            | Some cell -> issue sessionId cell false
            | None -> null
        | "cache" ->
            match tryCell sessionId with
            | Some cell when cell.Fence.IsNone ->
                cells.Remove sessionId |> ignore
                issue sessionId cell true
            | _ -> null
        | "run" ->
            let providerRun = text "providerRun" (ownField request "providerRun")

            match tryCell sessionId with
            | Some({ Fence = Some fence } as cell) when fence.ProviderRun = providerRun ->
                cells.Remove sessionId |> ignore
                issue sessionId cell true
            | _ -> null
        | other -> fail ("Unknown claim mode: " + other)

    let handOff (ticket: obj) (candidates: obj array) (assistant: obj) : obj array =
        let ticket =
            match if isAbsent ticket || jsTypeof ticket <> "object" then None else Option.ofObj (box (weakGet tickets ticket)) with
            | Some state -> unbox<Ticket> state
            | None -> fail "Ticket was not issued by this delivery"

        if ticket.Spent then
            invalidOp "Ticket is already spent"

        if isNull candidates then
            fail "candidates must be an array"

        let pieces = candidates |> Array.map pieceOf |> Array.toList

        let assistant =
            if isAbsent assistant then
                None
            else
                match assistant with
                | :? string as prose -> Some prose
                | _ -> fail "assistant must be a string or null"

        let sessionId = ticket.SessionId

        let fresh =
            pieces
            |> List.filter (fun piece -> not (hasReturned sessionId piece.Key))

        let selected =
            match assistant with
            | Some prose when not (isAbsent ticket.View) && not (String.IsNullOrWhiteSpace prose) ->
                let key = proseKey sessionId prose

                if hasReturned sessionId key || fresh |> List.exists (fun piece -> piece.Key = key) then
                    fresh
                else
                    fresh @ [ { Key = key; Text = prose } ]
            | _ -> fresh

        ticket.Spent <- true

        if ticket.Advance then
            let keys = returnedOf sessionId
            selected |> List.iter (fun piece -> keys.Add piece.Key |> ignore)

        selected |> List.map pieceValue |> List.toArray

    { new DeliveryMessages with
        member _.stage(sessionId, view) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId

                match tryCell sessionId with
                | Some { Fence = Some _ } -> ()
                | _ -> cells[sessionId] <- { View = stored view; Fence = None })

        member _.deliver(sessionId, fence, view) =
            guard (fun () ->
                let sessionId = text "sessionId" sessionId
                let fence = fenceOf fence
                cells[sessionId] <- { View = stored view; Fence = Some fence })

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

        member _.handOff(ticket, candidates, assistant) =
            guard (fun () -> handOff ticket candidates assistant)

        member _.clear(sessionId) =
            guard (fun () -> cells.Remove(text "sessionId" sessionId) |> ignore)

        member _.clearReturned(sessionId) =
            guard (fun () -> returnedKeys.Remove(text "sessionId" sessionId) |> ignore)

        member _.clearAll() =
            guard (fun () ->
                cells.Clear()
                returnedKeys.Clear()) }
