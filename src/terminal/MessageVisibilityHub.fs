module Wanxiangli.Terminal.MessageVisibilityHub

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

type VisibilityDeadlineHandle =
    { Delay: Task<unit>
      Cancel: unit -> unit }

type private VisibilityWaiter =
    { Completion: TaskCompletionSource<unit>
      Deadline: VisibilityDeadlineHandle
      mutable Settled: bool }

module private MessageVisibilityDeadline =

    [<Emit("(() => {
        let timer = null;
        const promise = new Promise((resolve) => {
            timer = setTimeout(resolve, $0);
        });
        return {
            Delay: promise,
            delay: promise,
            Cancel: () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
            },
            cancel: () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
            }
        };
    })()")>]
    let createDefaultDeadline (budgetMs: int) : VisibilityDeadlineHandle = jsNative

    [<Emit("(() => {
        const raw = typeof $0 === 'function' ? $0($1) : ($0 && typeof $0.Delay === 'function' ? $0.Delay($1) : ($0 && typeof $0.delay === 'function' ? $0.delay($1) : null));
        if (!raw) {
            return {
                Delay: Promise.resolve(),
                delay: Promise.resolve(),
                Cancel: () => {},
                cancel: () => {}
            };
        }
        const promise = raw.Delay || raw.delay || raw;
        const cancelFn = typeof raw.Cancel === 'function' ? () => raw.Cancel() : (typeof raw.cancel === 'function' ? () => raw.cancel() : () => {});
        return {
            Delay: promise,
            delay: promise,
            Cancel: cancelFn,
            cancel: cancelFn
        };
    })()")>]
    let invokeCustomDeadline (factory: obj) (budgetMs: int) : VisibilityDeadlineHandle = jsNative

    let resolveDeadline (timerArgOpt: obj option) (budgetMs: int) : VisibilityDeadlineHandle =
        match timerArgOpt with
        | None -> createDefaultDeadline budgetMs
        | Some arg when isNull arg -> createDefaultDeadline budgetMs
        | Some arg -> invokeCustomDeadline arg budgetMs

open MessageVisibilityDeadline

module private MessageVisibilityRegistry =

    let trySetCompletion (completion: TaskCompletionSource<unit>) : unit =
        try
            completion.SetResult(())
        with _ ->
            ()

    let settleWaiter (waiter: VisibilityWaiter) : unit =
        if not waiter.Settled then
            waiter.Settled <- true
            trySetCompletion waiter.Completion

    let cancelWaiter (waiter: VisibilityWaiter) : unit =
        try
            waiter.Deadline.Cancel()
        with _ ->
            ()
        settleWaiter waiter

    let dropKeyWhenEmpty (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) (key: string) (list: ResizeArray<VisibilityWaiter>) : unit =
        match list.Count with
        | 0 -> waiters.Remove key |> ignore
        | _ -> ()

    let removeWaiterFromList (list: ResizeArray<VisibilityWaiter>) (waiter: VisibilityWaiter) : unit =
        list.Remove waiter |> ignore

    let removeWaiter (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) (key: string) (waiter: VisibilityWaiter) : unit =
        match waiters.TryGetValue key with
        | true, list ->
            removeWaiterFromList list waiter
            dropKeyWhenEmpty waiters key list
        | false, _ -> ()

    let takeWaiters (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) (key: string) : VisibilityWaiter list =
        match waiters.TryGetValue key with
        | true, list ->
            waiters.Remove key |> ignore
            Seq.toList list
        | false, _ -> []

    let appendWaiterToList (list: ResizeArray<VisibilityWaiter>) (waiter: VisibilityWaiter) : unit =
        list.Add waiter

    let insertNewWaiterList (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) (key: string) (waiter: VisibilityWaiter) : unit =
        let list = ResizeArray<VisibilityWaiter>()
        list.Add waiter
        waiters.[key] <- list

    let appendWaiter (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) (key: string) (waiter: VisibilityWaiter) : unit =
        match waiters.TryGetValue key with
        | true, list -> appendWaiterToList list waiter
        | false, _ -> insertNewWaiterList waiters key waiter

    let countWaiters (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) (key: string) : int =
        match waiters.TryGetValue key with
        | true, list -> list.Count
        | false, _ -> 0

    let clearAllWaiters (waiters: Dictionary<string, ResizeArray<VisibilityWaiter>>) : VisibilityWaiter list =
        let all =
            waiters.Values
            |> Seq.collect id
            |> Seq.toList
        waiters.Clear()
        all

open MessageVisibilityRegistry

/// Autonomous hub for event-driven projection visibility catch-up.
/// Waiters are per-session one-shot completions with a deadline backstop.
[<AttachMembers>]
type MessageVisibilityHub(?timerArg: obj) =
    let gate = obj ()
    let waiters = Dictionary<string, ResizeArray<VisibilityWaiter>>()

    let settle (key: string) (waiter: VisibilityWaiter) : unit =
        lock gate (fun () -> removeWaiter waiters key waiter)
        settleWaiter waiter

    let attachDeadline (key: string) (waiter: VisibilityWaiter) : unit =
        emitJsExpr (waiter.Deadline.Delay, (fun () -> settle key waiter)) "$0.then($1)"
        |> ignore

    /// Wake every waiter whose session just published a message lifecycle event.
    /// Atomically takes and removes all waiters for the session, cancels their deadline, and resolves completion.
    member _.Notify(sessionId: string) : unit =
        let pending = lock gate (fun () -> takeWaiters waiters sessionId)
        for waiter in pending do
            cancelWaiter waiter

    /// Resolves on the next `message.updated` (Notify) for the session,
    /// or when the deadline budget expires without one.
    /// Settled waiter is automatically removed from the registry.
    member _.AwaitChange(sessionId: string, budgetMilliseconds: int) : Task<unit> =
        let completion = TaskCompletionSource<unit>()
        let deadline = resolveDeadline timerArg budgetMilliseconds
        let waiter =
            { Completion = completion
              Deadline = deadline
              Settled = false }

        lock gate (fun () -> appendWaiter waiters sessionId waiter)
        attachDeadline sessionId waiter
        completion.Task

    /// Pending waiter count for one session — leak-detection probe.
    member _.PendingCount(sessionId: string) : int =
        lock gate (fun () -> countWaiters waiters sessionId)

    /// Explicitly clear and cancel all waiters for a session.
    member _.Clear(sessionId: string) : unit =
        let pending = lock gate (fun () -> takeWaiters waiters sessionId)
        for waiter in pending do
            cancelWaiter waiter

    /// Explicitly clear and cancel all waiters across all sessions.
    member _.ClearAll() : unit =
        let pending = lock gate (fun () -> clearAllWaiters waiters)
        for waiter in pending do
            cancelWaiter waiter

    // CamelCase aliases for JavaScript callers
    member this.notify(sessionId: string) : unit = this.Notify(sessionId)
    member this.awaitChange(sessionId: string, budgetMilliseconds: int) : Task<unit> = this.AwaitChange(sessionId, budgetMilliseconds)
    member this.pendingCount(sessionId: string) : int = this.PendingCount(sessionId)
    member this.clear(sessionId: string) : unit = this.Clear(sessionId)
    member this.clearAll() : unit = this.ClearAll()

let messageVisibilityHub = MessageVisibilityHub()
