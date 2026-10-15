namespace Wanxiangli.Fs

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Fs.Native

/// 纯事务决策：单意图校验、目标存在性、新鲜度比对与确定性
/// commit/rollback 计划。文件系统事实（存在性、当前内容）由调用方
/// 以数据注入（existing 数组、current 映射），决策保持确定性。
module Transaction =

    /// 暂存变更：`Rewrite(path, originalText, newText)` 编辑既有文件；
    /// `Create(path, text)` 创建缺失文件。
    type StagedMutation =
        | Rewrite of path: string * originalText: string * newText: string
        | Create of path: string * text: string

    let mutationPath (mutation: StagedMutation): string =
        match mutation with
        | Rewrite(path, _, _) -> path
        | Create(path, _) -> path

    /// 同一路径在一次程序中只允许一次修改意图。
    let validateSingleIntent (mutations: StagedMutation list): Result<StagedMutation list, FsFailure> =
        let duplicates =
            mutations
            |> List.countBy mutationPath
            |> List.tryFind (fun (_, count) -> count > 1)

        match duplicates with
        | Some(path, _) -> Error(failure "DUPLICATE_MUTATION_TARGET" ("the same path was mutated twice in one program: " + path))
        | None -> Ok mutations

    /// rewrite 目标必须存在，create 目标必须不存在。
    let validateTargets (exists: string -> bool) (mutations: StagedMutation list): Result<unit, FsFailure> =
        mutations
        |> List.tryPick (fun mutation ->
            match mutation with
            | Rewrite(path, _, _) when not (exists path) -> Some(failure "FILE_NOT_FOUND" ("target file does not exist: " + path))
            | Create(path, _) when exists path -> Some(failure "FILE_ALREADY_EXISTS" ("target file already exists: " + path))
            | _ -> None)
        |> function
            | Some e -> Error e
            | None -> Ok()

    let private freshnessFailure (readCurrent: string -> string option) (mutation: StagedMutation): FsFailure option =
        match mutation with
        | Rewrite(path, originalText, _) ->
            if readCurrent path = Some originalText then None
            else Some(failure "FILE_CHANGED" ("target changed since the read snapshot; no implicit retry: " + path))
        | Create _ -> None

    let validateFreshness (readCurrent: string -> string option) (mutations: StagedMutation list): Result<unit, FsFailure> =
        mutations
        |> List.tryPick (freshnessFailure readCurrent)
        |> function
            | Some e -> Error e
            | None -> Ok()

    let validateReadSnapshots (readCurrent: string -> string option) (snapshots: (string * string) list): Result<unit, FsFailure> =
        snapshots
        |> List.tryPick (fun (path, text) ->
            if readCurrent path = Some text then None
            else Some(failure "FILE_CHANGED" ("target changed since the read snapshot; no implicit retry: " + path)))
        |> function
            | Some e -> Error e
            | None -> Ok()

    let private validateCommitExistence (exists: string -> bool) (mutations: StagedMutation list): Result<unit, FsFailure> =
        mutations
        |> List.tryPick (fun mutation ->
            match mutation with
            | Rewrite(path, _, _) when not (exists path) -> Some(failure "FILE_CHANGED" ("target changed since the read snapshot; no implicit retry: " + path))
            | Create(path, _) when exists path -> Some(failure "FILE_CHANGED" ("target changed since the read snapshot; no implicit retry: " + path))
            | _ -> None)
        |> function
            | Some e -> Error e
            | None -> Ok()

    /// 完整预检：任一规则失败即拒绝，零文件效果。
    let preflight
        (exists: string -> bool)
        (readCurrent: string -> string option)
        (readSnapshots: (string * string) list)
        (mutations: StagedMutation list)
        : Result<unit, FsFailure> =
        validateSingleIntent mutations
        |> Result.bind (fun validated ->
            validateReadSnapshots readCurrent readSnapshots
            |> Result.bind (fun () -> validateCommitExistence exists validated)
            |> Result.bind (fun () -> validateFreshness readCurrent validated))

    /// 提交计划：按路径规范顺序，每条 mutation 一次写入。
    let commitPlan (mutations: StagedMutation list): (string * string option * string) list =
        mutations
        |> List.sortBy mutationPath
        |> List.map (fun mutation ->
            match mutation with
            | Rewrite(path, originalText, newText) -> (path, Some originalText, newText)
            | Create(path, text) -> (path, None, text))

    /// 回滚计划：逆序展开；Some 原文恢复重写，None 删除新建。
    let rollbackPlan (mutations: StagedMutation list): (string * string * string option) list =
        mutations
        |> List.sortBy mutationPath
        |> List.rev
        |> List.map (fun mutation ->
            match mutation with
            | Rewrite(path, originalText, newText) -> (path, newText, Some originalText)
            | Create(path, text) -> (path, text, None))

    /// JS 形状转换：`{ kind: "rewrite" | "create", ... }`。
    let mutationOf (value: obj): StagedMutation =
        let text (v: obj) = if isNull v then "" else string v

        match text (value?kind) with
        | "rewrite" -> Rewrite(text (value?path), text (value?originalText), text (value?newText))
        | "create" -> Create(text (value?path), text (value?text))
        | other -> invalidArg "kind" (sprintf "unknown staged mutation kind: %s" other)

    let mutationsOf (value: obj): StagedMutation list =
        if isNull value then []
        else unbox<obj array> value |> Array.toList |> List.map mutationOf
