module Wanxiangli.WorkspaceState

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<Import("default", "node:fs")>]
let private fs: obj = jsNative

[<Import("default", "node:path")>]
let private path: obj = jsNative

[<Import("execFile", "node:child_process")>]
let private execFile: obj = jsNative

[<Import("execFileSync", "node:child_process")>]
let private execFileSync: obj = jsNative

type private PathStore =
    abstract getOrCompute: workspace: string * compute: (string -> obj) -> obj

type private Porcelain =
    abstract primaryWorktree: listing: string -> obj

[<Import("runtimePathStore", "wanxiangli/git-porcelain")>]
let private store: PathStore = jsNative

[<Import("GitPorcelain", "wanxiangli/git-porcelain")>]
let private createPorcelain: unit -> Porcelain = jsNative

let private porcelain = createPorcelain ()

[<Emit("new Error($0)")>]
let private error (_message: string) : exn = jsNative

[<Emit("typeof $0 === 'string' && $0.trim().length > 0")>]
let private hasText (_value: string) : bool = jsNative

[<Emit("$0 == null")>]
let private missing (_value: obj) : bool = jsNative

[<Emit("$0.code === 'EEXIST'")>]
let private alreadyExists (_value: exn) : bool = jsNative

[<Emit("$0.resolve($1)")>]
let private resolve (_path: obj) (_value: string) : string = jsNative

[<Emit("$0.dirname($1)")>]
let private dirname (_path: obj) (_value: string) : string = jsNative

[<Emit("$0.basename($1)")>]
let private basename (_path: obj) (_value: string) : string = jsNative

[<Emit("$0.join($1, $2)")>]
let private join (_path: obj) (_left: string) (_right: string) : string = jsNative

[<Emit("$0.realpathSync($1)")>]
let private realpath (_fs: obj) (_value: string) : string = jsNative

[<Emit("$0.lstatSync($1, {throwIfNoEntry: false})")>]
let private lstat (_fs: obj) (_value: string) : obj = jsNative

[<Emit("$0.statSync($1).isDirectory()")>]
let private isDirectory (_fs: obj) (_value: string) : bool = jsNative

[<Emit("$0.isSymbolicLink() || !$0.isDirectory()")>]
let private invalidDirectory (_entry: obj) : bool = jsNative

[<Emit("$0.isSymbolicLink() || !$0.isFile()")>]
let private invalidFile (_entry: obj) : bool = jsNative

[<Emit("({encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0'}})")>]
let private queryOptions () : obj = jsNative

[<Emit("(function(error, stderr) { const status = typeof error.code === 'number' ? error.code : error.status; return status === 128 && typeof stderr === 'string' && stderr.startsWith('fatal: not a git repository'); })($0, $1)")>]
let private notGit (_cause: obj) (_stderr: obj) : bool = jsNative

[<Emit("new Promise(function(resolve, reject) { $0('git', $1, $2, function(error, stdout, stderr) { if (!error) resolve(stdout); else if ($3(error, stderr)) resolve(null); else reject(error); }); })")>]
let private queryAsync (_exec: obj) (_arguments: string array) (_options: obj) (_notGit: obj -> obj -> bool) : Task<string> = jsNative

[<Emit("$0('git', $1, $2)")>]
let private querySync (_exec: obj) (_arguments: string array) (_options: obj) : string = jsNative

[<Emit("$0.stderr")>]
let private stderr (_cause: exn) : obj = jsNative

let private outsideGit (directory: string) =
    if directory.Split([| '/'; '\\' |], StringSplitOptions.RemoveEmptyEntries)
       |> Array.exists (fun part -> part.Equals(".git", StringComparison.OrdinalIgnoreCase)) then
        raise (error "Application state must not be read or written inside .git")
    directory

let private absolute label value =
    if not (hasText value) then raise (error label)
    resolve path value |> outsideGit

let private canonicalDirectory directory =
    let canonical = realpath fs directory |> outsideGit
    if not (isDirectory fs canonical) then raise (error "The workspace must be a directory")
    canonical

let private anchor workspace =
    let directory = absolute "A workspace directory is required" workspace
    let entry = lstat fs directory
    let existing = if missing entry then dirname path directory else directory
    directory, canonicalDirectory existing, missing entry

let private arguments directory = [| "-C"; directory; "worktree"; "list"; "--porcelain"; "-z" |]

let private primary directory workspaceMissing listing =
    if isNull listing && workspaceMissing then
        raise (error "A missing workspace cannot be located outside a Git worktree")
    elif isNull listing then directory
    else
        let parsed = porcelain.primaryWorktree listing
        let ok: bool = parsed?ok
        if ok then
            let result: string = parsed?path
            canonicalDirectory result
        else
            let code: string = parsed?code
            raise (error (if code = "bare" then "Application state requires a working tree, not a bare repository"
                          else "Git did not identify the primary working tree"))

let private locate directory workspaceMissing : Task<string> =
    task {
        let! listing = queryAsync execFile (arguments directory) (queryOptions ()) notGit
        return primary directory workspaceMissing listing
    }

let primaryDirectory (workspace: string) : Task<string> =
    task {
        let key, directory, workspaceMissing = anchor workspace
        // 失踪路径不能复用它尚存时的成功回退；须重新查询父目录的 Git 归属。
        if workspaceMissing then return! locate directory true
        else
            let compute (_key: string) : obj = box (locate directory false)
            return! unbox<Task<string>> (store.getOrCompute(key, compute))
    }

let primaryDirectorySync (workspace: string) : string =
    let _, directory, workspaceMissing = anchor workspace
    let listing =
        try querySync execFileSync (arguments directory) (queryOptions ())
        with cause when notGit cause (stderr cause) -> null
    primary directory workspaceMissing listing

let checkStateDirectory (stateRoot: string) : string =
    let directory = absolute "A state directory is required" stateRoot
    let entry = lstat fs directory
    if not (missing entry) && invalidDirectory entry then
        raise (error "State directory must be a real directory, not a link or file")
    if missing entry then
        let parent = canonicalDirectory (dirname path directory)
        join path parent (basename path directory) |> outsideGit
    else
        realpath fs directory |> outsideGit

[<Emit("$0.mkdirSync($1, {recursive: true})")>]
let private mkdir (_fs: obj) (_directory: string) : unit = jsNative

[<Emit("$0.writeFileSync($1, '*\\n', {flag: 'wx', encoding: 'utf8'})")>]
let private writeIgnore (_fs: obj) (_file: string) : unit = jsNative

[<Emit("$0.readFileSync($1, 'utf8').trim()")>]
let private readIgnore (_fs: obj) (_file: string) : string = jsNative

let initializeStateDirectory (stateRoot: string) : string =
    let directory = checkStateDirectory stateRoot
    mkdir fs directory
    let ignore = join path directory ".gitignore"
    try writeIgnore fs ignore
    with cause when alreadyExists cause ->
        let entry = lstat fs ignore
        if missing entry || invalidFile entry || readIgnore fs ignore <> "*" then
            raise (error ".gitignore must be a regular file excluding all runtime data")
    directory
