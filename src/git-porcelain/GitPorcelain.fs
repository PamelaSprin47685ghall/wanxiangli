module Wanxiangli.GitPorcelain.GitPorcelain

open System
open Fable.Core
open Fable.Core.JsInterop

/// Read-only Git physics: how the text Git prints for worktrees, branches and
/// in-progress rebases is read (CUT-23 ①). No process is spawned here and no
/// file is touched; callers run Git and hand the raw output in.
module internal Wire =
    [<Emit("typeof $0 === 'string'")>]
    let isString (_: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number'")>]
    let isNumber (_: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_: obj) : bool = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_: obj) : obj = jsNative

    let text (owner: string) (name: string) (value: obj) : string =
        if isString value then
            unbox<string> value
        else
            raise (ArgumentException(sprintf "git-porcelain: %s requires string %s" owner name))

module internal Law =
    [<Literal>]
    let HeadsPrefix = "refs/heads/"

    [<Literal>]
    let ManagerPrefix = "manager/"

    /// `git worktree list --porcelain`: records separated by an empty line;
    /// `worktree <path>` opens a record, `branch <ref>` names its branch (full
    /// ref, as Git prints it). Lines are LF-terminated; a CR before the LF is
    /// part of the terminator, never a record separator.
    let worktrees (output: string) : (string * string option) list =
        let lines =
            output.Split([| '\n' |], StringSplitOptions.None)
            |> Array.map (fun line -> line.TrimEnd('\r'))
            |> Array.toList

        let close acc path branch =
            match path with
            | Some p -> (p, branch) :: acc
            | None -> acc

        let rec loop acc path branch rest =
            match rest with
            | [] -> List.rev (close acc path branch)
            | "" :: tail -> loop (close acc path branch) None None tail
            | (line: string) :: tail when line.StartsWith("worktree ", StringComparison.Ordinal) ->
                loop acc (Some(line.Substring(9).Trim())) branch tail
            | (line: string) :: tail when line.StartsWith("branch ", StringComparison.Ordinal) ->
                loop acc path (Some(line.Substring(7).Trim())) tail
            | _ :: tail -> loop acc path branch tail

        loop [] None None lines

    type Primary =
        | Primary of string
        | Bare
        | Unidentified

    /// `git worktree list --porcelain -z`: the first record is the primary
    /// working tree. A bare primary has no working tree.
    let primaryWorktree (outputZ: string) : Primary =
        let first =
            outputZ.Split([| '\u0000' |]) |> Array.takeWhile (fun field -> field <> "")

        if first |> Array.contains "bare" then
            Bare
        else
            match Array.tryHead first with
            | Some field when field.StartsWith("worktree ", StringComparison.Ordinal) ->
                Primary(field.Substring("worktree ".Length))
            | _ -> Unidentified

    /// `git branch --list`: a branch checked out here is prefixed `*`, one
    /// checked out in another worktree `+`; the marker is not part of the name.
    let branches (output: string) : string list =
        output.Split([| '\n'; '\r' |], StringSplitOptions.RemoveEmptyEntries)
        |> Array.map (fun value -> value.Trim().TrimStart('*', '+').Trim())
        |> Array.filter (String.IsNullOrWhiteSpace >> not)
        |> Array.toList

    let shortBranch (reference: string) : string =
        if reference.StartsWith(HeadsPrefix, StringComparison.Ordinal) then
            reference.Substring HeadsPrefix.Length
        else
            reference

    let isManagerBranch (reference: string) : bool =
        (shortBranch reference).StartsWith(ManagerPrefix, StringComparison.Ordinal)

    let managerBranchOf (jobId: string) : string = ManagerPrefix + jobId

    /// `git rev-parse --git-path rebase-merge|rebase-apply`: the directories
    /// whose existence means a rebase is in progress. A bare REBASE_HEAD is not
    /// evidence (it can survive a failed continue).
    let rebaseStatePaths (probes: (int * string) list) : string list =
        probes
        |> List.choose (fun (code, path) ->
            if code = 0 && not (String.IsNullOrWhiteSpace path) then
                Some(path.Trim())
            else
                None)

    /// Worktree cleanup (CUT-23 ②): of `worktree list` records, only manager
    /// branches no active job owns are stale. The primary working tree and
    /// detached worktrees are never ours to remove. Ownership is compared on the
    /// short branch name, whole: the job id is never parsed back out.
    let staleWorktrees (entries: (string * string option) list) (owned: Set<string>) : string list =
        entries
        |> List.choose (fun (path, branch) ->
            match branch with
            | Some reference when isManagerBranch reference && not (Set.contains (shortBranch reference) owned) ->
                Some path
            | _ -> None)

    /// Of the listed manager branches, the ones no active job owns, as listed.
    let staleBranches (branches: string list) (owned: Set<string>) : string list =
        branches |> List.filter (fun reference -> not (Set.contains (shortBranch reference) owned))

