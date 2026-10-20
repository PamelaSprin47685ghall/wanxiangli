module Wanxiangli.CasebookMaintenance.CasebookMaintenanceLaw

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("Number.isInteger($0)")>]
let private isInteger (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("$0 === null")>]
let private isNullExactly (value: obj) : bool = jsNative

[<Emit("$0.charCodeAt($1)")>]
let private codeUnitAt (text: string) (index: int) : float = jsNative

let private requireText (name: string) (value: obj) : string =
    if isString value then unbox<string> value
    else raise (System.ArgumentException(name + " must be a string"))

/// null 表示 Missing（文件在捕获时不存在）；字符串表示 Present 的完整文本；undefined 拒绝（漏传不是 Missing）。
let private requireState (name: string) (value: obj) : string option =
    if isNullExactly value then None
    elif isString value then Some(unbox<string> value)
    else raise (System.ArgumentException(name + " must be a string or null"))

// ---- 行切分与单行渲染 -------------------------------------------------------

/// 按 LF 切行，每行保留自己的 LF；最后一行无 LF 时原样保留（渲染时补 “No newline” 标记）。
let private diffLines (text: string) =
    let lines = text.Split '\n'
    match text with
    | "" -> [||]
    | text when text.EndsWith "\n" -> lines[.. lines.Length - 2] |> Array.map (fun line -> line + "\n")
    | _ -> lines |> Array.mapi (fun index line -> if index = lines.Length - 1 then line else line + "\n")

let private renderDiffLine prefix (line: string) =
    if line.EndsWith "\n" then prefix + line
    else prefix + line + "\n\\ No newline at end of file\n"

let private fileChangeKind before after =
    match before, after with
    | None, _ -> "new file\n"
    | _, None -> "deleted file\n"
    | _ -> ""

// ---- Myers 双向中点二分（零上下文行 diff） -----------------------------------
// 逐行冻结主仓 CasebookCapture 的算法：同一对 B/T 必须给出同一份 diff 文本，
// 否则 Bookkeeper 看到的变更与旧实现不同，WHAT 015 的“单次差异维护”就不再可比对。

type private LineRangePair =
    { OldStart: int
      OldEnd: int
      NewStart: int
      NewEnd: int }

let private followEqualLines (oldLines: string[]) (newLines: string[]) range backwards diagonal start =
    let oldLength = range.OldEnd - range.OldStart
    let newLength = range.NewEnd - range.NewStart
    let oldLine index = oldLines[if backwards then range.OldEnd - index - 1 else range.OldStart + index]
    let newLine index = newLines[if backwards then range.NewEnd - index - 1 else range.NewStart + index]
    // DSL-MUTABLE: algorithm-scratch — end of the equal-line run on this diagonal.
    let mutable position = start
    while position >= 0
          && position < oldLength
          && position - diagonal < newLength
          && oldLine position = newLine (position - diagonal) do
        position <- position + 1
    position

let private tryDiffOverlap oldLength newLength backwards diagonal oldPosition (opposite: int[]) oppositeDepth =
    let otherDiagonal = oldLength - newLength - diagonal
    let offset = opposite.Length / 2
    let otherPosition =
        match oppositeDepth with
        | Some otherDepth when oldPosition >= 0 && abs otherDiagonal <= otherDepth -> opposite[offset + otherDiagonal]
        | _ -> -1
    match otherPosition with
    | position when position < 0 || oldPosition + position < oldLength -> None
    | position when backwards -> Some(position, position - otherDiagonal)
    | _ -> Some(oldPosition, oldPosition - diagonal)

let private nextDiffPosition oldLength newLength depth diagonal (frontier: int[]) =
    let offset = frontier.Length / 2
    let insertion = if diagonal < depth then frontier[offset + diagonal + 1] else -1
    let deletion = if diagonal > -depth then frontier[offset + diagonal - 1] else -1
    let afterInsertion = if insertion >= 0 && insertion - diagonal - 1 < newLength then insertion else -1
    let afterDeletion = if deletion >= 0 && deletion < oldLength then deletion + 1 else -1
    if depth = 0 then 0 else max afterInsertion afterDeletion

