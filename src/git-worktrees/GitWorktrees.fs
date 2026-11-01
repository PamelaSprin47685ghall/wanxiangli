namespace Wanxiangli.GitWorktrees

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private Operations =
    type Output =
        abstract code: int
        abstract stdout: string
        abstract stderr: string

    type Porcelain =
        abstract worktrees: output: string -> obj array
        abstract branches: output: string -> string array

    type Binding = { Repo: string; Run: obj }

    [<Import("GitPorcelain", "wanxiangli/git-porcelain")>]
    let private createPorcelain: unit -> Porcelain = jsNative

    let private porcelain = createPorcelain ()

    [<Emit("new WeakMap()")>]
    let private createOwners () : obj = jsNative

    let private owners = createOwners ()

    [<Emit("$0.set($1, $2)")>]
    let private set (_owners: obj) (_owner: obj) (_binding: Binding) : unit = jsNative

    [<Emit("$0.get($1)")>]
    let private get (_owners: obj) (_owner: obj) : Binding = jsNative

    let bind owner repo run = set owners owner { Repo = repo; Run = run }
    let binding owner = get owners owner

    [<Emit("({cwd: $0, args: $1})")>]
    let private inDirectory (_cwd: string) (_arguments: string array) : obj = jsNative

    [<Emit("({args: $0})")>]
    let private withoutDirectory (_arguments: string array) : obj = jsNative

    [<Emit("$0($1)")>]
    let private invoke (_run: obj) (_command: obj) : Task<Output> = jsNative

    [<Emit("({ok: true, value: $0})")>]
    let success (_value: obj) : obj = jsNative

    [<Emit("({ok: true, value: undefined})")>]
    let private successUnit () : obj = jsNative

    [<Emit("({ok: false, error: $0})")>]
    let failure (_error: string) : obj = jsNative

    let result outcome =
        match outcome with
        | Ok () -> successUnit ()
        | Error message -> failure message

    let private diagnostic (output: Output) =
        if String.IsNullOrWhiteSpace output.stderr then output.stdout else output.stderr

    let private outcome (output: Output) =
        if output.code = 0 then Ok () else Error(diagnostic output)

    let private command binding cwd arguments =
        let message =
            match cwd with
            | Some directory -> inDirectory directory arguments
            | None -> withoutDirectory arguments
        invoke binding.Run message

    let create binding identity path sourceRef =
        task {
            let! output = command binding (Some binding.Repo) [| "worktree"; "add"; path; "-b"; identity; sourceRef |]
            return outcome output
        }

    let remove binding path =
        task {
            let! output = command binding None [| "worktree"; "remove"; "--force"; path |]
            return outcome output
        }

    let deleteBranch binding identity =
        task {
            let! output = command binding (Some binding.Repo) [| "branch"; "-D"; identity |]
            return outcome output
        }

    [<Emit("({path: $0, identity: $1})")>]
    let private entry (_path: string) (_identity: obj) : obj = jsNative

    let list binding =
        task {
            let! output = command binding (Some binding.Repo) [| "worktree"; "list"; "--porcelain" |]
            if output.code <> 0 then return failure (diagnostic output)
            else
                let entries = porcelain.worktrees output.stdout |> Array.map (fun value ->
                    let path: string = value?path
                    let identity: obj = value?branch
                    entry path identity)
                return success entries
        }

    let listBranches binding pattern =
        task {
            let! output = command binding (Some binding.Repo) [| "branch"; "--list"; pattern |]
            if output.code <> 0 then return failure (diagnostic output)
            else return success (porcelain.branches output.stdout)
        }

    [<Emit("Object.freeze({path: $0, identity: $1, markDurable: $2, release: $3, dispose: $4})")>]
    let private resourceObject (_path: string) (_identity: string) (_retain: unit -> unit)
        (_release: unit -> Task<obj>) (_dispose: unit -> Task<unit>) : obj = jsNative

    let resource binding identity path releaseInitially =
        let mutable released = false
        let mutable releaseOnDispose = releaseInitially
        let release () =
            task {
                if released then return Ok ()
                else
                    let! worktree = remove binding path
                    // 返回 Error 仍继续删分支；异常则自然中断，不把未知结果改成成功。
                    let! branch = deleteBranch binding identity
                    match worktree, branch with
                    | Ok (), Ok () -> released <- true; return Ok ()
                    | Error left, Error right -> return Error(sprintf "worktree=%s; branch=%s" left right)
                    | Error message, _ -> return Error("worktree=" + message)
                    | _, Error message -> return Error("branch=" + message)
            }
        let dispose () =
            task {
                if releaseOnDispose then
                    try
                        let! _ = release ()
                        ()
                    with _ -> ()
            }
        resourceObject path identity (fun () -> releaseOnDispose <- false)
            (fun () -> task { let! outcome = release () in return result outcome }) dispose

[<AttachMembers>]
type GitWorktrees(repo: string, run: obj) as this =
    do Operations.bind this repo run

    member this.create(identity: string, path: string, sourceRef: string) : Task<obj> =
        task {
            let binding = Operations.binding this
            match! Operations.create binding identity path sourceRef with
            | Ok () -> return Operations.success (Operations.resource binding identity path true)
            | Error message -> return Operations.failure message
        }

    member this.adopt(identity: string, path: string) : obj =
        Operations.resource (Operations.binding this) identity path false

    member this.remove(path: string) : Task<obj> =
        task { let! result = Operations.remove (Operations.binding this) path in return Operations.result result }

    member this.list() : Task<obj> = Operations.list (Operations.binding this)

    member this.listBranches(pattern: string) : Task<obj> = Operations.listBranches (Operations.binding this) pattern

    member this.deleteBranch(identity: string) : Task<obj> =
        task { let! result = Operations.deleteBranch (Operations.binding this) identity in return Operations.result result }
