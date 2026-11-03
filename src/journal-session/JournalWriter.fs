namespace Wanxiangli.JournalSession

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private WriterValue =
    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative
    let text value name = unbox<string> (field value name)
    let succeeded value = unbox<bool> (field value "ok")
    let selfCut eventId receipt =
        unbox<obj array> (field receipt "cuts")
        |> Array.tryFind (fun cut -> text cut "failedEventId" = eventId)
    let unavailable kind = createObj [ "kind" ==> kind ]
    let poisoned eventId error = createObj [ "kind" ==> "WriterPoisoned"; "failedEventId" ==> eventId; "error" ==> error ]
    let notAttempted eventId unavailable = createObj [ "kind" ==> "NotAttempted"; "eventId" ==> eventId; "unavailable" ==> unavailable ]
    let refused eventId reason = notAttempted eventId (createObj [ "kind" ==> "WriterRefused"; "reason" ==> reason ])
    let rejected eventId reason = createObj [ "kind" ==> "Rejected"; "eventId" ==> eventId; "reason" ==> reason ]
    let failure kind eventId error = createObj [ "kind" ==> kind; "eventId" ==> eventId; "error" ==> error ]
    let committed eventId sequence envelope = createObj [ "kind" ==> "Committed"; "eventId" ==> eventId; "sequence" ==> sequence; "envelope" ==> envelope ]
    let cutError cut = createObj [ "kind" ==> "SemanticCut"; "cut" ==> cut; "original" ==> (null: obj) ]
    let businessResult eventId sequence envelope receipt =
        match selfCut eventId receipt with
        | Some cut -> rejected eventId (text cut "reason")
        | None -> committed eventId sequence envelope
    let businessFailure eventId error =
        match text error "kind" with
        | "CommitUnknown" -> failure "CommitUnknown" eventId error
        | "NoNewWriteReleaseFailed" -> failure "NoNewWriteReleaseFailed" eventId error
        | "SemanticCut" -> rejected eventId (text (field error "cut") "reason")
        | "AppendFailed" -> refused eventId (text error "reason")
        | "StorageInvalid" | "AppendNotAttempted" -> notAttempted eventId (poisoned eventId error)
        | kind -> invalidOp ("Unknown journal append failure kind: " + kind)

type private WriterOptions =
    abstract newEventId: unit -> string
    abstract now: unit -> obj
    abstract makeEnvelope: input: obj -> obj
    abstract commitEnvelope: envelope: obj -> Task<obj>
    abstract onSettlement: notice: obj -> unit

[<Sealed; AttachMembers>]
type JournalWriter(options: obj) =
    let operations = unbox<WriterOptions> options
    let initialization = WriterValue.field options "initialization"
    let initialId = WriterValue.text initialization "eventId"
    let initialEnvelope = WriterValue.field initialization "envelope"
    let mutable initialized = false
    let mutable sequence = 2L
    let mutable firstFailure: obj option = None
    let mutable closed = false
    let mutable serial = Task.FromResult()
    let mutable closeTask: Task<unit> option = None

    let notify notice =
        if not (isNullOrUndefined (WriterValue.field options "onSettlement")) then operations.onSettlement notice
    let poison eventId error =
        if firstFailure.IsNone && not closed then firstFailure <- Some(WriterValue.poisoned eventId error)
    let commitInitialization () = task {
        let! result = operations.commitEnvelope initialEnvelope
        if WriterValue.succeeded result then
            let receipt = WriterValue.field result "value"
            match WriterValue.selfCut initialId receipt with
            | Some cut ->
                notify (createObj [ "kind" ==> "initialization-cut"; "cut" ==> cut ])
                return Error(WriterValue.cutError cut)
            | None ->
                initialized <- true
                return Ok()
        else
            let error = WriterValue.field result "error"
            poison initialId error
            notify (createObj [ "kind" ==> "initialization-error"; "error" ==> error ])
            return Error error
    }
    let ensureInitialization () = if initialized then Task.FromResult(Ok()) else commitInitialization ()
    let commitBusiness eventId envelope = task {
        let! result = operations.commitEnvelope envelope
        if WriterValue.succeeded result then
            let used = sequence
            sequence <- sequence + 1L
            return WriterValue.businessResult eventId used envelope (WriterValue.field result "value")
        else
            let error = WriterValue.field result "error"
            if WriterValue.text error "kind" <> "AppendFailed" then poison eventId error
            return WriterValue.businessFailure eventId error
    }
    let appendHealthy eventId request = task {
        let! ready = ensureInitialization ()
        match ready with
        | Error error -> return WriterValue.notAttempted eventId (WriterValue.poisoned initialId error)
        | Ok() ->
            let observedAt = operations.now()
            let envelope = operations.makeEnvelope (createObj [ "eventId" ==> eventId; "sequence" ==> sequence; "observedAt" ==> observedAt; "request" ==> request ])
            return! commitBusiness eventId envelope
    }
    let runAccepted (previous: Task<unit>) eventId request = task {
        do! previous
        match firstFailure with
        | Some failure -> return WriterValue.notAttempted eventId failure
        | None -> return! appendHealthy eventId request
    }
    let beginRelease () =
        match closeTask with
        | Some pending -> pending
        | None when closed -> Task.FromResult()
        | None ->
            let accepted = serial
            let pending = task {
                try do! accepted
                finally closed <- true
            }
            closeTask <- Some pending
            pending

    member _.append(request: obj) : Task<obj> =
        let eventId = operations.newEventId()
        if closed then Task.FromResult(WriterValue.notAttempted eventId (WriterValue.unavailable "WriterDisposed"))
        elif closeTask.IsSome then Task.FromResult(WriterValue.notAttempted eventId (WriterValue.unavailable "WriterClosing"))
        else
            match firstFailure with
            | Some failure -> Task.FromResult(WriterValue.notAttempted eventId failure)
            | None ->
                let running = runAccepted serial eventId request
                serial <- task { let! _ = running in return () }
                running
    member _.localSeq() = sequence
    member _.lastCommittedLocalSeq() = if initialized then sequence - 1L else 0L
    member _.isPoisoned() = firstFailure.IsSome
    member _.release() = beginRelease () |> ignore
    member _.releaseAsync() = beginRelease ()
