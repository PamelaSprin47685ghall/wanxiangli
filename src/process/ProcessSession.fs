module Wanxiangli.Process.ProcessSession

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Process

[<AllowNullLiteral>]
type SessionMessages =
    abstract started: unit -> JS.Promise<obj>
    abstract inspect: unit -> obj
    abstract read: channel: string * after: float -> obj
    abstract write: bytes: byte array -> JS.Promise<obj>
    abstract endInput: unit -> unit
    abstract signal: name: string -> obj
    abstract wait: milliseconds: float -> JS.Promise<obj>

let ProcessSession (input: obj): SessionMessages =
    let options = StartOptions.read input
    let stdout = OutputTail(options.TailBytes)
    let stderr = OutputTail(options.TailBytes)
    let mutable child: obj = null
    let mutable phase = "Starting"
    let mutable pid: obj = null
    let mutable exit: obj = null
    let mutable failure: obj = null
    let mutable stdinPhase = "Open"
    let mutable started = false
    let mutable writing = false
    let mutable busy = false
    let mutable writeFailed: (obj -> unit) option = None
    let mutable nextWait = 0.
    let waits = Dictionary<float, (unit -> unit)>()
    let mutable reportStart: obj -> unit = ignore
    let startup = Native.promise (fun resolve -> reportStart <- resolve)

    let guard action =
        Native.require (not busy) "ProcessSession does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let rememberFailure operation error =
        let detail = Native.failure operation error
        if isNull failure then failure <- Native.clone detail
        detail

    let snapshot () =
        Native.objectOf [ "phase", box phase; "pid", pid; "exit", (if isNull exit then null else Native.clone exit)
                          "failure", (if isNull failure then null else Native.clone failure); "stdin", box stdinPhase
                          "stdout", Native.objectOf [ "observed", box stdout.Observed; "retained", box stdout.Retained ]
                          "stderr", Native.objectOf [ "observed", box stderr.Observed; "retained", box stderr.Retained ] ]

    let waitResult kind = Native.objectOf [ "kind", box kind; "state", snapshot () ]

    let close () =
        phase <- "Closed"
        if stdinPhase <> "Failed" then stdinPhase <- "Closed"
        match writeFailed with
        | Some reject -> reject (Native.objectOf [ "code", box "ERR_STREAM_DESTROYED"; "message", box "Process closed during input write" ])
        | None -> ()
        let pending = waits.Values |> Seq.toArray
        for finish in pending do finish ()

    let failedToStart error =
        let detail = rememberFailure "spawn" error
        reportStart (Native.objectOf [ "kind", box "Failed"; "error", detail ])

    let onError error =
        if not started then failedToStart error
        else rememberFailure "process" error |> ignore

    let onExit code signal =
        exit <- Native.objectOf [ "code", code; "signal", signal ]
        phase <- "Draining"

    let streamError operation error =
        rememberFailure operation error |> ignore
        if operation = "stdin" then
            stdinPhase <- "Failed"
            match writeFailed with Some reject -> reject error | None -> ()

    do
        try
            child <- Native.spawn options.Executable options.Arguments
                (Native.objectOf [ "cwd", box options.Directory; "env", options.Environment
                                   "shell", box false; "detached", box true
                                   "stdio", box [| "pipe"; "pipe"; "pipe" |] ])
            Native.on1 child "spawn" (fun _ ->
                started <- true
                phase <- "Running"
                pid <- Native.get child "pid"
                reportStart (Native.objectOf [ "kind", box "Started"; "pid", pid ]))
            Native.on1 child "error" onError
            Native.on2 child "exit" onExit
            Native.on2 child "close" (fun code signal ->
                if started && isNull exit then exit <- Native.objectOf [ "code", code; "signal", signal ]
                close ())
            Native.on1 (Native.get child "stdout") "data" (fun bytes -> stdout.Append(unbox bytes))
            Native.on1 (Native.get child "stderr") "data" (fun bytes -> stderr.Append(unbox bytes))
            Native.on1 (Native.get child "stdout") "error" (streamError "stdout")
            Native.on1 (Native.get child "stderr") "error" (streamError "stderr")
            Native.on1 (Native.get child "stdin") "error" (streamError "stdin")
            Native.on1 (Native.get child "stdin") "finish" (fun _ -> if stdinPhase <> "Failed" then stdinPhase <- "Closed")
            Native.on1 (Native.get child "stdin") "close" (fun _ -> if stdinPhase <> "Failed" then stdinPhase <- "Closed")
        with error ->
            failedToStart (box error)
            close ()

    let read (channel: string, after: float) =
        guard (fun () ->
            let output =
                match channel with
                | "stdout" -> stdout
                | "stderr" -> stderr
                | _ -> invalidOp "Channel must be stdout or stderr"
            output.Read(after, (phase = "Closed")))

    let write (input: byte array) =
        guard (fun () ->
            Native.require (Native.isBytes (box input)) "Input must be a non-shared Uint8Array"
            Native.require (input.Length <= options.MaxWriteBytes) "Input exceeds maxWriteBytes"
            Native.require (phase = "Running" && stdinPhase = "Open") "Input is not open on a running process"
            Native.require (not writing) "An input write is already pending"
            let bytes = Array.copy input
            writing <- true
            Native.promise (fun resolve ->
                let mutable finished = false
                let complete error =
                    if not finished then
                        finished <- true
                        writing <- false
                        writeFailed <- None
                        if isNullOrUndefined error then
                            resolve (Native.objectOf [ "kind", box "Written"; "bytes", box bytes.Length ])
                        else
                            stdinPhase <- "Failed"
                            let detail = rememberFailure "stdin" error
                            resolve (Native.objectOf [ "kind", box "Unknown"; "error", detail ])
                writeFailed <- Some complete
                try Native.write (Native.get child "stdin") bytes complete
                with error -> complete (box error)))

    let endInput () =
        guard (fun () ->
            if stdinPhase = "Open" && not (isNull child) then
                stdinPhase <- "Ending"
                try Native.endStream (Native.get child "stdin")
                with error -> streamError "stdin" (box error))

    let signal (name: string) =
        guard (fun () ->
            Native.require (List.contains name [ "SIGTERM"; "SIGKILL"; "SIGINT"; "SIGHUP" ]) "Unsupported signal"
            if phase <> "Running" || isNull pid then
                Native.objectOf [ "kind", box "NotRunning"; "signal", box name ]
            else
                try
                    Native.killGroup Native.runtime (unbox pid) name
                    Native.objectOf [ "kind", box "Requested"; "signal", box name ]
                with error ->
                    Native.objectOf [ "kind", box "Failed"; "signal", box name; "error", Native.failure "signal" (box error) ])

    let wait (milliseconds: float) =
        guard (fun () ->
            Native.integer 2147483647. (box milliseconds) |> ignore
            Native.require (milliseconds > 0.) "Wait duration must be positive"
            if phase = "Closed" then Native.resolved (waitResult "Closed")
            else
                Native.promise (fun resolve ->
                    let id = nextWait
                    nextWait <- nextWait + 1.
                    let mutable finished = false
                    let mutable timer: obj = null
                    let finish kind =
                        if not finished then
                            finished <- true
                            Native.clearTimer timer
                            waits.Remove id |> ignore
                            resolve (waitResult kind)
                    waits.Add(id, fun () -> finish "Closed")
                    timer <- Native.timer (fun () -> finish "TimedOut") (int milliseconds)))

    { new SessionMessages with
        member _.started() = Native.mapPromise startup Native.clone
        member _.inspect() = guard snapshot
        member _.read(channel, after) = read (channel, after)
        member _.write(bytes) = write bytes
        member _.endInput() = endInput ()
        member _.signal(name) = signal name
        member _.wait(milliseconds) = wait milliseconds }
