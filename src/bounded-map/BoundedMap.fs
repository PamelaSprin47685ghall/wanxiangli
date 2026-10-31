module Wanxiangli.BoundedMap

open System.Threading.Tasks
open Fable.Core

[<Emit("Number.isSafeInteger($0) && $0 > 0")>]
let private validLimit (_value: float) : bool = jsNative

[<Emit("$0 === undefined || $0 === null ? new AbortController().signal : $0")>]
let private signalOrDefault (_signal: obj) : obj = jsNative

[<Emit("$0.throwIfAborted()")>]
let private checkCancellation (_signal: obj) : unit = jsNative

[<Emit("$0($1, $2)")>]
let private invoke (_action: obj) (_item: obj) (_signal: obj) : Task<obj> = jsNative

[<Emit("Promise.all($0)")>]
let private promiseAll (_tasks: Task<obj> array) : Task<obj array> = jsNative

type private PendingPermit() =
    let mutable complete: (unit -> unit) = ignore
    let promise: JS.Promise<unit> = JS.Constructors.Promise.Create(fun resolve _ -> complete <- resolve)
    member _.Task: Task<unit> = unbox promise
    member _.Release() = complete ()

/// 许可和等待队列只属于一次映射调用；取走许可的任务负责归还。
type private Semaphore(limit: float) =
    let mutable available = limit
    let waiting = System.Collections.Generic.Queue<PendingPermit>()

    member _.Wait(signal: obj) =
        task {
            checkCancellation signal
            if available > 0.0 then
                available <- available - 1.0
            else
                let pending = PendingPermit()
                waiting.Enqueue pending
                do! pending.Task
        }

    member _.Release() =
        if waiting.Count > 0 then
            waiting.Dequeue().Release()
        else
            available <- available + 1.0

let private run (semaphore: Semaphore) signal action item =
    task {
        do! semaphore.Wait signal
        try
            checkCancellation signal
            return! invoke action item signal
        finally
            semaphore.Release()
    }

/// 首个拒绝提前返回；其余任务继续，调用方不能把拒绝理解为所有效果已结束。
let mapBounded (maxConcurrency: float) (action: obj) (items: obj array) (signal: obj) : Task<obj array> =
    task {
        if not (validLimit maxConcurrency) then
            invalidArg "maxConcurrency" "maxConcurrency must be a positive safe integer"

        let snapshot = Array.copy items
        if snapshot.Length = 0 then
            return [||]
        else
            let signal = signalOrDefault signal
            let semaphore = Semaphore maxConcurrency
            let tasks = snapshot |> Array.map (run semaphore signal action)
            return! promiseAll tasks
    }
