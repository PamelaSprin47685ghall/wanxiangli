namespace Wanxiangli.Terminal

open System
open System.Collections.Generic
open Fable.Core

/// Neutral termination outcome for session execution.
/// Carries optional provider run identifier for completion deduplication,
/// and opaque payload (e.g. text, error or underlying host outcome).
[<AttachMembers>]
type TerminalOutcome private (tag: string, fields: obj array, runId: string option, payload: obj) =
    member _.tag: string = tag
    member _.fields: obj array = fields
    member _.Tag: string = tag
    member _.Fields: obj array = fields
    member _.RunId: string option = runId
    member _.Payload: obj = payload
    member _.Kind: string = tag

    static member Completed(runId: string option, payload: obj) =
        TerminalOutcome("Completed", [| box runId; payload |], runId, payload)

    static member Failed(payload: obj) =
        TerminalOutcome("Failed", [| payload |], None, payload)

    static member Aborted(payload: obj) =
        TerminalOutcome("Aborted", [| payload |], None, payload)

/// Listener signature for session terminal events.
type TerminalCompletionListener = string -> TerminalOutcome -> unit

module private TerminalInternal =

    type Registration =
        { Session: string option
          Listener: TerminalCompletionListener
          mutable Live: bool }

open TerminalInternal

[<AttachMembers>]
type TerminalSubscription(onDispose: unit -> unit) =
    interface IDisposable with
        member _.Dispose() = onDispose ()
    member _.Dispose() = onDispose ()
    member _.dispose() = onDispose ()