let private advanceDiffFrontier oldLines newLines range backwards depth (frontier: int[]) (opposite: int[]) oppositeDepth =
    let oldLength = range.OldEnd - range.OldStart
    let newLength = range.NewEnd - range.NewStart
    let offset = frontier.Length / 2
    // DSL-MUTABLE: algorithm-scratch — current Myers wavefront diagonal.
    let mutable diagonal = -depth
    // DSL-MUTABLE: algorithm-scratch — first overlapping forward/reverse path.
    let mutable split = None
    while diagonal <= depth && split.IsNone do
        let start = nextDiffPosition oldLength newLength depth diagonal frontier
        let oldPosition = followEqualLines oldLines newLines range backwards diagonal start
        frontier[offset + diagonal] <- oldPosition
        split <- tryDiffOverlap oldLength newLength backwards diagonal oldPosition opposite oppositeDepth
        diagonal <- diagonal + 2
    split

let private middleDiffSplit oldLines newLines range =
    let oldLength = range.OldEnd - range.OldStart
    let newLength = range.NewEnd - range.NewStart
    let maxDepth = (oldLength + newLength + 1) / 2
    let forward = Array.create (2 * maxDepth + 3) -1
    let backward = Array.create forward.Length -1
    let oddDistance = (oldLength - newLength) % 2 <> 0
    // DSL-MUTABLE: algorithm-scratch — bidirectional edit distance.
    let mutable depth = 0
    // DSL-MUTABLE: algorithm-scratch — first meeting point at the shortest distance.
    let mutable split = None
    while split.IsNone && depth <= maxDepth do
        split <-
            advanceDiffFrontier oldLines newLines range false depth forward backward (if oddDistance then Some(depth - 1) else None)
            |> Option.orElseWith (fun () ->
                advanceDiffFrontier oldLines newLines range true depth backward forward (if oddDistance then None else Some depth))
        depth <- depth + 1
    match split with
    | Some(oldPosition, newPosition) when
        (oldPosition > 0 || newPosition > 0) && (oldPosition < oldLength || newPosition < newLength) ->
        range.OldStart + oldPosition, range.NewStart + newPosition
    | _ -> invalidOp "line diff bisection did not make progress"

let private trimEqualLines (oldLines: string[]) (newLines: string[]) range =
    let commonLength = min (range.OldEnd - range.OldStart) (range.NewEnd - range.NewStart)
    let prefix =
        Seq.init commonLength id
        |> Seq.takeWhile (fun index -> oldLines[range.OldStart + index] = newLines[range.NewStart + index])
        |> Seq.length
    let suffix =
        Seq.init (commonLength - prefix) id
        |> Seq.takeWhile (fun index -> oldLines[range.OldEnd - index - 1] = newLines[range.NewEnd - index - 1])
        |> Seq.length
    { OldStart = range.OldStart + prefix
      OldEnd = range.OldEnd - suffix
      NewStart = range.NewStart + prefix
      NewEnd = range.NewEnd - suffix }

let private haveCommonLine (oldLines: string[]) (newLines: string[]) range =
    let oldSet = HashSet<string>(seq { for index in range.OldStart .. range.OldEnd - 1 -> oldLines[index] })
    seq { for index in range.NewStart .. range.NewEnd - 1 -> newLines[index] } |> Seq.exists oldSet.Contains

let private appendChangedRange (changes: ResizeArray<LineRangePair>) range =
    if changes.Count > 0
       && changes[changes.Count - 1].OldEnd = range.OldStart
       && changes[changes.Count - 1].NewEnd = range.NewStart then
        changes[changes.Count - 1] <- { changes[changes.Count - 1] with OldEnd = range.OldEnd; NewEnd = range.NewEnd }
    else
        changes.Add range

let private enqueueDiffHalves oldLines newLines (pending: ResizeArray<LineRangePair>) range =
    let oldSplit, newSplit = middleDiffSplit oldLines newLines range
    pending.Add { range with OldStart = oldSplit; NewStart = newSplit }
    pending.Add { range with OldEnd = oldSplit; NewEnd = newSplit }

let private processDiffRange oldLines newLines pending changes range =
    match range with
    | range when range.OldStart = range.OldEnd && range.NewStart = range.NewEnd -> ()
    | range when range.OldStart = range.OldEnd || range.NewStart = range.NewEnd || not (haveCommonLine oldLines newLines range) ->
        appendChangedRange changes range
    | range -> enqueueDiffHalves oldLines newLines pending range

