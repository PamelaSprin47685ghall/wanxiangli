module Wanxiangli.ChatExecution.SessionQuiescenceGate

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type QuiescencePermitToken(owner: obj, sessionId: string, serial: int64) =
    member _.Owner = owner
    member _.SessionId = sessionId
    member _.Serial = serial

    member _.toJSON() : obj =
        invalidOp "QuiescencePermit is process-local and cannot be serialized"

[<RequireQualifiedAccess>]
type private Activity =
    | Unknown
    | ProviderAttempt of attemptSerial: int64
    | Idle of attemptSerial: int64
    | IdleConsumed of attemptSerial: int64
    | Revoked of attemptSerial: int64

let private okResult () : obj =
    createObj [ "ok" ==> true; "reason" ==> null ]

let private errorResult (reason: string) : obj =
    createObj [ "ok" ==> false; "reason" ==> reason ]

[<AttachMembers>]
type SessionQuiescenceGate() as this =
    let gate = obj ()
    let owner = obj ()
    let currentPermits = Dictionary<string, QuiescencePermitToken>()
    let mutable serials = Map.empty<string, int64>
    let mutable activities = Map.empty<string, Activity>
    let mutable physicalMessages = Map.empty<string, Set<string>>
    let mutable activeToolCounts = Map.empty<string, int>

    let nextSerial key =
        Map.tryFind key serials
        |> Option.defaultValue 0L
        |> fun current -> current + 1L

    let inspectPermit (permit: obj) =
        match permit with
        | :? QuiescencePermitToken as opaque when obj.ReferenceEquals(opaque.Owner, owner) ->
            let key = opaque.SessionId
            let activeTools = Map.tryFind key activeToolCounts |> Option.defaultValue 0
            Some(struct (key, opaque.Serial, Map.tryFind key activities, activeTools))
        | _ -> None

    let tryCurrentPermit key =
        match currentPermits.TryGetValue key with
        | true, permit -> Some permit
        | false, _ -> None

    let issuePermit sessionId serial =
        QuiescencePermitToken(owner, sessionId, serial)

    let decideConsume evidence =
        match evidence with
        | None -> Error "WrongOwner"
        | Some(struct (_, serial, Some(Activity.Idle current), activeTools)) when current = serial && activeTools > 0 ->
            Error "NoFreshIdle"
        | Some(struct (key, serial, Some(Activity.Idle current), _)) when current = serial ->
            Ok(struct (key, Activity.IdleConsumed serial))
        | Some(struct (_, serial, Some(Activity.IdleConsumed current), _)) when current = serial ->
            Error "AlreadyConsumed"
        | Some(struct (_, _, Some(Activity.Revoked _), _)) -> Error "Revoked"
        | Some(struct (_, serial, Some(Activity.ProviderAttempt current), _))
        | Some(struct (_, serial, Some(Activity.Idle current), _))
        | Some(struct (_, serial, Some(Activity.IdleConsumed current), _)) when current > serial ->
            Error "Superseded"
        | Some _ -> Error "NoFreshIdle"

    let decideRelease evidence =
        match evidence with
        | None -> Error "WrongOwner"
        | Some(struct (key, serial, Some(Activity.IdleConsumed current), _)) when current = serial ->
            Ok(struct (key, Activity.Idle serial))
        | Some(struct (_, _, Some(Activity.Revoked _), _)) -> Error "Revoked"
        | Some(struct (_, serial, Some(Activity.ProviderAttempt current), _))
        | Some(struct (_, serial, Some(Activity.Idle current), _))
        | Some(struct (_, serial, Some(Activity.IdleConsumed current), _)) when current > serial ->
            Error "Superseded"
        | Some _ -> Error "NoFreshIdle"

    let incrementToolCount key =
        activeToolCounts
        |> Map.tryFind key
        |> Option.defaultValue 0
        |> fun current -> activeToolCounts <- Map.add key (current + 1) activeToolCounts

    let decrementToolCount key =
        match Map.tryFind key activeToolCounts with
        | Some current when current > 1 -> activeToolCounts <- Map.add key (current - 1) activeToolCounts
        | Some _ -> activeToolCounts <- Map.remove key activeToolCounts
        | None -> ()

    member _.BeginProviderAttempt(sessionId: string) : unit =
        lock gate (fun () ->
            let serial = nextSerial sessionId
            currentPermits.Remove sessionId |> ignore
            serials <- Map.add sessionId serial serials
            activities <- Map.add sessionId (Activity.ProviderAttempt serial) activities)

    member _.BeginToolExecution(sessionId: string) : unit =
        lock gate (fun () -> incrementToolCount sessionId)

    member _.EndToolExecution(sessionId: string) : unit =
        lock gate (fun () -> decrementToolCount sessionId)

    member _.ObservePhysicalUserMessage(sessionId: string, physicalUserMessageId: string) : unit =
        lock gate (fun () ->
            let seen = Map.tryFind sessionId physicalMessages |> Option.defaultValue Set.empty
            if not (Set.contains physicalUserMessageId seen) then
                let serial = nextSerial sessionId
                currentPermits.Remove sessionId |> ignore
                physicalMessages <- Map.add sessionId (Set.add physicalUserMessageId seen) physicalMessages
                serials <- Map.add sessionId serial serials
                activities <- Map.add sessionId (Activity.Revoked serial) activities)

    member _.ObserveIdle(sessionId: string) : obj =
        lock gate (fun () ->
            let serial = Map.tryFind sessionId serials |> Option.defaultValue 0L
            match Map.tryFind sessionId activities with
            | Some(Activity.ProviderAttempt current) when current = serial ->
                activities <- Map.add sessionId (Activity.Idle serial) activities
            | _ -> ()

            let currentPermit = tryCurrentPermit sessionId
            let activity = Map.tryFind sessionId activities
            match currentPermit, activity with
            | Some permit, _ -> box permit
            | None, (Some(Activity.Idle current) | Some(Activity.IdleConsumed current)) when current = serial ->
                let permit = issuePermit sessionId serial
                currentPermits.Add(sessionId, permit)
                box permit
            | None, _ -> box (issuePermit sessionId serial))

    member _.CaptureCurrentAttempt(sessionId: string) : obj =
        lock gate (fun () ->
            let serial = Map.tryFind sessionId serials |> Option.defaultValue 0L
            box (issuePermit sessionId serial))

    member _.ObserveIdleFor(observation: obj) : obj =
        lock gate (fun () ->
            match observation with
            | :? QuiescencePermitToken as opaque when
                obj.ReferenceEquals(opaque.Owner, owner)
                && opaque.Serial = (Map.tryFind opaque.SessionId serials |> Option.defaultValue 0L) ->
                this.ObserveIdle opaque.SessionId
            | _ -> null)

    member _.TryConsume(permit: obj) : obj =
        lock gate (fun () ->
            match inspectPermit permit |> decideConsume with
            | Ok(struct (key, next)) ->
                activities <- Map.add key next activities
                okResult ()
            | Error failure -> errorResult failure)

    member _.TryRelease(permit: obj) : obj =
        lock gate (fun () ->
            match inspectPermit permit |> decideRelease with
            | Ok(struct (key, next)) ->
                activities <- Map.add key next activities
                okResult ()
            | Error failure -> errorResult failure)

    member _.RevokeCurrentAttempt(sessionId: string) : unit =
        lock gate (fun () ->
            let serial = nextSerial sessionId
            currentPermits.Remove sessionId |> ignore
            serials <- Map.add sessionId serial serials
            activities <- Map.add sessionId (Activity.Revoked serial) activities)

    member _.LivePermitCount: int = lock gate (fun () -> currentPermits.Count)

    member _.DropSession(sessionId: string) : unit =
        lock gate (fun () ->
            currentPermits.Remove sessionId |> ignore
            serials <- Map.add sessionId (nextSerial sessionId) serials
            activities <- Map.remove sessionId activities
            physicalMessages <- Map.remove sessionId physicalMessages
            activeToolCounts <- Map.remove sessionId activeToolCounts)

    // CamelCase aliases for JavaScript callers
    member this.beginProviderAttempt(sessionId: string) : unit = this.BeginProviderAttempt(sessionId)
    member this.beginToolExecution(sessionId: string) : unit = this.BeginToolExecution(sessionId)
    member this.endToolExecution(sessionId: string) : unit = this.EndToolExecution(sessionId)
    member this.observePhysicalUserMessage(sessionId: string, physicalUserMessageId: string) : unit =
        this.ObservePhysicalUserMessage(sessionId, physicalUserMessageId)
    member this.observeIdle(sessionId: string) : obj = this.ObserveIdle(sessionId)
    member this.captureCurrentAttempt(sessionId: string) : obj = this.CaptureCurrentAttempt(sessionId)
    member this.observeIdleFor(observation: obj) : obj = this.ObserveIdleFor(observation)
    member this.tryConsume(permit: obj) : obj = this.TryConsume(permit)
    member this.tryRelease(permit: obj) : obj = this.TryRelease(permit)
    member this.revokeCurrentAttempt(sessionId: string) : unit = this.RevokeCurrentAttempt(sessionId)
    member this.dropSession(sessionId: string) : unit = this.DropSession(sessionId)
    member this.livePermitCount() : int = this.LivePermitCount

let sessionQuiescenceGate = SessionQuiescenceGate()
