[<AutoOpen>]
module Wanxiangli.Runtime.LargeGate

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

type internal GateWaiter = {
    mutable Canceled: bool
    Grant: unit -> unit
}

module internal GateSignal =
    [<Emit("new Promise((resolve, reject) => $0(resolve, reject))")>]
    let promise (_executor: (unit -> unit) -> (obj -> unit) -> unit) : JS.Promise<unit> = jsNative

    [<Emit("$0.aborted")>]
    let private getAborted (_signal: obj) : bool = jsNative

    [<Emit("$0.removeEventListener('abort', $1)")>]
    let private removeAbortListener (_signal: obj) (_handler: unit -> unit) : unit = jsNative

    [<Emit("$0.addEventListener('abort', $1, { once: true })")>]
    let private addAbortOnceListener (_signal: obj) (_handler: unit -> unit) : unit = jsNative

    [<Emit("new DOMException('The operation was aborted.', 'AbortError')")>]
    let createAbortError () : obj = jsNative

    let isAborted (signal: obj) : bool =
        if isNullOrUndefined signal then
            false
        else
            getAborted signal

    let removeAbort (signal: obj) (handler: unit -> unit) : unit =
        if not (isNullOrUndefined signal) then
            removeAbortListener signal handler

    let addAbortOnce (signal: obj) (handler: unit -> unit) : unit =
        if not (isNullOrUndefined signal) then
            addAbortOnceListener signal handler

[<AttachMembers>]
type LargeGate() =
    let waiters = Queue<GateWaiter>()
    let mutable held = false

    let tryGrantWaiter (w: GateWaiter) =
        if w.Canceled then
            false
        else
            held <- true
            w.Grant()
            true

    let canPump () =
        waiters.Count > 0 && not held

    let rec pump () =
        if canPump () then
            let w = waiters.Dequeue()
            let _ = tryGrantWaiter w
            pump ()

    let enqueuePromise (this: LargeGate) (resolve: unit -> unit) (reject: obj -> unit) (signal: obj) =
        let mutable cancelWaiter = fun () -> ()
        let onAbort () =
            cancelWaiter ()
            reject (GateSignal.createAbortError ())
        let cleanupAndResolve () =
            GateSignal.removeAbort signal onAbort
            resolve ()
        cancelWaiter <- this.enqueue cleanupAndResolve
        GateSignal.addAbortOnce signal onAbort

    member _.getCount() : int =
        if held then 0 else 1

    member _.tryAcquire() : bool =
        if not held && waiters.Count = 0 then
            held <- true
            true
        else
            false

    member _.enqueue(onGrant: unit -> unit) : (unit -> unit) =
        let w = { Canceled = false; Grant = onGrant }
        waiters.Enqueue(w)
        pump ()
        fun () -> w.Canceled <- true

    member _.release() : unit =
        held <- false
        pump ()

    member this.acquire(?signal: obj) : JS.Promise<unit> =
        GateSignal.promise (fun resolve reject ->
            this._acquirePromise(resolve, reject, signal |> Option.defaultValue null))

    member this._acquirePromise(resolve: unit -> unit, reject: obj -> unit, signal: obj) : unit =
        if GateSignal.isAborted signal then
            reject (GateSignal.createAbortError ())
        elif this.tryAcquire() then
            resolve ()
        else
            enqueuePromise this resolve reject signal

let largeGate = LargeGate()
