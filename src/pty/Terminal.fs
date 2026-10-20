module Wanxiangli.Pty.Terminal

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Pty

[<AllowNullLiteral>]
type TerminalMessages =
    abstract write: text: obj -> obj
    abstract read: waitMs: obj -> JS.Promise<obj>
    abstract signal: name: obj -> obj
    abstract resize: cols: obj * rows: obj -> obj
    abstract wait: unit -> JS.Promise<obj>
    abstract close: graceMs: obj -> JS.Promise<obj>
    abstract inspect: unit -> obj

/// 单次等待的上限：读等待与关闭宽限都是有界切片，不是无限挂起。
let private maximumWaitMs = 60000.

/// KILL 之后确认退出的最短等待；宽限为 0 时也给内核回收留出时间。
let private killConfirmMs = 1000.

let private signals =
    dict [ "TERM", "SIGTERM"; "KILL", "SIGKILL"; "INT", "SIGINT"; "HUP", "SIGHUP"
           "QUIT", "SIGQUIT"; "USR1", "SIGUSR1"; "USR2", "SIGUSR2" ]

let private kind name = Native.objectOf [ "kind", box name ]

let private attachTerminal (term: obj) (pid: float): TerminalMessages =
    let buffer = System.Text.StringBuilder()
    let mutable exit: obj = null
    let mutable parked: (obj -> unit) option = None
    let mutable timer: obj option = None
    let waiters = ResizeArray<obj -> unit>()

    let drain () =
        let text = buffer.ToString()
        buffer.Clear() |> ignore
        Native.objectOf [ "kind", box "Read"; "output", box text; "closed", box (not (isNull exit)) ]

    let answerParked () =
        match parked with
        | Some resolve ->
            parked <- None
            timer |> Option.iter Native.cancel
            timer <- None
            resolve (drain ())
        | None -> ()

    let onData (data: obj) =
        buffer.Append(string data) |> ignore
        answerParked ()

    let onExit (event: obj) =
        if isNull exit then
            let code = if isNullOrUndefined event then null else Native.get event "exitCode"
            let signal = if isNullOrUndefined event then null else Native.get event "signal"
            exit <- Native.objectOf [ "exitCode", (if isNullOrUndefined code then null else code)
                                      "signal", (if isNullOrUndefined signal then null else box (string signal)) ]
            answerParked ()
            for resolve in waiters do resolve exit
            waiters.Clear()

    Native.subscribe term "onData" onData
    Native.subscribe term "onExit" onExit

    let exitCopy () = JS.JSON.parse (JS.JSON.stringify exit)

    let sendGroup (name: string) =
        try
            Native.kill (-pid) name
            None
        with groupError ->
            try
                Native.kill pid name
                None
            with _ -> Some groupError

    let write (text: obj) =
        Native.require (Native.isWellFormed text) "Input must be well-formed text"
        if not (isNull exit) then kind "Closed"
        else
            try
                Native.call1 term "write" text
                kind "Written"
            with error -> Native.objectOf [ "kind", box "Failed"; "error", Native.failure "write" error ]

    let read (waitMs: obj) =
        let wait = Native.integer 0. maximumWaitMs waitMs
        if parked.IsSome then Native.resolved (kind "Busy")
        elif buffer.Length > 0 || not (isNull exit) || wait = 0. then Native.resolved (drain ())
        else
            Native.promise (fun resolve ->
                parked <- Some resolve
                timer <- Some(Native.after (fun () -> timer <- None; answerParked ()) wait))

    let signal (name: obj) =
        Native.require (jsTypeof name = "string" && signals.ContainsKey(unbox<string> name)) "Unknown signal name"
        if not (isNull exit) then kind "Closed"
        else
            match sendGroup signals[unbox<string> name] with
            | None -> kind "Sent"
            | Some error -> Native.objectOf [ "kind", box "Failed"; "error", Native.failure "signal" error ]

    let resize (cols: obj, rows: obj) =
        let width = Native.integer 1. 1000. cols
        let height = Native.integer 1. 1000. rows
        if not (isNull exit) then kind "Closed"
        else
            try
                Native.call2 term "resize" (box width) (box height)
                kind "Resized"
            with error -> Native.objectOf [ "kind", box "Failed"; "error", Native.failure "resize" error ]

    let waitExit () =
        if not (isNull exit) then Native.resolved (exitCopy ())
        else Native.andThen (Native.promise (fun resolve -> waiters.Add resolve)) (fun _ -> exitCopy ())

    let exitWithin (ms: float) : JS.Promise<obj> =
        if not (isNull exit) then Native.resolved (box true)
        else
            Native.promise (fun resolve ->
                let mutable settled = false
                let finish value = if not settled then settled <- true; resolve (box value)
                let clock = Native.after (fun () -> finish false) ms
                waiters.Add(fun _ -> Native.cancel clock; finish true))

    let sweep () = try Native.kill (-pid) "SIGKILL" with _ -> ()

    let close (graceMs: obj) =
        let grace = Native.integer 0. maximumWaitMs graceMs
        if not (isNull exit) then
            sweep ()
            Native.resolved (Native.objectOf [ "kind", box "AlreadyExited"; "exit", exitCopy () ])
        else
            sendGroup "SIGTERM" |> ignore
            Native.andThen (exitWithin grace) (fun first ->
                if unbox<bool> first then
                    sweep ()
                    box (Native.objectOf [ "kind", box "Exited"; "escalated", box false; "exit", exitCopy () ])
                else
                    sendGroup "SIGKILL" |> ignore
                    box (Native.andThen (exitWithin (max grace killConfirmMs)) (fun second ->
                        if unbox<bool> second then
                            sweep ()
                            Native.objectOf [ "kind", box "Exited"; "escalated", box true; "exit", exitCopy () ]
                        else Native.objectOf [ "kind", box "Unconfirmed"; "pid", box pid ])))

    let inspect () =
        Native.objectOf [ "phase", box (if isNull exit then "Open" else "Exited")
                          "pid", box pid; "buffered", box buffer.Length
                          "exit", (if isNull exit then null else exitCopy ()) ]

    { new TerminalMessages with
        member _.write text = write text
        member _.read waitMs = read waitMs
        member _.signal name = signal name
        member _.resize(cols, rows) = resize (cols, rows)
        member _.wait() = waitExit ()
        member _.close graceMs = close graceMs
        member _.inspect() = inspect () }

