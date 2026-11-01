module Wanxiangli.Runtime.ProcessRun

open System
open System.Text
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Process.ProcessSession
open Wanxiangli.Spool.OutputSpool
open Wanxiangli.Time

[<Emit("$0")>]
let private asTask (_promise: JS.Promise<'T>) : Task<'T> = jsNative

[<Import("join", "node:path")>]
let private pathJoin (_left: string) (_right: string) : string = jsNative

[<Import("statSync", "node:fs")>]
let private statSync (_path: string) : obj = jsNative

[<Import("accessSync", "node:fs")>]
let private accessSync (_path: string) (_mode: int) : unit = jsNative

[<Emit("$0.isFile()")>]
let private statIsFile (_stat: obj) : bool = jsNative

[<Import("tmpdir", "node:os")>]
let private tmpdir () : string = jsNative

[<Emit("process.cwd()")>]
let private currentDirectory () : string = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.keys($0)")>]
let private keys (_value: obj) : string array = jsNative

[<Emit("process.env")>]
let private environment: obj = jsNative

[<Emit("typeof $0 === 'string' && $0.length > 0 && !$0.includes('=') && !$0.includes(String.fromCharCode(0)) && typeof $1 === 'string' && !$1.includes(String.fromCharCode(0))")>]
let private validEnvironmentEntry (_key: string) (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 instanceof Error ? $0 : new Error(String($0 && $0.message || $0))")>]
let private asError (_value: obj) : exn = jsNative

[<Emit("$0 && $0.message ? String($0.message) : $1")>]
let private messageOr (_error: obj) (_fallback: string) : string = jsNative

[<Emit("new Error($0)")>]
let private inputError (_message: obj) : exn = jsNative

[<Emit("$0.catch(() => {})")>]
let private observeFailure (_pending: Task<'T>) : unit = jsNative

let private complete (completion: TaskCompletionSource<'T>) value =
    try completion.SetResult value with _ -> ()

let private clock = NodeTiming.nodeClockPort ()

let private valueOr fallback value = if isNullOrUndefined value then fallback else value
let private success value = createObj [ "ok" ==> true; "value" ==> value ]
let private failure kind reason = createObj [ "ok" ==> false; "error" ==> createObj [ "kind" ==> kind; "reason" ==> reason ] ]
let private cancelled () = failure "ProcessCancelled" "Cancelled by token"

let private context request = field request "context" |> valueOr (createObj [])

let private buildEnvironment command =
    let snapshot = createObj []
    let copy source =
        if not (isNullOrUndefined source) then
            for key in keys source do
                let value = field source key
                if validEnvironmentEntry key value then snapshot?(key) <- value
    copy environment
    copy (field command "env")
    snapshot

let private workingDirectory command ctx =
    let raw = field command "cwd" |> valueOr (field ctx "cwd")
    let baseDirectory = currentDirectory ()
    let path = if isString raw && unbox<string> raw <> "" then unbox raw else baseDirectory
    if path.StartsWith "/" then path else pathJoin baseDirectory path

let private executablePath (fileName: string) cwd env =
    let executableFile candidate =
        try
            let stat = statSync candidate
            if isNullOrUndefined stat || not (statIsFile stat) then false
            else accessSync candidate 1; true
        with _ -> false
    if not (isString (box fileName)) || fileName = "" || fileName.Contains '\000' then None
    elif fileName.StartsWith "/" then Some fileName
    elif fileName.Contains '/' then Some(pathJoin cwd fileName)
    else
        let raw = field env "PATH"
        let fallback = field environment "PATH"
        let pathText = if isString raw then unbox raw elif isString fallback then unbox fallback else ""
        pathText.Split ':'
        |> Array.map (fun directory -> pathJoin (if directory = "" then cwd else directory) fileName)
        |> Array.tryFind executableFile
        |> Option.defaultValue (pathJoin "/nonexistent-wanxiang-bin" fileName)
        |> Some

type private Child =
    { Exit: Task<int>
      IsClosed: unit -> bool
      Kill: unit -> unit
      OnClosed: ResizeArray<unit -> unit> }

let private startSession executable cwd env command (spool: SpoolMessages) signal =
    task {
        let completion = TaskCompletionSource<int>()
        observeFailure completion.Task
        let callbacks = ResizeArray<unit -> unit>()
        let mutable closed = false
        let options =
            createObj
                [ "executable" ==> executable; "args" ==> field command "args"
                  "cwd" ==> cwd; "env" ==> env; "tailBytes" ==> 0; "maxWriteBytes" ==> 16777216 ]
        let created =
            try
                let receive channel bytes = spool.append(channel, bytes) |> ignore
                Ok(ProcessSession options (box (Action<string, byte array>(receive))))
            with error -> Error(messageOr (box error) "Failed to create ProcessSession")
        match created with
        | Error reason -> return Error reason
        | Ok session ->
            let! started = session.started() |> asTask
            if isNullOrUndefined started || field started "kind" = box "Failed" then
                let error = if isNullOrUndefined started then null else field started "error"
                return Error(messageOr error ("Failed to spawn process: " + executable))
            else
                let mutable firstFailure: exn option = None
                let rememberFailure error =
                    if firstFailure.IsNone then firstFailure <- Some(asError error)
                    session.signal "SIGKILL" |> ignore
                let kill () = try session.signal "SIGKILL" |> ignore with _ -> ()
                let inputDone =
                    task {
                        try
                            let stdin = field command "stdin"
                            if isString stdin && unbox<string> stdin <> "" then
                                let bytes = Encoding.UTF8.GetBytes(unbox<string> stdin)
                                let mutable offset = 0
                                while offset < bytes.Length do
                                    let length = min 16777216 (bytes.Length - offset)
                                    let! written = session.write(Array.sub bytes offset length) |> asTask
                                    if isNullOrUndefined written || field written "kind" <> box "Written" then
                                        let error = if isNullOrUndefined written then null else field written "error"
                                        let message = if isNullOrUndefined error then box "Input write was not confirmed" else field error "message"
                                        raise (inputError message)
                                    offset <- offset + length
                            session.endInput()
                        with error -> rememberFailure (box error)
                    }
                task {
                    let mutable waiting = true
                    while waiting do
                        let! waited = session.wait 20. |> asTask
                        let state = field waited "state"
                        let error = field state "failure"
                        if not (isNullOrUndefined error) then rememberFailure error
                        if field waited "kind" = box "Closed" then
                            do! inputDone
                            let exit = field state "exit"
                            let code =
                                if isNullOrUndefined exit || jsTypeof (field exit "code") <> "number" then -1
                                else unbox<int> (field exit "code")
                            if isNullOrUndefined exit && firstFailure.IsNone then
                                firstFailure <- Some(Exception "Process closed without an exit receipt")
                            closed <- true
                            match firstFailure with
                            | None -> complete completion code
                            | Some error -> completion.SetException error
                            let pending = callbacks.ToArray()
                            callbacks.Clear()
                            for notify in pending do notify ()
                            waiting <- false
                } |> ignore
                if GateSignal.isAborted signal && not closed then kill ()
                return Ok { Exit = completion.Task; IsClosed = (fun () -> closed); Kill = kill; OnClosed = callbacks }
    }

let private spawn request spool signal =
    task {
        if GateSignal.isAborted signal then return Error "Cancelled before spawn"
        else
            let command = field request "command"
            let env = buildEnvironment command
            let cwd = workingDirectory command (context request)
            let fileName: string = unbox (field command "fileName")
            match executablePath fileName cwd env with
            | None -> return Error(sprintf "Failed to spawn process: %s" fileName)
            | Some executable -> return! startSession executable cwd env command spool signal
    }

type private WaitSignal = ProcessClosed | TimerElapsed | Cancelled

let private waitForSignal child milliseconds signal =
    task {
        let completion = TaskCompletionSource<WaitSignal>()
        let onClosed () = complete completion ProcessClosed
        child.OnClosed.Add onClosed
        if child.IsClosed() then
            child.OnClosed.Remove onClosed |> ignore
            return ProcessClosed
        else
            let timer = Wanxiangli.Process.Native.timer (fun () -> complete completion TimerElapsed) milliseconds
            let onAbort () = complete completion Cancelled
            GateSignal.addAbortOnce signal onAbort
            if GateSignal.isAborted signal then onAbort ()
            try return! completion.Task
            finally
                Wanxiangli.Process.Native.clearTimer timer
                GateSignal.removeAbort signal onAbort
                child.OnClosed.Remove onClosed |> ignore
    }

let private cancelChild child =
    child.Kill()
    raise (OperationCanceledException())

let private waitForExit child deadline signal =
    task {
        if GateSignal.isAborted signal then cancelChild child
        let! first =
            task {
                if child.IsClosed() then return ProcessClosed
                else
                    let milliseconds = Deadline.nextWaitMs clock.UtcNow deadline
                    if milliseconds = 0 then return TimerElapsed
                    else return! waitForSignal child milliseconds signal
            }
        match first with
        | ProcessClosed ->
            let! exitCode = child.Exit
            return exitCode, false
        | Cancelled -> return cancelChild child
        | TimerElapsed when child.IsClosed() ->
            let! exitCode = child.Exit
            return exitCode, false
        | TimerElapsed ->
            child.Kill()
            let! acknowledged =
                if child.IsClosed() then Task.FromResult ProcessClosed
                else waitForSignal child 1000 signal
            match acknowledged with
            | ProcessClosed ->
                let! exitCode = child.Exit
                return exitCode, true
            | Cancelled -> return cancelChild child
            | TimerElapsed -> return -1, true
    }

let private finish (spool: SpoolMessages) exitCode =
    let result = spool.finish()
    match unbox<string> (field result "kind") with
    | "Memory" ->
        let decode name =
            let bytes: byte array = unbox (field result name)
            Encoding.UTF8.GetString(bytes, 0, bytes.Length)
        success (createObj [ "kind" ==> "Completed"; "exitCode" ==> exitCode
                             "stdout" ==> decode "stdout"; "stderr" ==> decode "stderr"; "spooled" ==> false ])
    | "File" ->
        let bytes = int64 (unbox<float> (field result "bytes"))
        let chunks = if bytes <= 0L then 0 else int (((bytes - 1L) / 204800L) + 1L)
        success (createObj [ "kind" ==> "Spooled"; "exitCode" ==> exitCode; "spoolPath" ==> field result "path"
                             "totalBytes" ==> bytes; "chunkCount" ==> chunks ])
    | _ ->
        spool.discard() |> ignore
        let error = field result "error"
        let code = field error "code"
        let reason =
            sprintf "output spool %s failed (%s: %s) after %d of %d bytes; process exit code %d, output incomplete"
                (string (field error "operation")) (if isNullOrUndefined code then "unknown" else string code)
                (string (field error "message")) (int64 (unbox<float> (field result "written")))
                (int64 (unbox<float> (field result "observed"))) exitCode
        failure "ExecutionFailed" reason

let private runSpawned child (spool: SpoolMessages) estimate ctx signal =
    task {
        let hardLimit = field ctx "hardLimitMs" |> valueOr (box 3600000.) |> unbox<float> |> TimeSpan.FromMilliseconds
        let budget = min (TimeSpan.FromSeconds(unbox<float> (field estimate "runtimeSeconds"))) hardLimit
        try
            let! exitCode, timedOut = waitForExit child (Deadline.ofBudget (clock.UtcNow()) budget) signal
            try child.Kill() with _ -> ()
            if timedOut then
                spool.discard() |> ignore
                return createObj [ "ok" ==> false; "error" ==> createObj [ "kind" ==> "TimeoutExceeded"; "durationMs" ==> budget.TotalMilliseconds ] ]
            else return finish spool exitCode
        with error ->
            spool.discard() |> ignore
            return if GateSignal.isAborted signal then cancelled () else failure "ExecutionFailed" error.Message
    }

let private spawnWithOutput request outputBytes signal =
    task {
        try
            let ctx = context request
            let directory = field ctx "spoolDirectory" |> valueOr (box (tmpdir ()))
            let spool = OutputSpool (createObj [ "directory" ==> directory; "memoryBytes" ==> float (min outputBytes 204800L) ])
            let! started = spawn request spool signal
            match started with
            | Error reason ->
                spool.discard() |> ignore
                return Error(failure "SpawnFailed" reason)
            | Ok child -> return Ok(child, spool, ctx)
        with error ->
            return Error(if GateSignal.isAborted signal then cancelled () else failure "ExecutionFailed" error.Message)
    }

let private runAfterGate request estimate outputBytes signal =
    task {
        let! started = spawnWithOutput request outputBytes signal
        match started with
        | Error result -> return result
        | Ok(child, spool, ctx) -> return! runSpawned child spool estimate ctx signal
    }

let runProcess (request: obj) (signal: obj) : Task<obj> =
    task {
        let estimate = field request "estimate"
        let runtime = unbox<float> (field estimate "runtimeSeconds")
        let outputBytes = unbox<int64> (field estimate "outputBytes")
        if Double.IsNaN runtime || Double.IsInfinity runtime || runtime <= 0. then
            return failure "ExecutionFailed" "deadline_seconds must be a finite positive number"
        elif outputBytes < 0L then
            return failure "ExecutionFailed" "output_budget_bytes must be non-negative"
        else
            let large = field estimate "memory" = box "large"
            if large then do! largeGate.acquire(signal) |> asTask
            try return! runAfterGate request estimate outputBytes signal
            finally if large then largeGate.release()
    }
