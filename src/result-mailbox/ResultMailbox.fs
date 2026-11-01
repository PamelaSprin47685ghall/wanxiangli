namespace Wanxiangli.ResultMailbox

open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core

module private Mailboxes =
    type private Signal() =
        let mutable complete: unit -> unit = ignore
        let promise: JS.Promise<unit> = JS.Constructors.Promise.Create(fun resolve _ -> complete <- resolve)
        member _.Task: Task<unit> = unbox promise
        member _.Release() = complete ()

    type private State =
        { Values: Queue<obj>
          Waiters: Queue<Signal>
          mutable Active: int }

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
            let created = { Values = Queue<obj>(); Waiters = Queue<Signal>(); Active = 0 }
            set owners owner created
            created
        else unbox<State> current

    [<Emit("({kind: 'items', items: $0})")>]
    let private items (_values: obj array) : obj = jsNative

    [<Emit("({kind: 'empty'})")>]
    let private empty () : obj = jsNative

    [<Emit("({kind: 'ready', result: $0})")>]
    let private ready (_result: obj) : obj = jsNative

    [<Emit("({kind: 'pending', completion: $0})")>]
    let private pending (_completion: Task<obj>) : obj = jsNative

    [<Emit("$0.then(undefined, () => {})")>]
    let private observeRejection (_interrupt: obj) : unit = jsNative

    [<Emit("Promise.race([$0.then(() => ({kind: 'empty'})), $1.then(reason => ({kind: 'interrupted', reason}))])")>]
    let private race (_signal: Task<unit>) (_interrupt: obj) : Task<obj> = jsNative

    let private drainState (mailbox: State) maxCount =
        let values = ResizeArray<obj>()
        let mutable count = 0
        while count < maxCount && mailbox.Values.Count > 0 do
            count <- count + 1
            values.Add(mailbox.Values.Dequeue())
        values.ToArray()

    let start owner =
        let mailbox = state owner
        mailbox.Active <- mailbox.Active + 1

    let publish owner value =
        let mailbox = state owner
        mailbox.Active <- max 0 (mailbox.Active - 1)
        mailbox.Values.Enqueue value
        if mailbox.Waiters.Count > 0 then mailbox.Waiters.Dequeue().Release()

    let drain owner maxCount = drainState (state owner) maxCount
    let hasActive owner = (state owner).Active > 0
    let pendingCount owner = (state owner).Values.Count

    let private dropWaiter (mailbox: State) (waiter: Signal) =
        let count = mailbox.Waiters.Count
        for _ in 1..count do
            let other = mailbox.Waiters.Dequeue()
            if not (obj.ReferenceEquals(other, waiter)) then mailbox.Waiters.Enqueue other
        waiter.Release()

    let private completion (mailbox: State) (waiter: Signal) maxCount interrupt =
        task {
            try
                let! winner = race waiter.Task interrupt
                let values = drainState mailbox maxCount
                return if values.Length > 0 then items values else winner
            finally
                // 所有出口都撤回本次 waiter；异常或已有结果不能留下吞唤醒的旧等待者。
                dropWaiter mailbox waiter
        }

    let beginJoin owner maxCount interrupt =
        let mailbox = state owner
        let values = drainState mailbox maxCount
        if values.Length > 0 then
            observeRejection interrupt
            ready (items values)
        elif mailbox.Active = 0 then
            observeRejection interrupt
            ready (empty ())
        else
            let waiter = Signal()
            if mailbox.Values.Count > 0 || mailbox.Active = 0 then waiter.Release()
            else mailbox.Waiters.Enqueue waiter
            pending (completion mailbox waiter maxCount interrupt)

[<AttachMembers>]
type ResultMailbox() =
    member this.start() = Mailboxes.start this
    member this.publish(value: obj) = Mailboxes.publish this value
    member this.drain(maxCount: int) : obj array = Mailboxes.drain this maxCount
    member this.hasActive = Mailboxes.hasActive this
    member this.pendingCount = Mailboxes.pendingCount this
    member this.beginJoin(maxCount: int, interrupt: obj) : obj = Mailboxes.beginJoin this maxCount interrupt