type GitPorcelainMessages =
    abstract worktrees: output: obj -> obj array
    abstract primaryWorktree: outputZ: obj -> obj
    abstract branches: output: obj -> string array
    abstract shortBranch: reference: obj -> string
    abstract isManagerBranch: reference: obj -> bool
    abstract managerBranchOf: jobId: obj -> string
    abstract rebaseStatePaths: merge: obj * apply: obj -> string array
    abstract staleWorktrees: entries: obj * owned: obj -> string array
    abstract staleBranches: branches: obj * owned: obj -> string array

let private probe (owner: string) (value: obj) : int * string =
    if isNull value then
        raise (ArgumentException(sprintf "git-porcelain: %s requires { code, path }" owner))
    else
        let code: obj = value?code
        let path: obj = value?path
        let c = if Wire.isNumber code then unbox<int> code else -1
        let p = if Wire.isString path then unbox<string> path else ""
        c, p

let private textArray (owner: string) (name: string) (value: obj) : string list =
    if Wire.isArray value then
        unbox<obj array> value |> Array.map (Wire.text owner name) |> Array.toList
    else
        raise (ArgumentException(sprintf "git-porcelain: %s requires string array %s" owner name))

let private entriesOf (owner: string) (value: obj) : (string * string option) list =
    if not (Wire.isArray value) then
        raise (ArgumentException(sprintf "git-porcelain: %s requires an entries array" owner))
    else
        unbox<obj array> value
        |> Array.map (fun entry ->
            if isNull entry then
                raise (ArgumentException(sprintf "git-porcelain: %s requires { path, branch } entries" owner))
            else
                let path: obj = entry?path
                let branch: obj = entry?branch
                Wire.text owner "entry.path" path,
                (if isNull branch then None else Some(Wire.text owner "entry.branch" branch)))
        |> Array.toList

let GitPorcelain () : GitPorcelainMessages =
    { new GitPorcelainMessages with
        member _.worktrees(output) =
            Law.worktrees (Wire.text "worktrees" "output" output)
            |> List.map (fun (path, branch) ->
                Wire.freeze (
                    createObj
                        [ "path" ==> path
                          "branch"
                          ==> (match branch with
                               | Some b -> box b
                               | None -> null) ]
                ))
            |> List.toArray

        member _.primaryWorktree(outputZ) =
            match Law.primaryWorktree (Wire.text "primaryWorktree" "outputZ" outputZ) with
            | Law.Primary path -> Wire.freeze (createObj [ "ok" ==> true; "path" ==> path ])
            | Law.Bare -> Wire.freeze (createObj [ "ok" ==> false; "code" ==> "bare" ])
            | Law.Unidentified -> Wire.freeze (createObj [ "ok" ==> false; "code" ==> "unidentified" ])

        member _.branches(output) =
            Law.branches (Wire.text "branches" "output" output) |> List.toArray

        member _.shortBranch(reference) =
            Law.shortBranch (Wire.text "shortBranch" "reference" reference)

        member _.isManagerBranch(reference) =
            Law.isManagerBranch (Wire.text "isManagerBranch" "reference" reference)

        member _.managerBranchOf(jobId) =
            Law.managerBranchOf (Wire.text "managerBranchOf" "jobId" jobId)

        member _.rebaseStatePaths(merge, apply) =
            Law.rebaseStatePaths [ probe "rebaseStatePaths" merge; probe "rebaseStatePaths" apply ]
            |> List.toArray

        member _.staleWorktrees(entries, owned) =
            Law.staleWorktrees (entriesOf "staleWorktrees" entries) (Set.ofList (textArray "staleWorktrees" "owned" owned))
            |> List.toArray

        member _.staleBranches(branches, owned) =
            Law.staleBranches (textArray "staleBranches" "branches" branches) (Set.ofList (textArray "staleBranches" "owned" owned))
            |> List.toArray }
