module Wanxiangli.Program.ActiveTurnBridge

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

type TurnSlot =
    { Token: string
      Host: obj
      Ask: obj }

[<AttachMembers>]
type ActiveTurnBridge() =
    let slots = Dictionary<string, TurnSlot>()

    member _.acquire(sessionId: string, host: obj, ask: obj) : string =
        if String.IsNullOrEmpty sessionId then
            ""
        else
            let token = Guid.NewGuid().ToString("N")
            slots[sessionId] <- { Token = token; Host = host; Ask = ask }
            token

    member _.release(sessionId: string, token: string) : bool =
        if String.IsNullOrEmpty sessionId || String.IsNullOrEmpty token then
            false
        else
            match slots.TryGetValue sessionId with
            | true, slot when slot.Token = token ->
                slots.Remove sessionId |> ignore
                true
            | _ -> false

    member _.resolveHost(sessionId: string) : obj =
        if String.IsNullOrEmpty sessionId then
            null
        else
            match slots.TryGetValue sessionId with
            | true, slot when not (isNull slot.Host) -> slot.Host
            | _ -> null

    member _.resolveAsk(sessionId: string) : obj =
        if String.IsNullOrEmpty sessionId then
            null
        else
            match slots.TryGetValue sessionId with
            | true, slot when not (isNull slot.Ask) -> slot.Ask
            | _ -> null

    member _.clearSession(sessionId: string) : unit =
        if not (String.IsNullOrEmpty sessionId) then
            slots.Remove sessionId |> ignore

    member _.clearAll() : unit = slots.Clear()

    member _.count: int = slots.Count

    member _.inspect() : obj =
        createObj
            [ "count" ==> box slots.Count
              "sessions" ==> box (slots.Keys |> Seq.toArray) ]

let activeTurnBridge = ActiveTurnBridge()