/// Single autonomous holder of terminal facts, sticky replay cache,
/// idempotence deduplication, and active listener dispatch.
[<AttachMembers>]
type TerminalRegistry(reportFault: exn -> unit) =

    let listeners = ResizeArray<Registration>()
    let lockObj = obj ()

    let lastCompletedRun = Dictionary<string, string>()

    let stickyTerminal = Dictionary<string, TerminalOutcome>()
    let stickyOrder = Queue<string>()
    let stickyCap = 256

    let trimSticky () =
        while stickyOrder.Count > stickyCap do
            let evicted = stickyOrder.Dequeue()
            stickyTerminal.Remove evicted |> ignore

    let rememberSticky (key: string) (outcome: TerminalOutcome) =
        lock lockObj (fun () ->
            let isNew = not (stickyTerminal.ContainsKey key)
            stickyTerminal[key] <- outcome

            if isNew then
                stickyOrder.Enqueue key
                trimSticky ()

            listeners.Count > 0
            && listeners |> Seq.exists (fun registration -> registration.Live))

    let isAddressed (registration: Registration) (sessionId: string) =
        match registration.Session with
        | None -> true
        | Some wanted -> wanted = sessionId

    let deliverSafely (registration: Registration) (sessionId: string) (outcome: TerminalOutcome) =
        try
            registration.Listener sessionId outcome
        with error ->
            reportFault error

    let deliver (registration: Registration) (sessionId: string) (outcome: TerminalOutcome) =
        if registration.Live && isAddressed registration sessionId then
            deliverSafely registration sessionId outcome

    let notify (sessionId: string) (outcome: TerminalOutcome) =
        let handlers = lock lockObj (fun () -> listeners |> Seq.toList)
        for registration in handlers do
            deliver registration sessionId outcome

    let replaySticky (session: string option) (listener: TerminalCompletionListener) =
        let replay =
            lock lockObj (fun () ->
                stickyTerminal
                |> Seq.map (fun kv -> kv.Key, kv.Value)
                |> Seq.filter (fun (key, _) ->
                    match session with
                    | None -> true
                    | Some wanted -> key = wanted)
                |> Seq.toList)

        for sessionKey, outcome in replay do
            listener sessionKey outcome

    let subscribe
        (session: string option)
        (replayStickyTerminals: bool)
        (listener: TerminalCompletionListener)
        : IDisposable =
        let registration =
            lock lockObj (fun () ->
                let reg =
                    { Session = session
                      Listener = listener
                      Live = true }
                listeners.Add reg
                reg)

        if replayStickyTerminals then
            replaySticky session listener

        TerminalSubscription(fun () ->
            lock lockObj (fun () ->
                registration.Live <- false
                listeners.Remove registration |> ignore)) :> IDisposable

    let isCompletedRunDuplicate (sessionId: string) (runId: string option) =
        match runId with
        | None -> false
        | Some run when String.IsNullOrWhiteSpace run -> false
        | Some run ->
            lock lockObj (fun () ->
                match lastCompletedRun.TryGetValue sessionId with
                | true, last when last = run -> true
                | _ ->
                    lastCompletedRun[sessionId] <- run
                    false)

    /// A terminal fact proven by the caller, published to active subscribers.
    /// Returns whether any subscriber (session or process) was live when the fact landed.
    member _.NotifyTerminal(sessionId: string, outcome: TerminalOutcome) : bool =
        let duplicate =
            if outcome.Kind = "Completed" then
                isCompletedRunDuplicate sessionId outcome.RunId
            else
                false

        if duplicate then
            false
        else
            let hasListeners = rememberSticky sessionId outcome
            notify sessionId outcome
            hasListeners

    /// Sticky subscription for one session: replays last proven terminal, then delivers future ones.
    member _.SubscribeTerminal(sessionId: string, listener: TerminalCompletionListener) : IDisposable =
        subscribe (Some sessionId) true listener

    /// Future-only subscription for one session: delivers only terminals arriving after subscription.
    member _.SubscribeFutureTerminal(sessionId: string, listener: TerminalCompletionListener) : IDisposable =
        subscribe (Some sessionId) false listener

    /// Process-wide sticky subscription: replays all cached sticky terminals, then delivers future ones.
    member _.SubscribeProcessTerminal(listener: TerminalCompletionListener) : IDisposable =
        subscribe None true listener

    /// Process-wide future-only subscription: delivers all future session terminals.
    member _.SubscribeProcessFutureTerminal(listener: TerminalCompletionListener) : IDisposable =
        subscribe None false listener

    /// Whether the specific session has a live session-level subscriber.
    member _.HasSubscriber(sessionId: string) : bool =
        lock lockObj (fun () ->
            listeners
            |> Seq.exists (fun registration -> registration.Live && registration.Session = Some sessionId))

    /// Alias matching ISessionTerminalSource contract.
    member this.HasSessionSubscriber(sessionId: string) : bool =
        this.HasSubscriber(sessionId)

type private SharedPort =
    { Source: obj
      mutable RefCount: int }

/// Autonomous reference-counted bus for sharing TerminalRegistry instances across workspaces or scopes.
[<AttachMembers>]
type TerminalBus() =

    let gate = obj ()
    let shared = Dictionary<string, SharedPort>()

    /// Acquire or register a source for key. First-wins: if key already exists,
    /// increments refcount and returns existing source; otherwise stores candidate with refcount 1.
    member _.Acquire(key: string, candidate: obj) : obj =
        lock gate (fun () ->
            match shared.TryGetValue key with
            | true, entry ->
                entry.RefCount <- entry.RefCount + 1
                entry.Source
            | false, _ ->
                shared[key] <- { Source = candidate; RefCount = 1 }
                candidate)

    /// Decrements refcount if target matches the active source for key by reference equality.
    /// Removes entry when refcount reaches 0. Returns true if removed.
    member _.Release(key: string, target: obj) : bool =
        lock gate (fun () ->
            match shared.TryGetValue key with
            | true, entry when obj.ReferenceEquals(entry.Source, target) ->
                let remaining = entry.RefCount - 1
                if remaining <= 0 then
                    shared.Remove key |> ignore
                    true
                else
                    entry.RefCount <- remaining
                    false
            | _ -> false)

    /// Current refcount for key, or 0 if not present.
    member _.Count(key: string) : int =
        lock gate (fun () ->
            match shared.TryGetValue key with
            | true, entry -> entry.RefCount
            | false, _ -> 0)
