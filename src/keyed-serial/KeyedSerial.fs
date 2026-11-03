namespace Wanxiangli.KeyedSerial

open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core

module private Queues =
    [<Emit("new WeakMap()")>]
    let private createOwners () : obj = jsNative

    [<Emit("$0.get($1)")>]
    let private get (_owners: obj) (_owner: obj) : obj = jsNative

    [<Emit("$0.set($1, $2)")>]
    let private set (_owners: obj) (_owner: obj) (_value: obj) : unit = jsNative

    [<Emit("$0 === undefined")>]
    let private missing (_value: obj) : bool = jsNative

    [<Emit("$0()")>]
    let private invoke (_action: obj) : Task<obj> = jsNative

    // 弱键关联每个实例的私有尾表，不向调用方暴露队列或延长实例寿命。
    let private owners = createOwners ()

    let private tails (owner: obj) : Dictionary<string, Task<unit>> =
        let current = get owners owner
        if missing current then
            let created = Dictionary<string, Task<unit>>()
            set owners owner (box created)
            created
        else
            unbox current

    type private Completion() =
        let mutable resolve: (unit -> unit) = ignore
        let promise: JS.Promise<unit> = JS.Constructors.Promise.Create(fun complete _ -> resolve <- complete)
        member _.Task: Task<unit> = unbox promise
        member _.Release() = resolve ()

    let run (owner: obj) (key: string) (action: obj) : Task<obj> =
        let queue = tails owner
        let completion = Completion()
        let signal = completion.Task
        let prior =
            match queue.TryGetValue key with
            | true, current -> current
            | false, _ -> Task.FromResult ()

        // 登记在返回前完成；即使没有前驱，Bind 也让 action 经微任务启动。
        queue[key] <- signal
        task {
            do! prior
            try
                return! invoke action
            finally
                completion.Release()
                match queue.TryGetValue key with
                | true, current when obj.ReferenceEquals(current, signal) -> queue.Remove key |> ignore
                | _ -> ()
        }

[<AttachMembers>]
type KeyedSerial() =
    member this.run(key: string, action: obj) : Task<obj> = Queues.run this key action
