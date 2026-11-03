module Wanxiangli.Casebook.BookkeeperTransaction

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Casebook.BookkeeperStaging
open Wanxiangli.Casebook.BookkeeperLedger

type private Request =
    abstract txId: string
    abstract ownerId: string
    abstract question: string
    abstract answer: string

type private Effects =
    abstract ``open``: unit -> Task<obj>
    abstract subscribe: childId: string * complete: (obj -> unit) -> (unit -> unit)
    abstract prepare: childId: string -> obj
    abstract send: childId: string * agent: string * text: string -> Task<obj>
    abstract abort: childId: string -> Task<obj>

type private Prompt =
    abstract agent: string
    abstract text: string

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

let private resultOf (value: obj) : Result<obj, string> =
    if unbox<bool> (field value "ok") then Ok(field value "value")
    else Error(unbox<string> (field value "error"))

let private resultToJs result : obj =
    match result with
    | Ok(question, answer) ->
        createObj [ "ok" ==> true; "value" ==> createObj [ "question" ==> question; "answer" ==> answer ] ]
    | Error reason -> createObj [ "ok" ==> false; "error" ==> reason ]

let private complete (completion: TaskCompletionSource<Result<unit, string>>) value =
    let outcome = resultOf value |> Result.map ignore
    try completion.SetResult outcome with _ -> ()

[<AttachMembers>]
type BookkeeperTransaction(staging: BookkeeperStaging, ledger: BookkeeperLedger) =
    let retire (effects: Effects) childId =
        task {
            try
                let! _ = effects.abort childId
                ()
            with _ -> ()
            ledger.unbind childId
        }

    let fail effects txId childId dispose reason =
        task {
            dispose ()
            staging.abort txId
            do! retire effects childId
            return Error reason
        }

    let awaitCompletion effects txId childId (completion: TaskCompletionSource<Result<unit, string>>) dispose =
        task {
            let! waited = completion.Task
            dispose ()
            let result =
                match waited with
                | Error reason ->
                    staging.abort txId
                    Error reason
                | Ok () when staging.touched txId -> staging.take txId
                | Ok () ->
                    staging.abort txId
                    Error "bookkeeper program did not write the staged case"
            do! retire effects childId
            return result
        }

    let runChild (request: Request) (effects: Effects) childId =
        task {
            ledger.bind(childId, request.txId, request.ownerId)
            let completion = TaskCompletionSource<Result<unit, string>>(TaskCreationOptions.RunContinuationsAsynchronously)
            ledger.registerCompletion(childId, request.txId, box completion)
            let mutable subscription: (unit -> unit) option = None
            subscription <- Some(effects.subscribe(childId, complete completion))
            let dispose () =
                subscription |> Option.iter (fun active -> active ())
                subscription <- None
                ledger.removeCompletion childId
            match resultOf (effects.prepare childId) with
            | Error reason -> return! fail effects request.txId childId dispose reason
            | Ok prepared ->
                let prompt: Prompt = unbox prepared
                ledger.authorize(childId, prompt.agent, prompt.text) |> ignore
                let! sent = effects.send(childId, prompt.agent, prompt.text)
                match resultOf sent with
                | Error reason -> return! fail effects request.txId childId dispose reason
                | Ok _ -> return! awaitCompletion effects request.txId childId completion dispose
        }

    member _.run(request: obj, effects: obj) : Task<obj> =
        task {
            let request: Request = unbox request
            let effects: Effects = unbox effects
            staging.beginTransaction(request.txId, request.question, request.answer)
            let! opened = effects.``open``()
            match resultOf opened with
            | Error reason ->
                staging.abort request.txId
                return resultToJs (Error reason)
            | Ok child ->
                let! result = runChild request effects (unbox<string> child)
                return resultToJs result
        }