let private ``open`` (input: obj): obj =
    Native.fields [ "driver"; "command"; "cwd"; "cols"; "rows" ] input
    let driver = Native.value input "driver"
    Native.require (Native.isFunction driver) "driver must be a spawn function"
    let command = Native.value input "command"
    Native.require (Native.isWellFormed command && (unbox<string> command).Length > 0 && not ((unbox<string> command).Contains "\000")) "command must be non-empty text without NUL"
    let cwd = Native.value input "cwd"
    Native.require (Native.isWellFormed cwd && Native.isAbsolute (unbox cwd)) "cwd must be an absolute path"
    let directory: string = unbox cwd
    let cols = Native.value input "cols" |> Native.integer 1. 1000.
    let rows = Native.value input "rows" |> Native.integer 1. 1000.
    let directoryProblem =
        try
            if Native.isDirectory (Native.stat directory) then None
            else Some(Native.objectOf [ "operation", box "cwd"; "code", box "ENOTDIR"; "message", box ("cwd is not a directory: " + directory) ])
        with error -> Some(Native.failure "cwd" error)
    match directoryProblem with
    | Some error -> Native.objectOf [ "kind", box "Failed"; "error", error ]
    | None ->
    let options = Native.objectOf [ "name", box "xterm-256color"; "cols", box cols; "rows", box rows; "cwd", cwd ]
    try
        let term = Native.invoke3 driver (box "sh") (box [| "-lc"; unbox<string> command |]) options
        let pid = if isNullOrUndefined term then null else Native.get term "pid"
        if not (Native.integerIn pid 1. 4294967295.)
           || not (Native.isFunction (Native.get term "onData"))
           || not (Native.isFunction (Native.get term "onExit")) then
            Native.objectOf [ "kind", box "Failed"
                              "error", Native.objectOf [ "operation", box "spawn"; "code", null
                                                         "message", box "driver did not return a live terminal" ] ]
        else Native.objectOf [ "kind", box "Opened"; "terminal", box (attachTerminal term (unbox pid)) ]
    with error -> Native.objectOf [ "kind", box "Failed"; "error", Native.failure "spawn" error ]

let Terminal (): obj = invalidOp "Use Terminal.open(options)"

let private constructor: obj = box (System.Func<obj>(Terminal))

do Native.attach constructor "open" (box (System.Func<obj, obj>(``open``)))
