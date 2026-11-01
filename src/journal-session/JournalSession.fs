namespace Wanxiangli.JournalSession

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

type private SessionWriter =
    abstract append: obj -> Task<obj>
    abstract isPoisoned: unit -> bool
    abstract release: unit -> unit
    abstract releaseAsync: unit -> Task<unit>

module private Session =
    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    [<Emit("$0()")>]
    let read (_operation: obj) : obj = jsNative

    [<Emit("$0($1)")>]
    let notify (_operation: obj) (_outcome: obj) : unit = jsNative

    [<Emit("$0($1)")>]
    let register (_operation: obj) (_cancel: unit -> unit) : unit -> unit = jsNative

    let complete (completion: TaskCompletionSource<obj>) (value: obj) =
        try completion.SetResult value
        with _ -> ()

    type Waiter =
        { FromRevision: int64
          Completion: TaskCompletionSource<obj> }

[<Sealed; AttachMembers>]
type JournalSession(options: obj) =
    let writer: SessionWriter = Session.field options "writer" |> unbox
    let readCurrent = Session.field options "readCurrent"
    let refresh = Session.field options "refreshCurrent"
    let onSettlement = Session.field options "onSettlement"
    let mutable currentRevision = Session.field options "initialRevision" |> unbox<int64>
    let mutable lastChange: obj option = None
    let waiters = ResizeArray<Session.Waiter>()
    let mutable pendingRecovery: (unit -> Task<unit>) option = None
    let mutable startedRecovery: Task<unit> option = None
    let mutable previousRecovery: Task<unit> option = None

    member _.snapshot() : obj = Session.read readCurrent

    member _.revision() : int64 = currentRevision

    member _.snapshotWithRevision() : obj =
        let current = Session.read readCurrent
        createObj [ "current" ==> current; "revision" ==> currentRevision ]

    member _.refreshCurrent() : obj = Session.read refresh

    member _.isPoisoned() : bool = writer.isPoisoned()

    member _.append(request: obj) : Task<obj> =
        task {
            let! outcome = writer.append request

            if unbox<string> (Session.field outcome "kind") <> "Committed" then
                if not (isNullOrUndefined onSettlement) then Session.notify onSettlement outcome
                return outcome
            else
                let current = Session.read readCurrent
                let envelope = Session.field outcome "envelope"
                currentRevision <- Session.field outcome "sequence" |> unbox<int64>
                let change = createObj [ "revision" ==> currentRevision; "envelope" ==> envelope ]
                lastChange <- Some change
                let ready, kept = waiters |> Seq.toList |> List.partition (fun waiter -> currentRevision > waiter.FromRevision)
                waiters.Clear()
                for waiter in kept do waiters.Add waiter
                for waiter in ready do Session.complete waiter.Completion change
                return
                    createObj
                        [ "kind" ==> "Committed"
                          "eventId" ==> Session.field outcome "eventId"
                          "sequence" ==> currentRevision
                          "envelope" ==> envelope
                          "current" ==> current ]
        }

    member _.awaitChange(fromRevision: int64, registerCancel: obj) : Task<obj> =
        match currentRevision > fromRevision, lastChange with
        | true, Some change -> Task.FromResult change
        | _ ->
            let waiter: Session.Waiter =
                { FromRevision = fromRevision
                  Completion = TaskCompletionSource<obj>(TaskCreationOptions.RunContinuationsAsynchronously) }
            waiters.Add waiter
            task {
                let unregister =
                    if isNullOrUndefined registerCancel then None
                    else
                        Session.register registerCancel (fun () ->
                            waiters.Remove waiter |> ignore
                            Session.complete waiter.Completion (null: obj))
                        |> Some
                try
                    return! waiter.Completion.Task
                finally
                    match unregister with
                    | Some dispose -> dispose ()
                    | None -> ()
            }

    member _.enqueueRecovery(start: unit -> Task<unit>) : unit =
        previousRecovery <- startedRecovery
        startedRecovery <- None
        pendingRecovery <- Some start

    member _.runOrAwaitRecovery() : Task<unit> =
        match startedRecovery, pendingRecovery with
        | Some started, _ -> started
        | None, Some start ->
            let started =
                task {
                    match previousRecovery with
                    | Some previous -> do! previous
                    | None -> ()
                    do! start ()
                }
            startedRecovery <- Some started
            started
        | None, None -> Task.FromResult()

    member _.release() : unit = writer.release()

    member _.releaseAsync() : Task<unit> = writer.releaseAsync()
