namespace Wanxiangli.GitPublication

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private Operations =
    type Output =
        abstract code: int
        abstract stdout: string
        abstract stderr: string

    type Binding = { Repo: string; Run: obj }
    type Fault = { Code: string; Error: string }

    let private porcelain = Wanxiangli.GitPorcelain.GitPorcelain.GitPorcelain ()

    [<Import("default", "node:fs")>]
    let private fs: obj = jsNative

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
    let private command (_cwd: string) (_arguments: string array) : obj = jsNative

    [<Emit("$0($1)")>]
    let private invoke (_run: obj) (_command: obj) : Task<Output> = jsNative

    let private run binding directory arguments = invoke binding.Run (command directory arguments)

    [<Emit("({ok: true, value: $0})")>]
    let private success (_value: obj) : obj = jsNative

    [<Emit("({ok: false, error: $0, code: $1})")>]
    let private failure (_message: string) (_code: string) : obj = jsNative

    let wire result =
        match result with
        | Ok value -> success (box value)
        | Error error -> failure error.Error error.Code

    let private failed message = { Code = "failed"; Error = message }
    let private moved message = { Code = "target-moved"; Error = message }

    let private andThen next pending =
        task {
            match! pending with
            | Ok value -> return! next value
            | Error error -> return Error error
        }

    let private diagnostic (output: Output) =
        if String.IsNullOrWhiteSpace output.stderr then output.stdout else output.stderr

    let private stderrOr missing (stderr: string) =
        if String.IsNullOrWhiteSpace stderr then missing else stderr.Trim()

    let private outcome (output: Output) =
        if output.code = 0 then Ok () else Error(failed (diagnostic output))

    let private renamedTarget (path: string) =
        let arrow = path.IndexOf(" -> ", StringComparison.Ordinal)
        if arrow >= 0 then path.Substring(arrow + 4).Trim() else path

    let private blockingPaths (output: string) =
        output.Split([| '\n'; '\r' |], StringSplitOptions.RemoveEmptyEntries)
        |> Array.choose (fun line ->
            if line.Length <= 3 then None
            else
                let path = renamedTarget (line.Substring(3).Trim())
                if String.IsNullOrWhiteSpace path then None else Some path)

    let dirtyPaths binding worktree =
        task {
            let! output = run binding worktree [| "status"; "--porcelain" |]
            return if output.code = 0 then Ok(blockingPaths output.stdout) else Error(failed (diagnostic output))
        }

    let currentBranch binding =
        task {
            let! output = run binding binding.Repo [| "symbolic-ref"; "--short"; "HEAD" |]
            if output.code <> 0 || String.IsNullOrWhiteSpace output.stdout then
                return Error(failed (stderrOr "cannot freeze target branch: repository HEAD is detached" output.stderr))
            else return Ok(output.stdout.Trim())
        }

    let private revParse binding directory spec missing =
        task {
            let! output = run binding directory [| "rev-parse"; spec |]
            if output.code <> 0 then return Error(failed (stderrOr missing output.stderr))
            elif String.IsNullOrWhiteSpace output.stdout then return Error(failed missing)
            else return Ok(output.stdout.Trim())
        }

    let readHead binding worktree = revParse binding worktree "HEAD" "HEAD is empty"
    let targetHead binding target = revParse binding binding.Repo ("refs/heads/" + target) ("target branch not found: " + target)

    [<Emit("({code: $0, path: $1})")>]
    let private probe (_code: int) (_path: string) : obj = jsNative

    [<Emit("$0.existsSync($1) && $0.statSync($1).isDirectory()")>]
    let private directoryExists (_fs: obj) (_path: string) : bool = jsNative

    let rebaseInProgress binding worktree =
        task {
            let! merge = run binding worktree [| "rev-parse"; "--git-path"; "rebase-merge" |]
            let! apply = run binding worktree [| "rev-parse"; "--git-path"; "rebase-apply" |]
            return
                porcelain.rebaseStatePaths(probe merge.code merge.stdout, probe apply.code apply.stdout)
                |> Array.exists (directoryExists fs)
        }

    let private continueRebase binding worktree =
        task {
            let! add = run binding worktree [| "add"; "-A" |]
            if add.code <> 0 then return Error(failed (if String.IsNullOrWhiteSpace add.stderr then "" else add.stderr))
            else
                let! output = run binding worktree [| "-c"; "core.editor=true"; "rebase"; "--continue" |]
                return outcome output
        }

    let private freshRebase binding worktree target =
        task {
            let! _ = run binding worktree [| "update-ref"; "-d"; "REBASE_HEAD" |]
            let! output = run binding worktree [| "rebase"; target |]
            return outcome output
        }

    let rebase binding worktree target =
        task {
            let! inProgress = rebaseInProgress binding worktree
            if inProgress then return! continueRebase binding worktree
            else return! freshRebase binding worktree target
        }

    let conflictedPaths binding worktree =
        task {
            let! output = run binding worktree [| "diff"; "--name-only"; "--diff-filter=U" |]
            if output.code <> 0 then return Error(failed (diagnostic output))
            else return Ok(output.stdout.Split([| '\n'; '\r' |], StringSplitOptions.RemoveEmptyEntries))
        }

    let private commitCandidate binding worktree message =
        task {
            let! _ = run binding worktree [| "update-ref"; "-d"; "REBASE_HEAD" |]
            let! output = run binding worktree [| "commit"; "-m"; message |]
            if output.code = 0 || (output.stdout + output.stderr).Contains("nothing to commit") then return Ok ()
            else return Error(failed ("git commit failed: " + output.stderr))
        }

    let private finishPreparation binding worktree message =
        task {
            let! inProgress = rebaseInProgress binding worktree
            if inProgress then
                let! output = run binding worktree [| "-c"; "core.editor=true"; "rebase"; "--continue" |]
                return if output.code = 0 then Ok () else Error(failed ("git rebase --continue failed: " + output.stderr))
            else return! commitCandidate binding worktree message
        }

    let private scanMarkers binding worktree message =
        task {
            let! output = run binding worktree [| "grep"; "-I"; "-n"; "-E"; "^<<<<<<< |^>>>>>>> "; "--"; "." |]
            if output.code = 0 && not (String.IsNullOrWhiteSpace output.stdout) then
                return Error(failed ("conflict markers remain in worktree:\n" + output.stdout.Trim()))
            elif output.code > 1 then return Error(failed "conflict-marker scan failed")
            else return! finishPreparation binding worktree message
        }

    let private afterStage binding worktree message =
        task {
            let! output = run binding worktree [| "diff"; "--name-only"; "--diff-filter=U" |]
            if output.code <> 0 then return Error(failed ("conflict scan failed: " + output.stderr))
            elif not (String.IsNullOrWhiteSpace output.stdout) then
                return Error(failed ("unmerged paths remain after stage: " + output.stdout.Trim()))
            else return! scanMarkers binding worktree message
        }

    let prepare binding worktree message =
        task {
            let! output = run binding worktree [| "add"; "-A" |]
            if output.code <> 0 then return Error(failed ("git add failed: " + output.stderr))
            else return! afterStage binding worktree message
        }

    let private requireBranch binding target =
        task {
            let! output = run binding binding.Repo [| "symbolic-ref"; "--short"; "HEAD" |]
            if output.code <> 0 || output.stdout.Trim() <> target then
                let current = if output.code = 0 then output.stdout.Trim() else "<detached HEAD>"
                return Error(failed (sprintf "publish branch mismatch: target repo is on '%s' but publish is frozen to '%s'" current target))
            else return Ok ()
        }

    let private requireAncestor binding current candidate =
        task {
            let! output = run binding binding.Repo [| "merge-base"; "--is-ancestor"; current; candidate |]
            return if output.code = 0 then Ok ()
                   else Error(failed (stderrOr "candidate is not a fast-forward of the target branch" output.stderr))
        }

    let private requireClean binding =
        task {
            let! output = run binding binding.Repo [| "status"; "--porcelain" |]
            if output.code <> 0 then return Error(failed (diagnostic output))
            elif String.IsNullOrWhiteSpace output.stdout then return Ok ()
            else return Error(failed ("target worktree has uncommitted changes; refusing ff-only merge: " + String.concat ", " (blockingPaths output.stdout)))
        }

    let private verifyHead binding candidate =
        task {
            let! output = run binding binding.Repo [| "rev-parse"; "HEAD" |]
            if output.code <> 0 then return Error(failed (diagnostic output))
            elif output.stdout.Trim() = candidate then return Ok candidate
            else return Error(failed (sprintf "ff-only merge did not advance HEAD to candidate %s (got %s)" candidate (output.stdout.Trim())))
        }

    let private isRefMoved (message: string) =
        [| "cannot lock ref"; "update-ref"; "expected" |]
        |> Array.exists (fun marker -> message.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0)

    let private merge binding candidate =
        task {
            let! output = run binding binding.Repo [| "merge"; "--ff-only"; candidate |]
            if output.code = 0 then return! verifyHead binding candidate
            else
                let message = diagnostic output
                return Error(if isRefMoved message then moved message else failed message)
        }

    let fastForward binding worktree target expected candidate =
        revParse binding worktree "HEAD" "candidate HEAD is empty"
        |> andThen (fun current ->
            if current <> candidate then
                Task.FromResult(Error(failed (sprintf "worktree HEAD %s does not match pinned candidate %s" current candidate)))
            else requireBranch binding target)
        |> andThen (fun () -> revParse binding binding.Repo ("refs/heads/" + target) "target branch not found")
        |> andThen (fun current ->
            if current <> expected then Task.FromResult(Error(moved "target branch HEAD changed from the expected commit"))
            else requireAncestor binding current candidate)
        |> andThen (fun () -> requireClean binding)
        |> andThen (fun () -> merge binding candidate)

