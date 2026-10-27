module Wanxiangli.ChatExecution.ManagedChatExecutionFlight

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

let private sanitize (v: obj) : string =
    if isNull v then ""
    else
        match v with
        | :? string as s -> s
        | other -> other.ToString()

let private makeKey (runtimeId: obj) (sessionId: obj) (physicalUserMessageId: obj) : string =
    sanitize runtimeId + "\u001f" + sanitize sessionId + "\u001f" + sanitize physicalUserMessageId

[<AttachMembers>]
type ManagedChatExecutionFlight() =
    let gate = obj ()
    let inFlight = Dictionary<string, obj>()

    member _.BeginFlight(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj, work: obj) : unit =
        lock gate (fun () ->
            let key = makeKey runtimeId sessionId physicalUserMessageId
            inFlight.[key] <- work)

    member _.Finish(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj) : bool =
        lock gate (fun () ->
            let key = makeKey runtimeId sessionId physicalUserMessageId
            inFlight.Remove key)

    member _.TryGet(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj) : obj option =
        lock gate (fun () ->
            let key = makeKey runtimeId sessionId physicalUserMessageId
            match inFlight.TryGetValue key with
            | true, work -> Some work
            | false, _ -> None)

    member _.Get(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj) : obj =
        lock gate (fun () ->
            let key = makeKey runtimeId sessionId physicalUserMessageId
            match inFlight.TryGetValue key with
            | true, work -> work
            | false, _ -> null)

    member _.Clear() : unit =
        lock gate (fun () -> inFlight.Clear())

    member _.Count: int =
        lock gate (fun () -> inFlight.Count)

    // CamelCase aliases for JavaScript callers
    member this.beginFlight(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj, work: obj) : unit =
        this.BeginFlight(runtimeId, sessionId, physicalUserMessageId, work)

    member this.finish(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj) : bool =
        this.Finish(runtimeId, sessionId, physicalUserMessageId)

    member this.tryGet(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj) : obj option =
        this.TryGet(runtimeId, sessionId, physicalUserMessageId)

    member this.get(runtimeId: obj, sessionId: obj, physicalUserMessageId: obj) : obj =
        this.Get(runtimeId, sessionId, physicalUserMessageId)

    member this.clear() : unit =
        this.Clear()

    member this.count() : int =
        this.Count

let managedChatExecutionFlight = ManagedChatExecutionFlight()
