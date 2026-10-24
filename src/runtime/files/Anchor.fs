namespace Wanxiangli.Fs

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Fs.Native

/// 有序锚点匹配与行定位的纯逻辑。锚点声明为
/// `{ kind: "exact" | "regex", text }`；`occurrence` 1-based。
/// 零宽匹配合法（start = end）。
module Anchor =

    type AnchorSpec =
        | Exact of string
        | Regex of string

    let specOf (value: obj) : AnchorSpec =
        let kind = string (value?kind: obj)
        let text = string (value?text: obj)

        match kind with
        | "exact" -> Exact text
        | "regex" -> Regex text
        | other -> invalidArg "kind" (sprintf "unknown anchor kind: %s" other)

    [<Emit("""
        ((text, re, occurrence) => {
          let index = 0;
          let m;
          while ((m = re.exec(text)) !== null) {
            index += 1;
            if (index === occurrence) {
              const matched = m[0] === undefined ? '' : m[0];
              return { found: true, start: m.index, end: m.index + matched.length };
            }
            if (m.index === re.lastIndex) re.lastIndex += 1;
          }
          return { found: false };
        })($0, $1, $2)
    """)>]
    let private findRegexOccurrence (_text: string) (_re: obj) (_occurrence: int) : obj = jsNative

    [<Emit("""
        ((text, re) => {
          const hits = [];
          let m;
          while ((m = re.exec(text)) !== null) {
            hits.push({ index: m.index, text: m[0] === undefined ? '' : m[0] });
            if (m.index === re.lastIndex) re.lastIndex += 1;
          }
          return hits;
        })($0, $1)
    """)>]
    let private allRegexHits (_text: string) (_re: obj) : obj array = jsNative

    [<Emit("$0.found === true")>]
    let private matchFound (_m: obj) : bool = jsNative

    [<Emit("$0.start")>]
    let private matchStart (_m: obj) : int = jsNative

    [<Emit("$0.end")>]
    let private matchEnd (_m: obj) : int = jsNative

    /// 每行起始偏移索引。lineOffsets[0]=0；只认 '\n'，不做 CRLF 修正。
    let private lineOffsets (text: string) : int array =
        let offsets = ResizeArray<int>()
        offsets.Add 0

        for i in 0 .. text.Length - 1 do
            if text[i] = '\n' then
                offsets.Add(i + 1)

        offsets.ToArray()

    /// (line, column) 均 1-based；index 落在 '\n' 上时该换行属于当前行。
    let lineColumn (text: string) (index: int) : int * int =
        let offsets = lineOffsets text
        let mutable lo = 0
        let mutable hi = offsets.Length - 1

        while lo < hi do
            let mid = (lo + hi + 1) / 2
            if offsets[mid] <= index then lo <- mid else hi <- mid - 1

        lo + 1, index - offsets[lo] + 1

    let private exactHits (text: string) (needle: string) : (int * string) list =
        let rec go fromIndex =
            let idx = text.IndexOf(needle, fromIndex, System.StringComparison.Ordinal)

            if idx < 0 then
                []
            else
                (idx, needle) :: go (idx + max needle.Length 1)

        if needle = "" then [] else go 0

    let private regexHits (text: string) (source: string) : (int * string) list =
        try
            allRegexHits text (regexGlobal source)
            |> Array.toList
            |> List.map (fun hit -> (int (hit?index), string (hit?text: obj)))
        with _ ->
            []

    let hits (text: string) (spec: AnchorSpec) : (int * string) list =
        match spec with
        | Exact needle -> exactHits text needle
        | Regex source -> regexHits text source

    /// 第 n 次 exact 命中的索引，从 fromIndex 起向前（ordinal）；缺失为 -1。
    let rec private nthIndex (text: string) (needle: string) (fromIndex: int) (n: int) : int =
        if n <= 0 then
            -1
        else
            let idx = text.IndexOf(needle, fromIndex, System.StringComparison.Ordinal)

            if idx < 0 then -1
            elif n = 1 then idx
            else nthIndex text needle (idx + needle.Length) (n - 1)

    let private findExactAnchor (text: string) (needle: string) (occurrence: int) : Result<int * int, FsFailure> =
        if System.String.IsNullOrEmpty needle then
            Error(failure "EMPTY_ANCHOR_CONTENT" "anchor content is empty")
        else
            let start = nthIndex text needle 0 occurrence

            if start < 0 then
                Error(failure "ANCHOR_NOT_FOUND" ("anchor did not match at occurrence " + string occurrence))
            else
                Ok(start, start + needle.Length)

    let private regexOccurrenceOrMissing
        (text: string)
        (pattern: string)
        (occurrence: int)
        : Result<int * int, FsFailure> =
        let re = regexGlobal pattern
        let m = findRegexOccurrence text re occurrence

        if matchFound m then
            Ok(matchStart m, matchEnd m)
        else
            Error(failure "ANCHOR_NOT_FOUND" ("anchor did not match at occurrence " + string occurrence))

    let private findRegexAnchor (text: string) (pattern: string) (occurrence: int) : Result<int * int, FsFailure> =
        if System.String.IsNullOrEmpty pattern then
            Error(failure "EMPTY_ANCHOR_CONTENT" "anchor content is empty")
        else
            try
                regexOccurrenceOrMissing text pattern occurrence
            with _ ->
                Error(failure "INVALID_ANCHOR_PATTERN" "anchor RegExp is invalid")

    let private findAnchorBySpec (text: string) (spec: AnchorSpec) (occurrence: int) : Result<int * int, FsFailure> =
        match spec with
        | Exact needle -> findExactAnchor text needle occurrence
        | Regex pattern -> findRegexAnchor text pattern occurrence

    /// 有序 string/RegExp 锚点匹配；`occurrence` 1-based，返回 (start, end)。
    let findAnchor (text: string) (spec: AnchorSpec) (occurrence: int) : Result<int * int, FsFailure> =
        if occurrence < 1 then
            Error(failure "INVALID_ANCHOR_PATTERN" "anchor RegExp is invalid")
        else
            findAnchorBySpec text spec occurrence

    let private uniqueAfterFirst (text: string) (spec: AnchorSpec) (first: int * int) : Result<int * int, FsFailure> =
        match findAnchor text spec 2 with
        | Ok _ -> Error(failure "ANCHOR_NOT_UNIQUE" "anchor matches multiple locations and no occurrence was declared")
        | Error _ -> Ok first

    /// 唯一性拒绝：未声明 occurrence 时锚点必须恰好命中一次。
    let requireUnique (text: string) (spec: AnchorSpec) : Result<int * int, FsFailure> =
        match findAnchor text spec 1 with
        | Error e -> Error e
        | Ok first -> uniqueAfterFirst text spec first
