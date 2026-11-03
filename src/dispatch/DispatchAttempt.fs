module Wanxiangli.Dispatch.Attempt

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Dispatch
open Wanxiangli.Dispatch.PromptPhysicalAcceptance

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("$0 == null")>]
let private absent (_value: obj) : bool = jsNative

[<Emit("$0($1)")>]
let private invoke (_callback: obj) (_value: obj) : obj = jsNative

[<Emit("Promise.resolve($0)")>]
let private promise (_value: obj) : Task<obj> = jsNative

type private Disposable =
    abstract dispose: unit -> unit

type private Observer =
    abstract notify: string -> unit
    abstract own: obj -> unit
    abstract budget: obj

type private Request =
    abstract key: string
    abstract mode: string
    abstract observer: obj
    abstract observed: obj
    abstract onFailure: obj

type private Effects =
    abstract subscribe: unit -> obj
    abstract send: obj -> Task<obj>
    abstract submitted: string -> Task<obj>
    abstract acceptPhysical: string -> Task<obj>
    abstract abandon: obj -> Task<obj>
    abstract admit: unit -> obj
    abstract diagnostic: obj -> unit

module private Sending =
    let dispose (handle: obj) = (unbox<Disposable> handle).dispose()
    let release registration = registration |> Option.iter dispose
    let sent key = createObj [ "kind" ==> "Sent"; "key" ==> key ]
    let failed reason = createObj [ "kind" ==> "Failed"; "reason" ==> reason ]
    let notSent reason = createObj [ "kind" ==> "NotSent"; "reason" ==> reason ]
    let reason value = unbox<string> (field value "reason")
    let kind value = unbox<string> (field value "kind")

    let resultOf (value: obj) : Result<unit, string> =
        if unbox<bool> (field value "ok") then Ok()
        else Error(unbox<string> (field value "error"))

    let answer outcome =
        let answer =
            match kind outcome with
            | "AdmittedWithReceipt" -> SendAnswer.AdmittedWithReceipt
            | "AdmittedWithPhysicalMessage" -> SendAnswer.AdmittedWithPhysicalMessage
            | "Retryable" -> SendAnswer.Retryable
            | "Fatal" -> SendAnswer.Fatal
            | "AcceptanceUnknown" -> SendAnswer.AcceptanceUnknown
            | _ -> raise (ArgumentException("wanxiangli/dispatch: malformed send answer"))
        ClaimLaw.answer answer

    let detached outcome =
        match (answer outcome).Detached with
        | DetachedVerdict.OwnedSettled -> createObj [ "kind" ==> "OwnedSettled" ]
        | DetachedVerdict.Refused -> createObj [ "kind" ==> "Refused"; "reason" ==> reason outcome ]
        | DetachedVerdict.OutcomeUnknown -> createObj [ "kind" ==> "OutcomeUnknown"; "reason" ==> reason outcome ]

    let sendFailed reason = createObj [ "kind" ==> "send-failed"; "reason" ==> reason ]
    let diagnostic (effects: Effects) kind reason =
        effects.diagnostic (createObj [ "kind" ==> kind; "reason" ==> reason ])

    let settleDetached (request: Request) (effects: Effects) verdict =
        task {
            match kind verdict with
            | "OwnedSettled" -> ()
            | "Refused" ->
                let! abandoned = effects.abandon (sendFailed (reason verdict))
                match resultOf abandoned with
                | Ok () -> ()
                | Error error -> diagnostic effects "abandon-uncommitted" error
            | "OutcomeUnknown" -> diagnostic effects "outcome-unknown" (reason verdict)
            | _ -> raise (ArgumentException("wanxiangli/dispatch: malformed detached verdict"))

            if kind verdict <> "OwnedSettled" && not (absent request.onFailure) then
                try
                    let! _ = promise (invoke request.onFailure verdict)
                    ()
                with error -> diagnostic effects "observer-failed" error.Message
        }

    let observeDetached request effects (pending: Task<obj>) =
        task {
            let! verdict =
                task {
                    try
                        let! outcome = pending
                        return detached outcome
                    with error -> return createObj [ "kind" ==> "OutcomeUnknown"; "reason" ==> error.Message ]
                }
            do! settleDetached request effects verdict
        } |> ignore

    let observeSend (request: Request) (effects: Effects) late =
        if absent request.observed then effects.send late
        else
            invoke request.observed (createObj [ "kind" ==> "Sending"; "key" ==> request.key ]) |> ignore
            let pending = effects.send late
            task {
                let! outcome = pending
                invoke request.observed (createObj [ "kind" ==> "Answered"; "key" ==> request.key; "outcome" ==> outcome ]) |> ignore
                return outcome
            }

    let register (acceptance: PromptPhysicalAcceptance) (request: Request) =
        if absent request.observer then None
        else
            let owner: Observer = unbox request.observer
            let registration = acceptance.register(request.key, owner.notify)
            try
                owner.own registration
                Some registration
            with error ->
                dispose registration
                raise error

    let confirmation (acceptance: PromptPhysicalAcceptance) (request: Request) registration =
        if request.mode <> "await" || absent request.observer then None
        else
            let owner: Observer = unbox request.observer
            let budget = if absent owner.budget then None else Some(unbox<int> owner.budget)
            let outcome, subscription = acceptance.beginConfirmation(request.key, budget)
            try
                owner.own subscription
                Some(outcome, subscription)
            with error ->
                dispose subscription
                release registration
                raise error

    let confirm key pending =
        task {
            match pending with
            | None -> return Ok()
            | Some (waiter: Task<obj option>) ->
                let! observed = waiter
                match observed with
                | Some value when kind value = "Accepted" -> return Ok()
                | Some value -> return Error(sprintf "Prompt admission rejected: %s" (reason value))
                | None -> return Error(sprintf "Acceptance unknown for PromptKey %s: confirmation timed out" key)
        }

    let afterReceipt (request: Request) (effects: Effects) confirmation receipt =
        task {
            let! submitted = effects.submitted receipt
            match resultOf submitted with
            | Error error -> return Error error
            | Ok () -> return! confirm request.key confirmation
        }

    let afterPhysical (effects: Effects) physical =
        task {
            let! submitted = effects.submitted physical
            match resultOf submitted with
            | Error error -> return Error error
            | Ok () ->
                let! accepted = effects.acceptPhysical physical
                return resultOf accepted
        }

    let awaitSend (request: Request) (effects: Effects) (pending: Task<obj>) confirmation =
        task {
            try
                let! outcome = pending
                let verdict = answer outcome
                let! result =
                    task {
                        match verdict.Ledger with
                        | SendLedger.Submit ->
                            return! afterReceipt request effects confirmation (unbox<string> (field outcome "receipt"))
                        | SendLedger.SubmitThenAccept ->
                            return! afterPhysical effects (unbox<string> (field outcome "physicalUserMessageId"))
                        | SendLedger.Abandon ->
                            let error = reason outcome
                            let! _ = effects.abandon (sendFailed error)
                            return Error error
                        | SendLedger.KeepPending ->
                            return Error(sprintf "Acceptance unknown for PromptKey %s: %s" request.key (reason outcome))
                    }
                return result, verdict.DefinitelyNotSent
            with error -> return Error error.Message, false
        }

    let lateListener (request: Request) effects : obj =
        if request.mode = "detached" then box (fun (verdict: obj) -> settleDetached request effects verdict)
        else null

    let detachedSend (request: Request) (effects: Effects) pending =
        task {
            let! submitted = effects.submitted ("accepted-detached-" + request.key)
            match resultOf submitted with
            | Error error -> return failed error
            | Ok () ->
                observeDetached request effects pending
                return sent request.key
        }

    let awaitAttempt request effects pending confirmation =
        task {
            let! result, definitelyNotSent = awaitSend request effects pending confirmation
            match result with
            | Ok () -> return sent request.key
            | Error error when definitelyNotSent -> return notSent error
            | Error error -> return failed error
        }

