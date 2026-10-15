module Wanxiangli.Fs.Filesystem

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Fs
open Wanxiangli.Fs.Native

[<AllowNullLiteral>]
type FilesystemMessages =
    abstract readUtf8: path: string -> obj
    abstract readUtf8Classified: path: string -> obj
    abstract glob: pattern: string -> JS.Promise<obj>
    abstract grep: needle: obj * pattern: string -> JS.Promise<obj>
    abstract findAnchor: text: string * declaration: obj * occurrence: float -> obj
    abstract requireUnique: text: string * declaration: obj -> obj
    abstract validateSingleIntent: mutations: obj -> obj
    abstract validateTargets: existing: string array * mutations: obj -> obj
    abstract validateFreshness: current: obj * mutations: obj -> obj
    abstract preflight: existing: string array * current: obj * readSnapshots: obj * mutations: obj -> obj
    abstract commitPlan: mutations: obj -> obj
    abstract rollbackPlan: mutations: obj -> obj
    abstract applyCommit: mutations: obj -> obj
    abstract applyRollback: mutations: obj -> unit
    abstract resolveToolPath: path: string -> string
    abstract resolveBounded: path: string -> obj
    abstract existsPath: path: string -> bool
    abstract undoIfMatches: path: string * expectedCurrent: string * restoreTo: obj -> unit
    abstract matchesPathPattern: pattern: string * path: string -> obj
    abstract compilePattern: pattern: string -> obj
    abstract testCompiled: regex: obj * text: string -> bool

