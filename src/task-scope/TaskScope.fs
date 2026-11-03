namespace Wanxiangli.TaskScope

open System.Threading.Tasks
open Fable.Core

module private Scopes =
    type private Signal() =
        let mutable complete: unit -> unit = ignore
        let promise: JS.Promise<unit> = JS.Constructors.Promise.Create(fun resolve _ -> complete <- resolve)
        member _.Task: Task<unit> = unbox promise
        member _.Release() = complete ()

    type private State =
        { mutable Accepting: bool
          mutable Count: int
          mutable Observed: Signal option
          mutable Closed: Signal option
          mutable HasFailure: bool
          mutable Failure: obj }

    [<Emit("new WeakMap()")>]
    let private createOwners () : obj = jsNative

    let private owners = createOwners ()

    [<Emit("$0.get($1)")>]
    let private get (_owners: obj) (_owner: obj) : obj = jsNative

    [<Emit("$0.set($1, $2)")>]
    let private set (_owners: obj) (_owner: obj) (_state: State) : unit = jsNative

    [<Emit("$0 === undefined")>]
    let private missing (_value: obj) : bool = jsNative

    let private state owner =
        let current = get owners owner
        if missing current then
            let created: State =
                { Accepting = true; Count = 0; Observed = None; Closed = None
                  HasFailure = false; Failure = (null: obj) }
            set owners owner created
            created
        else unbox<State> current

    [<Emit("$0()")>]
    let private invoke (_work: obj) : Task<unit> = jsNative

    [<Emit("({ok: true})")>]
    let private success () : obj = jsNative

    [<Emit("({ok: false, error: $0})")>]
    let private failure (_error: obj) : obj = jsNative

    [<Emit("$0.ok")>]
    let private isSuccess (_result: obj) : bool = jsNative

    [<Emit("$0.error")>]
    let private errorOf (_result: obj) : obj = jsNative

    let private admit (scope: State) =
        if not scope.Accepting then false
        else
            scope.Count <- scope.Count + 1
            true

    let private finish (scope: State) =
        scope.Count <- scope.Count - 1
        if scope.Count = 0 then
            scope.Observed |> Option.iter (fun signal -> signal.Release())
            scope.Observed <- None
        if not scope.Accepting && scope.Count = 0 then
            scope.Closed |> Option.iter (fun signal -> signal.Release())

    let private capture work : Task<obj> =
        task {
            try
                do! invoke work
                return success ()
            with cause -> return failure (box cause)
        }

    let private observe scope work : Task<unit> =
        task {
            let! result = capture work
            if not (isSuccess result) then
                scope.HasFailure <- true
                scope.Failure <- errorOf result
            finish scope
        }

    let run owner work : Task<unit> =
        let scope = state owner
        if admit scope then
            task {
                try do! invoke work
                finally finish scope
            }
        else Task.FromResult ()

    let background owner work : Task<unit> =
        let scope = state owner
        if admit scope then observe scope work
        else Task.FromResult ()

    let private readFailure scope =
        if scope.HasFailure then failure scope.Failure else success ()

    let private observedTask scope =
        match scope.Observed with
        | Some signal -> signal.Task
        | None ->
            let signal = Signal()
            scope.Observed <- Some signal
            signal.Task

    let private closedTask scope =
        match scope.Closed with
        | Some signal -> signal.Task
        | None ->
            let signal = Signal()
            scope.Closed <- Some signal
            signal.Task

    let waitIdle owner : Task<obj> =
        let scope = state owner
        let waiting = if scope.Count = 0 then Task.FromResult () else observedTask scope
        task {
            do! waiting
            return readFailure scope
        }

    let close owner : Task<obj> =
        let scope = state owner
        // 关接纳在返回前完成；等待和错误读取仍在原 TaskBuilder 阶段。
        scope.Accepting <- false
        let waiting = if scope.Count = 0 then Task.FromResult () else closedTask scope
        task {
            do! waiting
            return readFailure scope
        }

[<AttachMembers>]
type TaskScope() =
    member this.run(work: obj) : Task<unit> = Scopes.run this work
    member this.background(work: obj) : Task<unit> = Scopes.background this work
    member this.waitIdle() : Task<obj> = Scopes.waitIdle this
    member this.close() : Task<obj> = Scopes.close this