let private changedLineRanges (oldLines: string[]) (newLines: string[]) =
    let pending = ResizeArray<LineRangePair>()
    let changes = ResizeArray<LineRangePair>()
    pending.Add { OldStart = 0; OldEnd = oldLines.Length; NewStart = 0; NewEnd = newLines.Length }
    while pending.Count > 0 do
        let range = pending[pending.Count - 1] |> trimEqualLines oldLines newLines
        pending.RemoveAt(pending.Count - 1)
        processDiffRange oldLines newLines pending changes range
    changes |> Seq.toList

let private renderDiffHunk (oldLines: string[]) (newLines: string[]) range =
    let removed = range.OldEnd - range.OldStart
    let added = range.NewEnd - range.NewStart
    let start position count = if count = 0 then position else position + 1
    sprintf "@@ -%d,%d +%d,%d @@\n" (start range.OldStart removed) removed (start range.NewStart added) added
    + (oldLines[range.OldStart .. range.OldEnd - 1] |> Array.map (renderDiffLine "-") |> String.concat "")
    + (newLines[range.NewStart .. range.NewEnd - 1] |> Array.map (renderDiffLine "+") |> String.concat "")

let private fileDiffOf path (before: string option) (after: string option) =
    if before = after then ""
    else
        let oldLines = before |> Option.defaultValue "" |> diffLines
        let newLines = after |> Option.defaultValue "" |> diffLines
        let oldPath = if before.IsSome then "a/" + path else "/dev/null"
        let newPath = if after.IsSome then "b/" + path else "/dev/null"
        sprintf "diff --git a/%s b/%s\n%s--- %s\n+++ %s\n" path path (fileChangeKind before after) oldPath newPath
        + (changedLineRanges oldLines newLines |> List.map (renderDiffHunk oldLines newLines) |> String.concat "")

// ---- 预算截断（knowledge-reuse-014） ----------------------------------------

let private truncationNotice = "\n[... diff truncated / 差异已截断 ...]\n"

let private isHigh (text: string) index =
    let unit = codeUnitAt text index
    unit >= 55296.0 && unit <= 56319.0

let private isLow (text: string) index =
    let unit = codeUnitAt text index
    unit >= 56320.0 && unit <= 57343.0

/// Casebook 按差异维护的纯决策（knowledge-reuse-005/014/015/016）。不读文件、不读写 payload、不调 Bookkeeper、不写事件。
[<AttachMembers>]
type CasebookMaintenanceLaw() =
    /// 一个关联文件从维护基线 B 到目标状态 T 的零上下文统一 diff；null 为 Missing。B 与 T 相同（含同为 Missing）时为空串。
    member _.fileDiff(path: obj, before: obj, after: obj) : string =
        fileDiffOf (requireText "path" path) (requireState "before" before) (requireState "after" after)

    /// 逐文件 diff 按给出次序拼接；`refresh` 为 true 当且仅当拼接结果非空（有差异才请求 CaseRefresh）。
    member _.summarize(diffs: obj) : obj =
        if not (isArray diffs) then raise (System.ArgumentException "diffs must be an array")
        let summary = unbox<obj array> diffs |> Array.map (requireText "diff") |> String.concat ""
        createObj [ "diffSummary", box summary; "refresh", box (summary <> "") ]

    /// 读取目标文件失败的分类：只有 `ENOENT` 是 Missing；其它任何错误（含无 code）都是故障，不得冒充不存在（knowledge-reuse-016）。
    member _.readFailure(code: obj) : string =
        if isString code && unbox<string> code = "ENOENT" then "missing" else "fault"

    /// 把 diff 截到预算内：保留头尾各约一半与截断声明；不在代理对中间截断。预算不足以容纳声明时只给声明。
    member _.truncate(diff: obj, budget: obj) : obj =
        let text = requireText "diff" diff
        if not (isInteger budget) then raise (System.ArgumentException "budget must be an integer")
        let limit = unbox<int> budget
        if text.Length <= limit then
            createObj [ "text", box text; "isTruncated", box false; "notice", box "" ]
        else
            let available = max 0 (limit - truncationNotice.Length)
            let headLen = min (available / 2) text.Length
            let tailLen = available - available / 2
            let headLen = if headLen > 0 && isHigh text (headLen - 1) then headLen - 1 else headLen
            let tailStart = max 0 (text.Length - tailLen)
            let tailStart = if tailStart < text.Length && tailStart > 0 && isLow text tailStart then tailStart + 1 else tailStart
            createObj
                [ "text", box (text.Substring(0, headLen) + truncationNotice + text.Substring tailStart)
                  "isTruncated", box true
                  "notice", box "diff truncated to budget" ]
