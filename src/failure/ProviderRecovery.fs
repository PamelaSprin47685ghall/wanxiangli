module Wanxiangli.Failure.ProviderRecovery

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<Emit("$0[$1]")>]
let private field (_value: obj) (_key: string) : obj = jsNative
let private text value key = unbox<string> (field value key)
let private flag value key = unbox<bool> (field value key)
let private verdict (kind: string) = createObj [ "kind" ==> kind ]
let private terminal (reason: string) = createObj [ "kind" ==> "Terminal"; "reason" ==> reason ]

let private stoppedVerdict alreadyAdmitted stop =
    match stop with
    | "Stopped" -> if alreadyAdmitted then Some(verdict "Superseded") else None
    | "Denied" -> Some(verdict "WaitDenied")
    | _ -> Some(verdict "ReceiptUnknown")

[<AttachMembers>]
type ProviderRecovery() =
    member _.verdictUnlessContinuing(alreadyAdmitted: bool, stop: string) : obj =
        stoppedVerdict alreadyAdmitted stop |> Option.toObj

    member _.attempt(decision: obj, effects: obj, reason: string) : Task<obj> =
        task {
            match text decision "resolution" with
            | "RetryFreshAttempt" ->
                let authorization: obj = decision?authorization
                let! admission: obj = effects?admit authorization
                if not (flag admission "ok") then
                    return terminal (text admission "error")
                else
                    match text admission "value" with
                    | "RetryAuthorized" -> return! effects?redispatch authorization
                    | "EpisodeSuperseded" -> return verdict "Superseded"
                    | "NoActiveRun" -> return terminal "Confirmed provider failure has no active provider run"
                    | _ -> return terminal reason
            | "PreserveCurrentFact" -> return verdict "Superseded"
            | _ -> return terminal reason
        }

    member _.continueSameProvider(expectedRoot: string, authorization: obj, effects: obj, reason: string) : Task<obj> =
        task {
            let authority: obj = effects?currentAuthority ()
            if isNull authority then
                return terminal "No active authority profile"
            elif text authority "root" <> expectedRoot then
                return verdict "Superseded"
            else
                let! sent: obj = effects?sendRetry (field authority "value", authorization)
                match text sent "kind" with
                | "Sent"
                | "AlreadyAdmitted" ->
                    do (effects?observeAcceptance authorization: unit)
                    return verdict "Dispatched"
                | "Retired" -> return verdict "Superseded"
                | _ -> return terminal reason
        }

    member this.redispatch(expectedRoot: string, authorization: obj, effects: obj, reason: string) : Task<obj> =
        task {
            let admitted: bool = effects?alreadyAdmitted authorization
            if admitted then
                do (effects?observeAcceptance authorization: unit)
            let! stop: string = effects?waitForStop ()
            match stoppedVerdict admitted stop with
            | Some answer -> return answer
            | None -> return! this.continueSameProvider(expectedRoot, authorization, effects, reason)
        }

    member _.continueAfterStop(expectedRoot: string, effects: obj) : Task<obj> =
        task {
            let! stop: string = effects?waitForStop ()
            // Read at the same boundary even if the stop receipt is not Stopped.
            let authority: obj = effects?currentAuthority ()
            match stop with
            | "Stopped" when isNull authority ->
                if (effects?isRunClosed (): bool) then return verdict "RunClosed"
                else return createObj [ "kind" ==> "NotSent"; "reason" ==> "No active authority profile" ]
            | "Stopped" when text authority "root" <> expectedRoot -> return verdict "Continued"
            | "Stopped" ->
                let! sent: obj = effects?sendLong (field authority "value")
                match text sent "kind" with
                | "Failed" -> return createObj [ "kind" ==> "NotSent"; "reason" ==> text sent "error" ]
                | _ -> return verdict "Continued"
            | "Denied" -> return verdict "WaitDenied"
            | _ -> return verdict "ReceiptUnknown"
        }

    member this.recoverOrdinary(input: obj, effects: obj) : Task<unit> =
        task {
            let reason: string = input?reason
            let notify (message: string) : unit = effects?terminal message
            if (effects?isRunClosed (): bool) then
                ()
            elif flag input "hardStop" then
                notify reason
            elif not (flag input "hasCapacity") then
                notify "All candidate providers exhausted (zero capacity)"
            elif not (flag input "hasRecovery") then
                let! sent: bool = effects?sendMissing ()
                if not sent then notify reason
            else
                let! answer: obj = effects?retry ()
                match text answer "kind" with
                | "Dispatched"
                | "Superseded" -> ()
                | "ReceiptUnknown" -> notify "stop receipt did not arrive"
                | "WaitDenied" -> notify "stop wait was denied"
                | _ ->
                    let failureReason: string = answer?reason
                    if not (flag input "continueLongWork") then
                        notify failureReason
                    elif (effects?hardStop failureReason: bool) then
                        notify failureReason
                    else
                        let! continued = this.continueAfterStop(text input "expectedRoot", effects)
                        match text continued "kind" with
                        | "Continued"
                        | "RunClosed" -> ()
                        | "ReceiptUnknown" -> notify (failureReason + "; stop receipt did not arrive")
                        | "WaitDenied" -> notify (failureReason + "; stop wait was denied")
                        | _ -> notify (failureReason + "; long-work continuation not sent: " + text continued "reason")
        }

    member _.recoverDelegate(input: obj, effects: obj) : Task<obj> =
        task {
            let reason: string = input?reason
            if flag input "hardStop" then
                return terminal reason
            elif not (flag input "hasCapacity") then
                return terminal "All candidate providers exhausted (zero capacity)"
            elif not (flag input "hasRecovery") then
                let! sent: bool = effects?sendMissing ()
                return if sent then verdict "Dispatched" else terminal reason
            else
                return! effects?retry ()
        }
