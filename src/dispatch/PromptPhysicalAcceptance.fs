module Wanxiangli.Dispatch.PromptPhysicalAcceptance

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private AcceptanceInternal =

    [<Emit("typeof process !== 'undefined' && process.env && process.env.WANXIANGSHU_ADMISSION_TIMEOUT_MS")>]
    let envTimeoutValue () : obj = jsNative

    [<Emit("(function(){let timer;return Promise.race([$0.then(function(v){return{ok:true,v:v};}),$1.then(function(){return{ok:false};}),new Promise(function(r){timer=setTimeout(function(){r({ok:false});},$2);})]).finally(function(){clearTimeout(timer);});})()")>]
    let raceTimeout (task: Task<obj>) (released: Task<unit>) (ms: int) : Task<obj> = jsNative

    [<Literal>]
    let DefaultAdmissionTimeoutMs = 10000

    let parseAdmissionTimeout (value: string) : int =
        match System.Int32.TryParse value with
        | true, parsed when parsed > 0 -> parsed
        | _ -> DefaultAdmissionTimeoutMs

    let admissionTimeoutFromEnvironment () : int =
        let raw = envTimeoutValue ()
        if isNull raw || jsTypeof raw <> "string" then
            DefaultAdmissionTimeoutMs
        else
            parseAdmissionTimeout (unbox<string> raw)

    let confirmationOutcome (result: obj) : obj option =
        if unbox<bool> (result?ok) then
            Some(result?v)
        else
            None

    let trySetResult (tcs: TaskCompletionSource<'T>) (value: 'T) =
        try
            tcs.SetResult value
            true
        with _ ->
            false

type private CallbackRegistration =
    { Notify: string -> unit }

[<AttachMembers>]
type PromptPhysicalAcceptance() =
    let gate = obj ()
    let callbacks = Dictionary<string, CallbackRegistration>()
    let waiters = Dictionary<string, ResizeArray<TaskCompletionSource<obj>>>()

    let takeWaiters (key: string) : TaskCompletionSource<obj> array =
        match waiters.TryGetValue key with
        | true, pending ->
            waiters.Remove key |> ignore
            pending.ToArray()
        | false, _ -> [||]

    let removeWaiter (key: string) (pending: ResizeArray<TaskCompletionSource<obj>>) (waiter: TaskCompletionSource<obj>) =
        let index = pending.FindIndex(fun current -> Object.ReferenceEquals(current, waiter))
        if index >= 0 then
            pending.RemoveAt index
        if index >= 0 && pending.Count = 0 then
            waiters.Remove key |> ignore
        index >= 0

    let releaseWaiter (key: string) (waiter: TaskCompletionSource<obj>) =
        lock gate (fun () ->
            match waiters.TryGetValue key with
            | true, pending -> removeWaiter key pending waiter
            | false, _ -> false)

    let completeWaiters (pending: TaskCompletionSource<obj> array) (outcome: obj) =
        for waiter in pending do
            AcceptanceInternal.trySetResult waiter outcome |> ignore

    member _.register(promptKey: string, callback: string -> unit) : obj =
        if String.IsNullOrWhiteSpace promptKey || isNull (box callback) then
            createObj [ "dispose" ==> (fun () -> ()) ]
        else
            let key = promptKey.Trim()
            let registration = { Notify = callback }
            lock gate (fun () -> callbacks.[key] <- registration)

            createObj [
                "dispose" ==> (fun () ->
                    lock gate (fun () ->
                        match callbacks.TryGetValue key with
                        | true, current when Object.ReferenceEquals(current, registration) ->
                            callbacks.Remove key |> ignore
                        | _ -> ()))
            ]

    member _.cancel(promptKey: string) : unit =
        if not (String.IsNullOrWhiteSpace promptKey) then
            let key = promptKey.Trim()
            let pending =
                lock gate (fun () ->
                    callbacks.Remove key |> ignore
                    takeWaiters key)
            let rejectedOutcome = createObj [ "kind" ==> "Rejected"; "reason" ==> "Cancelled" ]
            completeWaiters pending rejectedOutcome

    member _.accepted(promptKey: string, physicalUserMessageId: string) : unit =
        if not (String.IsNullOrWhiteSpace promptKey) then
            let key = promptKey.Trim()
            let pid = if isNull physicalUserMessageId then "" else physicalUserMessageId
            let callback, pending =
                lock gate (fun () ->
                    let cb =
                        match callbacks.TryGetValue key with
                        | true, registration ->
                            callbacks.Remove key |> ignore
                            Some registration.Notify
                        | false, _ -> None
                    cb, takeWaiters key)
            try
                callback |> Option.iter (fun notify -> notify pid)
            finally
                let acceptedOutcome = createObj [ "kind" ==> "Accepted"; "physicalUserMessageId" ==> pid ]
                completeWaiters pending acceptedOutcome

    member _.rejected(promptKey: string, reason: string) : unit =
        if not (String.IsNullOrWhiteSpace promptKey) then
            let key = promptKey.Trim()
            let r = if isNull reason then "Rejected" else reason
            let pending =
                lock gate (fun () ->
                    callbacks.Remove key |> ignore
                    takeWaiters key)
            let rejectedOutcome = createObj [ "kind" ==> "Rejected"; "reason" ==> r ]
            completeWaiters pending rejectedOutcome

    member _.beginConfirmation(promptKey: string, timeoutMs: int option) : Task<obj option> * obj =
        if String.IsNullOrWhiteSpace promptKey then
            let tcs = TaskCompletionSource<obj option>()
            tcs.SetResult None
            tcs.Task, createObj [ "dispose" ==> (fun () -> ()) ]
        else
            let key = promptKey.Trim()
            let waiter = TaskCompletionSource<obj>(TaskCreationOptions.RunContinuationsAsynchronously)
            let released = TaskCompletionSource<unit>(TaskCreationOptions.RunContinuationsAsynchronously)

            lock gate (fun () ->
                let pending =
                    match waiters.TryGetValue key with
                    | true, existing -> existing
                    | false, _ ->
                        let created = ResizeArray<TaskCompletionSource<obj>>()
                        waiters.[key] <- created
                        created
                pending.Add waiter)

            let ms =
                match timeoutMs with
                | Some m when m > 0 -> m
                | _ -> AcceptanceInternal.admissionTimeoutFromEnvironment ()

            let subscription =
                createObj [
                    "dispose" ==> (fun () ->
                        if releaseWaiter key waiter then
                            AcceptanceInternal.trySetResult released () |> ignore)
                ]

            let outcome =
                task {
                    try
                        let! (res: obj) = AcceptanceInternal.raceTimeout waiter.Task released.Task ms
                        return AcceptanceInternal.confirmationOutcome res
                    finally
                        subscription?dispose()
                }

            outcome, subscription

    member this.awaitConfirmation(promptKey: string, timeoutMs: int option) : Task<obj option> =
        this.beginConfirmation(promptKey, timeoutMs) |> fst

    member _.clear() : unit =
        lock gate (fun () ->
            callbacks.Clear()
            waiters.Clear())

let promptPhysicalAcceptance = PromptPhysicalAcceptance()
