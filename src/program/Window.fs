namespace Wanxiangli.Program

open System.Collections.Generic
open Wanxiangli.Program.Native

type internal RequestWindow(runtime: obj, deadline: float) =
    let observers = Dictionary<int, unit -> unit>()
    let mutable nextId = 0
    let mutable expired = false
    let mutable timer: obj = null

    let expire () =
        if not expired then
            expired <- true
            cancel timer
            timer <- (null: obj)
            let callbacks = observers.Values |> Seq.toArray |> Array.rev
            observers.Clear()

            for callback in callbacks do
                callback ()

    member _.Deadline = deadline

    member _.CanContinue() =
        if not expired && now runtime >= deadline then
            expire ()

        not expired

    member _.Subscribe(callback: unit -> unit) =
        nextId <- nextId + 1
        let id = nextId
        observers.Add(id, callback)

        if expired then
            observers.Remove id |> ignore
            callback ()
        elif missing timer then
            timer <- schedule runtime (max 0.0 (deadline - now runtime)) expire

        fun () ->
            observers.Remove id |> ignore

            if observers.Count = 0 then
                cancel timer
                timer <- (null: obj)