/// 文件观察/编辑的公开入口：`Filesystem({ root })`。全部结果为 JS 原生
/// 数据 `{ ok: true, value }` 或 `{ ok: false, code, reason }`；code 与
/// 主仓稳定失败码同表。
let Filesystem (input: obj): FilesystemMessages =
    let root =
        let value = input?root
        if isNull value then "" else string value

    let text (value: obj) = if isNull value then "" else string value

    let anchorSpec (declaration: obj): Anchor.AnchorSpec =
        match text (declaration?kind) with
        | "exact" -> Anchor.Exact(text (declaration?text))
        | "regex" -> Anchor.Regex(text (declaration?text))
        | other -> invalidArg "kind" (sprintf "unknown anchor kind: %s" other)

    let needleSpec (needle: obj): Anchor.AnchorSpec =
        let kind = if isNull needle then null else needle?kind
        if isNull kind then Anchor.Exact(string needle)
        else anchorSpec needle

    let readCurrentOf (current: obj) (path: string): string option =
        if isNull current then None
        else
            let value = current?(path)
            if isNull value then None else Some(string value)

    let readSnapshotsOf (value: obj): (string * string) list =
        if isNull value then []
        else
            unbox<obj array> value
            |> Array.toList
            |> List.map (fun snapshot -> (text (snapshot?path), text (snapshot?text)))

    let anchorResult (result: Result<int * int, FsFailure>): obj =
        match result with
        | Ok(startIndex, endIndex) -> okResult (box [| box startIndex; box endIndex |])
        | Error e -> failureResult e

    let unitResult (result: Result<unit, FsFailure>): obj =
        match result with
        | Ok() -> okUnit
        | Error e -> failureResult e

    let promiseOf (computation: System.Threading.Tasks.Task<obj>): JS.Promise<obj> = unbox (box computation)

    { new FilesystemMessages with
        member _.readUtf8 path =
            match Utf8Fs.readUtf8 (MutationFs.resolveToolPath root path) with
            | Ok value -> okResult (box value)
            | Error e -> failureResult e

        member _.readUtf8Classified path =
            match Utf8Fs.readUtf8Classified (MutationFs.resolveToolPath root path) with
            | Ok value -> okResult (box value)
            | Error e -> failureResult e

        member _.glob pattern =
            promiseOf
                (task {
                    match! GlobFs.glob root pattern with
                    | Ok paths -> return okResult (objectOf [| "paths", box (Array.ofList paths) |])
                    | Error e -> return failureResult e
                })

        member _.grep (needle, pattern) =
            promiseOf
                (task {
                    match! AnchorFs.grep root (needleSpec needle) pattern with
                    | Ok listing ->
                        let matches =
                            listing.Matches
                            |> List.map (fun hit ->
                                objectOf
                                    [| "path", box hit.Path
                                       "line", box hit.Line
                                       "column", box hit.Column
                                       "text", box hit.Text |])
                            |> Array.ofList
                        let readSnapshots =
                            listing.ReadSnapshots
                            |> List.map (fun (path, text) -> objectOf [| "path", box path; "text", box text |])
                            |> Array.ofList
                        return
                            okResult (objectOf [| "matches", box matches; "readSnapshots", box readSnapshots |])
                    | Error e -> return failureResult e
                })

        member _.findAnchor (content, declaration, occurrence) =
            let occurrence = int occurrence
            if occurrence < 1 then
                failureResult (failure "INVALID_ANCHOR_PATTERN" "anchor RegExp is invalid")
            else
                anchorResult (Anchor.findAnchor content (anchorSpec declaration) occurrence)

        member _.requireUnique (content, declaration) =
            anchorResult (Anchor.requireUnique content (anchorSpec declaration))

        member _.validateSingleIntent mutations =
            unitResult (Result.map ignore (Transaction.validateSingleIntent (Transaction.mutationsOf mutations)))

        member _.validateTargets (existing, mutations) =
            let exists path = Array.contains path existing
            unitResult (Transaction.validateTargets exists (Transaction.mutationsOf mutations))

        member _.validateFreshness (current, mutations) =
            unitResult (Transaction.validateFreshness (readCurrentOf current) (Transaction.mutationsOf mutations))

        member _.preflight (existing, current, readSnapshots, mutations) =
            let exists path = Array.contains path existing
            unitResult
                (Transaction.preflight
                    exists
                    (readCurrentOf current)
                    (readSnapshotsOf readSnapshots)
                    (Transaction.mutationsOf mutations))

        member _.commitPlan mutations =
            let entries =
                Transaction.mutationsOf mutations
                |> Transaction.commitPlan
                |> List.map (fun (path, originalText, newText) ->
                    match originalText with
                    | Some original ->
                        objectOf
                            [| "kind", box "rewrite"
                               "path", box path
                               "originalText", box original
                               "newText", box newText |]
                    | None -> objectOf [| "kind", box "create"; "path", box path; "text", box newText |])
                |> Array.ofList
            okResult (box entries)

        member _.rollbackPlan mutations =
            let entries =
                Transaction.mutationsOf mutations
                |> Transaction.rollbackPlan
                |> List.map (fun (path, expectedCurrent, restoreTo) ->
                    match restoreTo with
                    | Some original ->
                        objectOf
                            [| "kind", box "restore"
                               "path", box path
                               "expectedCurrent", box expectedCurrent
                               "originalText", box original |]
                    | None -> objectOf [| "kind", box "removeCreated"; "path", box path; "expectedCurrent", box expectedCurrent |])
                |> Array.ofList
            okResult (box entries)

        member _.applyCommit mutations =
            unitResult (MutationFs.commitStaged root (Transaction.mutationsOf mutations))

        member _.applyRollback mutations =
            MutationFs.rollbackStaged root (Transaction.mutationsOf mutations)

        member _.resolveToolPath path = MutationFs.resolveToolPath root path

        member _.resolveBounded path =
            match MutationFs.resolveBounded root path with
            | Ok resolved -> okResult (box resolved)
            | Error e -> failureResult e

        member _.existsPath path = MutationFs.existsPath path

        member _.undoIfMatches (path, expectedCurrent, restoreTo) =
            let restore =
                if isNull restoreTo then None
                else Some(string restoreTo)
            MutationFs.undoIfMatches (MutationFs.resolveToolPath root path) expectedCurrent restore

        member _.matchesPathPattern (pattern, path) =
            match GlobMatch.matchesPathPattern pattern path with
            | Ok value -> okResult (box value)
            | Error _ -> failureResult (failure "INVALID_ANCHOR_PATTERN" "anchor RegExp is invalid")

        member _.compilePattern pattern =
            match GlobMatch.compilePattern pattern with
            | Ok regex -> okResult regex
            | Error _ -> failureResult (failure "INVALID_ANCHOR_PATTERN" "anchor RegExp is invalid")

        member _.testCompiled (regex, content) = GlobMatch.testCompiled regex content }