[<AttachMembers>]
type DispatchAttempt(acceptance: PromptPhysicalAcceptance) =
    member _.sendInitial(input: obj, operations: obj) : Task<obj> =
        let request: Request = unbox input
        let effects: Effects = unbox operations
        task {
            let listener = effects.subscribe()
            try
                let registration = Sending.register acceptance request
                let confirmation = Sending.confirmation acceptance request registration
                try
                    let pending =
                        try Sending.observeSend request effects (Sending.lateListener request effects)
                        with error ->
                            Sending.release registration
                            raise error
                    if request.mode = "detached" then
                        return! Sending.detachedSend request effects pending
                    else
                        let! result, _ = Sending.awaitSend request effects pending (confirmation |> Option.map fst)
                        match result with
                        | Ok () -> return Sending.sent request.key
                        | Error error ->
                            Sending.release registration
                            return Sending.failed error
                finally
                    confirmation |> Option.iter (snd >> Sending.dispose)
            finally
                Sending.dispose listener
        }

    member _.sendContinuation(input: obj, operations: obj) : Task<obj> =
        let request: Request = unbox input
        let effects: Effects = unbox operations
        task {
            let listener = effects.subscribe()
            try
                let registration = Sending.register acceptance request
                let confirmation = Sending.confirmation acceptance request registration
                try
                    try
                        let admitted = effects.admit()
                        match Sending.kind admitted with
                        | "allowed" ->
                            let pending = Sending.observeSend request effects (Sending.lateListener request effects)
                            let! result =
                                if request.mode = "detached" then Sending.detachedSend request effects pending
                                else Sending.awaitAttempt request effects pending (confirmation |> Option.map fst)
                            if Sending.kind result <> "Sent" then Sending.release registration
                            return result
                        | _ ->
                            let failure =
                                if Sending.kind admitted = "failed" then Sending.failed (Sending.reason admitted)
                                else createObj [ "kind" ==> "AdmissionRejected"; "failure" ==> field admitted "failure" ]
                            Sending.release registration
                            let! abandoned = effects.abandon (createObj [ "kind" ==> "superseded" ])
                            match Sending.resultOf abandoned with
                            | Ok () -> return failure
                            | Error error -> return Sending.failed error
                    with error ->
                        Sending.release registration
                        return raise error
                finally
                    confirmation |> Option.iter (snd >> Sending.dispose)
            finally
                Sending.dispose listener
        }
