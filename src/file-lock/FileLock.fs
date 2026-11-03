module Wanxiangli.FileLock

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<Import("default", "node:fs")>]
let private nodeFs: obj = jsNative

[<Import("default", "node:path")>]
let private nodePath: obj = jsNative

// 保留原有进程活性辅助判断；缺损 owner 仍回落到文件时间。
[<Emit("""
(function(nodeFs, nodePath) {
    function isProcessAlive(pid) {
        if (typeof pid !== 'number' || pid <= 0 || isNaN(pid)) return false;
        try {
            process.kill(pid, 0);
            return true;
        } catch (e) {
            return e.code === 'EPERM';
        }
    }
    return Object.assign({}, nodeFs, {
        mkdir: function(dirPath, cb) {
            try {
                nodeFs.mkdirSync(dirPath);
                try {
                    nodeFs.writeFileSync(nodePath.join(dirPath, 'owner.json'), JSON.stringify({ pid: process.pid, time: Date.now() }));
                } catch (_) {}
                if (typeof cb === 'function') cb(null);
            } catch (err) {
                if (typeof cb === 'function') cb(err);
            }
        },
        rmdir: function(dirPath, cb) {
            try {
                nodeFs.rmSync(dirPath, { recursive: true, force: true });
                if (typeof cb === 'function') cb(null);
            } catch (err) {
                if (typeof cb === 'function') cb(err);
            }
        },
        rmdirSync: function(dirPath) {
            nodeFs.rmSync(dirPath, { recursive: true, force: true });
        },
        stat: function(dirPath, cb) {
            try {
                var stat = nodeFs.statSync(dirPath);
                try {
                    var ownerFile = nodePath.join(dirPath, 'owner.json');
                    if (nodeFs.existsSync(ownerFile)) {
                        var data = JSON.parse(nodeFs.readFileSync(ownerFile, 'utf8'));
                        if (data && data.pid && !isProcessAlive(data.pid)) {
                            stat.mtime = new Date(0);
                            stat.mtimeMs = 0;
                        }
                    }
                } catch (_) {}
                if (typeof cb === 'function') cb(null, stat);
            } catch (err) {
                if (typeof cb === 'function') cb(err);
            }
        }
    });
})($0, $1)
""")>]
let private buildProcessAwareFs (_fs: obj) (_path: obj) : obj = jsNative

let private processAwareFs = buildProcessAwareFs nodeFs nodePath

[<Import("default", "proper-lockfile")>]
let private lockfile: obj = jsNative

[<Emit("$0($1, $2)")>]
let private lockAsync (_fn: obj) (_path: string) (_options: obj) : Task<obj> = jsNative

[<Emit("$0()")>]
let private releaseAsync (_fn: obj) : Task<unit> = jsNative

[<Emit("({release: $0})")>]
let private leaseObject (_release: unit -> Task<unit>) : obj = jsNative

[<Emit("($0 != null && $0.code === 'ELOCKED')")>]
let private isLockContention (_cause: exn) : bool = jsNative

[<Import("setTimeout", "node:timers/promises")>]
let private waitForRetry (_milliseconds: int) : Task<unit> = jsNative

[<Emit("Date.now()")>]
let private currentTimeMs () : float = jsNative

[<Emit("$0.kind")>]
let private waitKind (_wait: obj) : string = jsNative

[<Emit("$0[$1]")>]
let private waitNumber (_wait: obj) (_key: string) : float = jsNative

[<Emit("new WeakSet()")>]
let private createTimeouts () : obj = jsNative

let private timeouts = createTimeouts ()

[<Emit("Object.assign(new Error('File lock acquire budget exhausted for ' + $0), {name: 'FileLockAcquireTimeout', path: $0, attempts: $1, waitedMs: $2})")>]
let private timeoutError (_path: string) (_attempts: int) (_waitedMs: float) : exn = jsNative

[<Emit("$0.add($1)")>]
let private rememberTimeout (_set: obj) (_error: exn) : unit = jsNative

[<Emit("$0.has($1)")>]
let private containsTimeout (_set: obj) (_error: obj) : bool = jsNative

let isAcquireTimeout (cause: obj) : bool = containsTimeout timeouts cause

let private lease release =
    let mutable released = false
    leaseObject (fun () ->
        task {
            if not released then
                released <- true
                do! releaseAsync release
        })

let private options retries =
    createObj [ "fs" ==> processAwareFs; "realpath" ==> false
                "stale" ==> 5000; "update" ==> 1500; "retries" ==> retries ]

let private acquireBudget path budgetMs : Task<obj> =
    task {
        let settings = options (box 0)
        let mutable acquired: obj option = None
        let mutable step = 0
        let mutable attempts = 0
        let started = currentTimeMs ()
        while acquired.IsNone && currentTimeMs () - started < budgetMs do
            try
                let! release = lockAsync lockfile path settings
                acquired <- Some release
            with cause when isLockContention cause ->
                let delay = min 150.0 (Math.Round(30.0 * Math.Pow(1.1, float step))) |> int
                do! waitForRetry delay
            step <- (step + 1) % 10
            attempts <- attempts + 1
        match acquired with
        | Some release -> return release
        | None ->
            let error = timeoutError path attempts (currentTimeMs () - started)
            rememberTimeout timeouts error
            return raise error
    }

let acquire (path: string) (wait: obj) : Task<obj> =
    task {
        let! release =
            match waitKind wait with
            | "Retry" ->
                let retries = createObj [ "retries" ==> waitNumber wait "retries"
                                          "minTimeout" ==> waitNumber wait "minTimeoutMs"
                                          "maxTimeout" ==> waitNumber wait "maxTimeoutMs"
                                          "factor" ==> waitNumber wait "factor" ]
                lockAsync lockfile path (options retries)
            | "Budget" -> acquireBudget path (waitNumber wait "budgetMs")
            | _ -> invalidArg "wait" "Unknown file lock wait strategy"
        return lease release
    }
