module Wanxiangli.Program.Caller

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type ProgramCallers() =
    let callers = Dictionary<string, string>()

    let callerKey (sessionId: string) (callId: string) =
        sessionId + "\n" + callId

    member _.noteCaller(sessionId: string, callId: string, name: string) : unit =
        let valid =
            not (String.IsNullOrEmpty sessionId)
            && not (String.IsNullOrEmpty callId)
            && not (String.IsNullOrEmpty name)

        match valid with
        | true -> callers[callerKey sessionId callId] <- name
        | false -> ()

    member _.clearCaller(sessionId: string, callId: string) : unit =
        let valid =
            not (String.IsNullOrEmpty sessionId)
            && not (String.IsNullOrEmpty callId)

        match valid with
        | true -> callers.Remove(callerKey sessionId callId) |> ignore
        | false -> ()

    member _.callerName(sessionId: string, callId: string) : string option =
        let key =
            match not (String.IsNullOrEmpty sessionId) && not (String.IsNullOrEmpty callId) with
            | true -> callerKey sessionId callId
            | false -> ""

        match callers.TryGetValue key with
        | true, name when not (String.IsNullOrEmpty name) -> Some name
        | _ -> None

    member _.clearSession(sessionId: string) : unit =
        match String.IsNullOrEmpty sessionId with
        | true -> ()
        | false ->
            let prefix = sessionId + "\n"

            let toRemove =
                callers.Keys
                |> Seq.filter (fun k -> k.StartsWith(prefix, StringComparison.Ordinal))
                |> Seq.toArray

            toRemove |> Array.iter (fun k -> callers.Remove(k) |> ignore)

    member _.clearAll() : unit = callers.Clear()

    member _.count: int = callers.Count

    member _.inspect() : obj =
        createObj
            [ "count" ==> callers.Count
              "keys" ==> (callers.Keys |> Seq.toArray) ]

let programCallers = ProgramCallers()