[<AttachMembers>]
type GitPublication(repo: string, run: obj) as this =
    do Operations.bind this repo run

    member this.dirtyPaths(worktree: string) : Task<obj> =
        task { let! result = Operations.dirtyPaths (Operations.binding this) worktree in return Operations.wire result }
    member this.currentBranch() : Task<obj> =
        task { let! result = Operations.currentBranch (Operations.binding this) in return Operations.wire result }
    member this.readHead(worktree: string) : Task<obj> =
        task { let! result = Operations.readHead (Operations.binding this) worktree in return Operations.wire result }
    member this.targetHead(target: string) : Task<obj> =
        task { let! result = Operations.targetHead (Operations.binding this) target in return Operations.wire result }
    member this.rebaseInProgress(worktree: string) : Task<bool> = Operations.rebaseInProgress (Operations.binding this) worktree
    member this.rebase(worktree: string, target: string) : Task<obj> =
        task { let! result = Operations.rebase (Operations.binding this) worktree target in return Operations.wire result }
    member this.conflictedPaths(worktree: string) : Task<obj> =
        task { let! result = Operations.conflictedPaths (Operations.binding this) worktree in return Operations.wire result }
    member this.prepare(worktree: string, commitMessage: string) : Task<obj> =
        task { let! result = Operations.prepare (Operations.binding this) worktree commitMessage in return Operations.wire result }
    member this.fastForward(request: obj) : Task<obj> =
        let worktree: string = request?worktree
        let target: string = request?target
        let expected: string = request?expectedHead
        let candidate: string = request?candidate
        task { let! result = Operations.fastForward (Operations.binding this) worktree target expected candidate in return Operations.wire result }
