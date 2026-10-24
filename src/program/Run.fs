namespace Wanxiangli.Program

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Program.Native

type private PausePoint =
    | NoPause
    | Drain of request: obj * command: string
    | Command of request: obj
    | Explicit of request: obj * payload: obj
    | Computation
    | Control of request: obj * target: string * result: obj ref

type internal Run
    (
        options: obj,
        runtime: obj,
        initialWindow: RequestWindow,
        control: string -> obj array -> RequestWindow -> Task<obj>
    ) =
    let name = field options "name"
    let capabilities = strings (get options "capabilities") |> Set.ofArray
    let api = get options "api"
    let pending = Dictionary<obj, Task<obj>>()
    let mutable state = "running"
    let mutable unitHandle: obj = null
    let mutable point = NoPause
    let mutable command: obj = null
    let mutable commandResult: obj = null
    let mutable commandGeneration = 0
    let mutable callGeneration = 0
    let mutable parkGeneration = 0
    let mutable windowGeneration = 0
    let mutable window = initialWindow
    let mutable leaveWindow: unit -> unit = ignore
    let mutable drained = false
    let mutable finalizing = false
    let mutable finalized = TaskCompletionSource<obj>()
    let deferredRequests = Queue<obj>()
    let mutable finalReceipt: obj = null
    let mutable observer = TaskCompletionSource<obj>()
    let mutable cleanup: Task<obj> option = None
    let mutable forced = false
    let mutable cancellationRequested = false
    let mutable sdkFailure: obj = null
    let mutable lifecycleTail = Task.FromResult(())
    let mutable lifecycleError: obj = null
    let source = field options "program"

    let markedSource =
        source.Split('\n') |> Array.map (fun line -> " | " + line) |> String.concat "\n"

    let requestId request = get request "id"

    let reply request response =
        if not (missing unitHandle) then
            (unitHandle?reply (requestId request, response): unit)

    let cancelWindow () =
        windowGeneration <- windowGeneration + 1
        leaveWindow ()
        leaveWindow <- ignore

    let lifecycle kind =
        let callback = get options "lifecycle"

        if isFunction callback then
            let previous = lifecycleTail
            let event = receipt name state (createObj [ "event" ==> kind ])

            lifecycleTail <-
                task {
                    do! previous

                    try
                        let! _ = promise (invoke callback [| event |])
                        ()
                    with error ->
                        if missing lifecycleError then
                            lifecycleError <- exceptionData error
                }

    let observed result : Task<obj> =
        task {
            do! lifecycleTail

            return
                if missing lifecycleError then
                    result
                else
                    merge result (createObj [ "lifecycleError" ==> lifecycleError ])
        }

    let commandView () =
        createObj
            [ "started" ==> not (missing command)
              "running" ==> (not (missing command) && missing commandResult)
              "pid" ==> (if missing command then null else get command "pid")
              "result" ==> commandResult ]

    let snapshot () =
        let reason, payload =
            match point with
            | Drain _ -> "sdk-drain", null
            | Command _ -> "call", null
            | Explicit(_, value) -> "explicit", value
            | Computation -> "yield", null
            | Control(_, target, result) -> "control", createObj [ "target" ==> target; "result" ==> result.Value ]
            | NoPause -> "", null

        receipt
            name
            state
            (createObj
                [ "reason" ==> reason
                  "payload" ==> payload
                  "command" ==> commandView ()
                  "pendingOperations" ==> pending.Count
                  "source" ==> markedSource
                  "remainingWaitMs" ==> max 0.0 (window.Deadline - now runtime) ])

    let currentReceipt () =
        if not (missing finalReceipt) then
            copy finalReceipt
        else
            copy (snapshot ())

    let publishPark reason =
        if not (terminal state) && state <> "parked" && not cancellationRequested then
            state <- "parked"
            parkGeneration <- parkGeneration + 1
            cancelWindow ()
            let delta = if missing command then createObj [] else command?delta ()

            let parked =
                merge (snapshot ()) (createObj [ "reason" ==> reason; "delta" ==> delta ])

            lifecycle "parked"
            let recipient = observer

            task {
                let! result = observed parked
                complete recipient (copy result)
            }
            |> ignore

    let useWindow (next: RequestWindow) =
        cancelWindow ()
        window <- next
        let generation = windowGeneration

        leaveWindow <-
            window.Subscribe(fun () ->
                if
                    generation = windowGeneration
                    && not (terminal state)
                    && not cancellationRequested
                then
                    match point with
                    | NoPause ->
                        point <- Computation

                        if not (missing unitHandle) then
                            (unitHandle?pause (): unit)
                    | _ -> ()

                    publishPark (
                        match point with
                        | Drain _ -> "sdk-drain"
                        | Command _ -> "call"
                        | Explicit _ -> "explicit"
                        | Control _ -> "control"
                        | _ -> "yield"
                    ))

    let closeCommand () : Task<obj> =
        task {
            if missing command then
                return null
            else
                let! result = promise (command?close (): obj)
                forced <- forced || get result "forced" = box true
                return result
        }

    let settle (result: obj) : Task<obj> =
        task {
            let callback = get options "settle"

            if not (isFunction callback) then
                return result
            else
                let! settled = promise (invoke callback [| copy result |])
                return if missing settled then result else settled
        }

    let finish result : Task<obj> =
        let completion = finalized

        task {
            if not finalizing then
                finalizing <- true
                state <- "settling"
                cancelWindow ()

                try
                    do! closeCommand () :> Task
                    let operations = pending.Values |> Seq.toArray

                    if operations.Length > 0 then
                        let! _ = all operations
                        ()

                    if not (missing unitHandle) then
                        let! exit = promise (get unitHandle "exited")
                        forced <- forced || get exit "forced" = box true

                    let result =
                        if cancellationRequested then
                            receipt name "abandoned" (createObj [])
                        elif not (missing sdkFailure) then
                            receipt name "failed" sdkFailure
                        else
                            result

                    let mutable settled = result

                    try
                        let! value = settle result
                        settled <- value
                    with error ->
                        settled <- receipt name "failed" (exceptionData error)

                    state <- field settled "state"

                    if state = "" then
                        state <- field result "state"
                        settled <- merge settled (createObj [ "state" ==> state ])

                    finalReceipt <- merge settled (createObj [ "name" ==> name; "forced" ==> forced ])
                    lifecycle state
                    let! audited = observed finalReceipt
                    finalReceipt <- audited
                    complete observer (copy finalReceipt)
                    complete completion (copy finalReceipt)
                with error ->
                    cancellationRequested <- true
                    finalizing <- false
                    state <- "abandoning"
                    let incomplete = receipt name state (exceptionData error)
                    complete observer incomplete
                    complete completion incomplete
                    finalized <- TaskCompletionSource<obj>()

            return! completion.Task
        }

    let fail code reason =
        finish (receipt name "failed" (failure code reason)) |> ignore

    let releaseCall request value =
        if cancellationRequested || window.CanContinue() then
            point <- NoPause
            state <- "running"
            reply request (if get value "ok" = box false then value else success value)

    let startCommand request commandText =
        if not (missing sdkFailure) then
            point <- NoPause
            state <- "running"
            reply request sdkFailure
        elif
            state <> "parked"
            && not (terminal state)
            && (cancellationRequested || window.CanContinue())
        then
            try
                commandGeneration <- commandGeneration + 1
                commandResult <- (null: obj)

                command <-
                    (runtime?startCommand (
                        createObj
                            [ "root" ==> get options "root"
                              "command" ==> commandText
                              "outputRoot" ==> get options "outputRoot"
                              "outputBoundBytes" ==> get options "outputBoundBytes" ]
                    )
                    : obj)

                point <- Command request
                state <- "waiting"
                lifecycle "command-started"
                let generation = callGeneration

                listen
                    (get command "result")
                    (fun value ->
                        if generation = callGeneration then
                            commandResult <- copy value
                            lifecycle "command-exited"

                            if state = "waiting" then
                                releaseCall request commandResult)
                    (fun error ->
                        if generation = callGeneration then
                            commandResult <- exceptionData error

                            if state = "waiting" then
                                releaseCall request commandResult)
            with error ->
                commandResult <- exceptionData error
                releaseCall request commandResult

    let enterCall (request: obj) (args: obj array) =
        let commandText = if args.Length > 0 then args[0] else null

        if not (Set.contains "Exec" capabilities) then
            reply request (failure "CAPABILITY_DENIED" "call requires Exec")
        elif args.Length <> 1 || not (isText commandText) then
            reply
                request
                (failure
                    "CALL_COMMAND_UNSUPPORTED"
                    "call requires exactly one command string; planB belongs to the tool request")
        else
            callGeneration <- callGeneration + 1
            let generation = callGeneration
            command <- (null: obj)
            commandResult <- (null: obj)
            point <- Drain(request, text commandText)
            state <- "draining"
            drained <- pending.Count = 0
            lifecycle "sdk-drain"

            if drained then
                startCommand request (text commandText)
            else
                let operations = pending.Values |> Seq.toArray

                listen
                    (box (all operations))
                    (fun _ ->
                        if generation = callGeneration then
                            drained <- true

                            if state = "draining" then
                                startCommand request (text commandText))
                    (fun error ->
                        if generation = callGeneration then
                            drained <- true

                            if state = "draining" then
                                reply request (exceptionData error))

    let runSdk request memberName args =
        let callback = getMember api memberName

        if not (isFunction callback) then
            reply request (failure "CAPABILITY_DENIED" ("member is not available: " + memberName))
        else
            let completion = TaskCompletionSource<obj>()
            let id = requestId request
            pending[id] <- completion.Task

            let endOperation response =
                if get response "ok" = box false then
                    sdkFailure <- response

                pending.Remove id |> ignore
                reply request response
                complete completion response

            try
                let result = invoke callback args

                listen
                    (box (promise result))
                    (fun value ->
                        if not (missing value) && not (missing (get value "__programPark")) then
                            pending.Remove id |> ignore
                            complete completion (success value)

                            if cancellationRequested then
                                reply request (failure "CANNOT_PARK_WHILE_ABANDONING" "program cleanup cannot park")
                            else
                                point <- Explicit(request, copy (get value "__programPark"))
                                publishPark "explicit"
                        else
                            endOperation (success value))
                    (fun error -> endOperation (exceptionData error))
            with error ->
                endOperation (exceptionData error)

    let releaseControl request result =
        if cancellationRequested || window.CanContinue() then
            point <- NoPause
            state <- "running"
            reply request result

    let requestControl request memberName (args: obj array) =
        let result = ref null
        let target = if args.Length = 0 then "" else text args[0]
        point <- Control(request, target, result)
        state <- "waiting"

        let completed response =
            result.Value <- copy response

            if state = "waiting" then
                releaseControl request result.Value

        try
            listen (box (control memberName args window)) (fun value -> completed (success value)) (fun error ->
                completed (exceptionData error))
        with error ->
            completed (exceptionData error)

    let receive message =
        match field message "type" with
        | "request" when not cancellationRequested && (state = "parked" || not (window.CanContinue())) ->
            deferredRequests.Enqueue message
        | "request" ->
            let memberName = field message "member"
            let args = array (get message "args")

            match memberName with
            | "call" -> enterCall message args
            | "park" when cancellationRequested ->
                reply message (failure "CANNOT_PARK_WHILE_ABANDONING" "program cleanup cannot park")
            | "park" ->
                let payload = if args.Length > 0 then args[0] else null
                point <- Explicit(message, copy payload)
                publishPark "explicit"
            | "unpark"
            | "abandon"
            | "signal"
            | "send" -> requestControl message memberName args
            | _ -> runSdk message memberName args
        | "completed" ->
            let result =
                if cancellationRequested then
                    receipt name "abandoned" (createObj [])
                else
                    receipt name "completed" (createObj [ "value" ==> get message "value" ])

            finish result |> ignore
        | "failed" ->
            if cancellationRequested then
                finish (receipt name "abandoned" (createObj [])) |> ignore
            else
                fail (field message "code") (field message "reason")
        | _ -> ()

    member _.Name = name
    member _.Capabilities = capabilities
    member _.Generation = parkGeneration
    member _.CommandGeneration = commandGeneration
    member _.State = state

    member _.Inspect() = currentReceipt ()

    member _.Start() =
        let available = memberNames api

        let members =
            Array.append
                available
                (if Set.contains "Exec" capabilities then
                     [| "call"; "park"; "unpark"; "abandon"; "signal"; "send" |]
                 else
                     [| "park"; "unpark"; "abandon" |])
            |> Array.distinct

        let specification =
            createObj
                [ "program" ==> get options "program"
                  "baseClass" ==> get options "baseClass"
                  "syncMembers" ==> get options "syncMembers"
                  "members" ==> members
                  "executionBudgetMs" ==> get options "executionBudgetMs"
                  "outputBoundBytes" ==> get options "outputBoundBytes" ]

        try
            useWindow initialWindow
            unitHandle <- (runtime?startUnit (specification, (fun (message: obj) -> receive message)): obj)

            if state = "parked" then
                (unitHandle?pause (): unit)

            lifecycle "started"

            listen
                (get unitHandle "exited")
                (fun exit ->
                    if not finalizing then
                        if cancellationRequested then
                            finish (receipt name "abandoned" (createObj [ "exit" ==> exit ])) |> ignore
                        else
                            fail "PROGRAM_INTERRUPTED" "the execution process exited without a program result")
                (fun error -> fail "PROGRAM_INTERRUPTED" (field (exceptionData error) "reason"))
        with error ->
            fail "PROGRAM_START_FAILED" (field (exceptionData error) "reason")

        observer.Task

    member _.Resume(nextWindow: RequestWindow, value: obj, observedGeneration: int) : Task<obj> =
        if terminal state || cancellationRequested then
            Task.FromResult(currentReceipt ())
        elif observedGeneration <> parkGeneration || state <> "parked" then
            Task.FromResult(receipt name state (failure "STALE_CONTROL" "the observed pause is no longer current"))
        elif not (nextWindow.CanContinue()) then
            Task.FromResult(currentReceipt ())
        else
            observer <- TaskCompletionSource<obj>()
            state <- "running"
            useWindow nextWindow
            (unitHandle?resume (): unit)
            lifecycle "unparked"

            match point with
            | Drain(request, commandText) ->
                state <- "draining"

                if drained then
                    startCommand request commandText
            | Command request ->
                state <- "waiting"

                if not (missing commandResult) then
                    releaseCall request commandResult
            | Control(request, _, result) ->
                state <- "waiting"

                if not (missing result.Value) then
                    releaseControl request result.Value
            | Explicit(request, _) ->
                point <- NoPause
                reply request (success value)
            | Computation -> point <- NoPause
            | NoPause -> ()

            while deferredRequests.Count > 0 && state <> "parked" && window.CanContinue() do
                receive (deferredRequests.Dequeue())

            observer.Task

    member _.Signal(signal: obj, observedGeneration: int) : Task<obj> =
        if observedGeneration <> commandGeneration then
            Task.FromResult(receipt name state (failure "STALE_CONTROL" "the observed command is no longer current"))
        elif missing command || not (missing commandResult) then
            Task.FromResult(receipt name state (failure "CALL_CHILD_UNKNOWN" "the program has no active command"))
        elif not (isText signal) || String.IsNullOrWhiteSpace(text signal) then
            Task.FromResult(receipt name state (failure "INVALID_ARGUMENT" "signal requires a signal name"))
        else
            promise (command?signal (signal): obj)

    member _.Send(input: obj, observedGeneration: int) : Task<obj> =
        if observedGeneration <> commandGeneration then
            Task.FromResult(receipt name state (failure "STALE_CONTROL" "the observed command is no longer current"))
        elif missing command || not (missing commandResult) then
            Task.FromResult(receipt name state (failure "CALL_CHILD_UNKNOWN" "the program has no active command"))
        elif not (isText input) then
            Task.FromResult(receipt name state (failure "INVALID_ARGUMENT" "send requires text"))
        else
            promise (command?send (input): obj)

    member _.Abandon() : Task<obj> =
        match cleanup with
        | Some pendingCleanup -> pendingCleanup
        | None when terminal state -> Task.FromResult(currentReceipt ())
        | None ->
            cancellationRequested <- true
            state <- "abandoning"
            cancelWindow ()
            deferredRequests.Clear()
            lifecycle "abandoning"

            let cleanupTask =
                task {
                    try
                        let! _ = closeCommand ()

                        if not (missing unitHandle) then
                            let! stopped = promise (unitHandle?stop ("ABANDONED"): obj)
                            forced <- forced || get stopped "forced" = box true

                        let! final = finish (receipt name "abandoned" (createObj []))
                        return final
                    with error ->
                        return receipt name "abandoning" (exceptionData error)
                }

            cleanup <- Some cleanupTask

            listen
                (box cleanupTask)
                (fun result ->
                    if field result "state" = "abandoning" then
                        cleanup <- None)
                (fun _ -> cleanup <- None)

            cleanupTask
