module Wanxiangli.RuntimeTools

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Fs.Native

[<Import("resolve", "node:path")>]
let private pathResolve (_path: string) : string = jsNative

[<Import("relative", "node:path")>]
let private pathRelative (_from: string) (_toPath: string) : string = jsNative

[<Import("join", "node:path")>]
let private pathJoin (_a: string) (_b: string) : string = jsNative

[<Import("isAbsolute", "node:path")>]
let private pathIsAbsolute (_path: string) : bool = jsNative

[<Import("realpathSync", "node:fs")>]
let private realpathSync (_path: string) : string = jsNative

[<Import("spawn", "node:child_process")>]
let private spawnProcess: obj = jsNative

[<Emit("$0 === undefined || $0 === null")>]
let private isUndefined (_value: obj) : bool = jsNative

[<Emit("$0 === undefined")>]
let private isJsUndefined (_value: obj) : bool = jsNative

let private failureObj (problem: FsFailure) : obj = failureResult problem

/// A span must cross the vm boundary as a plain JS array, not a typed
/// array: the parked payload is JSON round-tripped, and a typed array
/// serializes to an object with numeric keys.
[<Emit("[$0, $1]")>]
let private jsSpan (_beginIndex: int) (_endIndex: int) : obj = jsNative

let private renderOutcome (outcome: Result<obj, FsFailure>) : obj =
    match outcome with
    | Error failure -> failureObj failure
    | Ok value -> value

/// Path resolution: relative paths join root, absolute paths resolve as-is.
/// Access is governed by operating system permissions rather than workspace root restrictions.
let private resolveInside (root: string) (path: string) : Result<string, FsFailure> =
    let full =
        if System.String.IsNullOrEmpty path then pathResolve root
        elif pathIsAbsolute path then pathResolve path
        else pathResolve (pathJoin root path)

    Ok full

let private readPathResolutionFailure path (error: obj) =
    if string (error?code: obj) = "ENOENT" then
        failure "FILE_NOT_FOUND" ("target file does not exist: " + path)
    else
        failure "FILE_READ_FAILED" ("file read failed: " + path)

let private resolveReadPath path =
    try
        Ok(realpathSync path)
    with error ->
        Error(readPathResolutionFailure path error)

let private ensureRealPathInside (_root: string) (_callerPath: string) (full: string) =
    if Wanxiangli.Fs.MutationFs.existsPath full then
        resolveReadPath full |> Result.map ignore
    else
        Ok()


let private rgFailure detail = failure "RG_FAILED" detail
let private argumentFailure detail = failure "INVALID_ARGUMENT" detail

[<Emit("Array.isArray($0)")>]
let private isStringArray (_value: obj) : bool = jsNative

[<Emit("$0.length")>]
let private jsLength (_value: obj) : int = jsNative

[<Emit("$0[$1]")>]
let private jsItem (_value: obj) (_index: int) : obj = jsNative

[<Emit("JSON.parse($0)")>]
let private parseJson (_text: string) : obj = jsNative

let private optionValue (args: string array) (index: int) =
    if index + 1 < args.Length && not (args[index + 1].StartsWith "-") then
        Some args[index + 1]
    else
        None

let private pathOperand (token: string) =
    if System.String.IsNullOrEmpty token || token = "-" || token.StartsWith "-" then
        None
    else
        Some token

let private recordPatternFileOption (token: string) (value: string) (found: ResizeArray<string>) =
    if token = "-f" || token = "--file" then
        found.Add value

let private consumePatternOption
    (args: string array)
    (index: int)
    (token: string)
    (patterns: int ref)
    (found: ResizeArray<string>)
    =
    match optionValue args index with
    | Some value ->
        recordPatternFileOption token value found
        patterns.Value <- patterns.Value + 1
        index + 2
    | None -> index + 1

let private consumePositional (filesOnly: bool) (patterns: int ref) (token: string) (found: ResizeArray<string>) =
    if not filesOnly && patterns.Value = 0 then
        patterns.Value <- 1
    else
        found.Add token

let private consumeArgument
    (args: string array)
    (index: int)
    (patterns: int ref)
    (filesOnly: bool ref)
    (found: ResizeArray<string>)
    : int =
    let token = args[index]

    if token = "--" then
        args[(index + 1) ..] |> Array.choose pathOperand |> found.AddRange
        args.Length
    elif token = "--files" then
        filesOnly.Value <- true
        index + 1
    elif token = "-e" || token = "--regexp" || token = "-f" || token = "--file" then
        consumePatternOption args index token patterns found
    elif token.StartsWith "--file=" then
        found.Add(token.Substring("--file=".Length))
        patterns.Value <- patterns.Value + 1
        index + 1
    elif
        token.StartsWith "--glob="
        || token.StartsWith "--iglob="
        || token.StartsWith "-g="
    then
        index + 1
    elif token = "--glob" || token = "--iglob" || token = "-g" then
        index + 2
    elif token.StartsWith "--regexp=" then
        patterns.Value <- patterns.Value + 1
        index + 1
    elif token.StartsWith "--ignore-file=" then
        found.Add(token.Substring("--ignore-file=".Length))
        index + 1
    elif token = "--ignore-file" then
        optionValue args index |> Option.iter found.Add
        index + 2
    elif
        token.StartsWith "--pre="
        || token.StartsWith "--hostname-bin="
        || token.StartsWith "--hyperlink-format="
    then
        index + 1
    elif token = "--pre" || token = "--hostname-bin" || token = "--hyperlink-format" then
        index + 2
    elif token.StartsWith "-" then
        index + 1
    else
        consumePositional filesOnly.Value patterns token found
        index + 1

/// Positional paths plus path-bearing options. Pattern files and search
/// roots must stay inside the workspace; nothing else is interpreted.
let private pathArguments (args: string array) =
    let found = ResizeArray<string>()
    // DSL-MUTABLE: algorithm-scratch — loop index cursor
    let mutable index = 0
    // DSL-MUTABLE: algorithm-scratch — pattern argument counter
    let patterns = ref 0
    // DSL-MUTABLE: algorithm-scratch — files-only flag
    let filesOnly = ref false

    while index < args.Length do
        index <- consumeArgument args index patterns filesOnly found

    if found.Count = 0 then
        found.Add "."

    List.ofSeq found

let private boundedPath (root: string) (path: string) =
    resolveInside root path |> Result.bind (ensureRealPathInside root path)

/// `rg(argv)` is `rg --json <argv>` with the argv passed through. The
/// program receives one JSON object, never the JSONL text.
[<Emit("""
(function (spawn, file, args, cwd, maxBuffer) {
  return new Promise(function (resolve, reject) {
let settled = false;
const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
const fail = (error) => { if (!settled) { settled = true; reject(error); } };
let child;
try {
  child = spawn(file, args, { cwd: cwd, stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  finish({ status: null, stdout: "", stderr: "", error: { message: String((error && error.message) || error) } });
  return;
}
const outChunks = [];
const errChunks = [];
let outBytes = 0;
let errBytes = 0;
let overflow = false;
const take = (chunks, which) => (chunk) => {
  const size = chunk && typeof chunk.length === "number" ? chunk.length : 0;
  if (which === "out") outBytes += size; else errBytes += size;
  chunks.push(chunk);
  if (!overflow && (outBytes > maxBuffer || errBytes > maxBuffer)) {
    overflow = true;
    child.kill();
  }
};
if (child.stdout) child.stdout.on("data", take(outChunks, "out"));
if (child.stderr) child.stderr.on("data", take(errChunks, "err"));
const text = (chunks) => (chunks.length === 0 ? "" : Buffer.concat(chunks).toString("utf8"));
child.on("error", (error) => {
  if (overflow) {
    fail(Object.assign(new Error("rg output exceeded " + maxBuffer + " bytes"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
    return;
  }
  finish({ status: null, stdout: "", stderr: "", error: { message: String((error && error.message) || error) } });
});
child.on("close", (code) => {
  if (overflow) {
    fail(Object.assign(new Error("rg output exceeded " + maxBuffer + " bytes"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
    return;
  }
  finish({ status: code, stdout: text(outChunks), stderr: text(errChunks), error: null });
});
  });
})($0, $1, $2, $3, $4)
""")>]
let private spawnRgAsync
    (_spawn: obj)
    (_file: string)
    (_args: string array)
    (_cwd: string)
    (_maxBuffer: int)
    : Task<obj> =
    jsNative

let private rgMissingStatusDetail (outcome: obj) : string =
    if isNull (outcome?error: obj) then
        "rg produced no exit code"
    else
        string ((outcome?error: obj)?message: obj)

let private rgExitFailureDetail (stdout: string) (stderr: string) =
    if System.String.IsNullOrWhiteSpace stderr then
        stdout
    else
        stderr

let private splitRgPaths (args: string array) (stdout: string) : string array =
    if Array.exists (fun token -> token = "-0" || token = "--null") args then
        stdout.Split('\000', System.StringSplitOptions.RemoveEmptyEntries)
    else
        stdout.Split('\n', System.StringSplitOptions.RemoveEmptyEntries)

let private tryParseJsonLine (line: string) : Result<obj, string> =
    try
        Ok(parseJson line)
    with error ->
        Error(string (error?message: obj))

let private renderRgJsonOutcome (exitCode: int) (stdout: string) : obj =
    let parsed =
        stdout.Split('\n', System.StringSplitOptions.RemoveEmptyEntries)
        |> Array.map tryParseJsonLine

    match parsed |> Array.tryFind _.IsError with
    | Some(Error detail) -> failureObj (rgFailure detail)
    | _ ->
        let messages = parsed |> Array.map (fun item -> item |> Result.defaultValue null)
        createObj [ "ok" ==> true; "exitCode" ==> exitCode; "messages" ==> messages ]

let private renderRgOutcome (summary: bool) (args: string array) (outcome: obj) : obj =
    if isNull (outcome?status: obj) then
        failureObj (rgFailure (rgMissingStatusDetail outcome))
    elif int outcome?status <> 0 && int outcome?status <> 1 then
        let stdout = string (outcome?stdout: obj)
        let stderr = string (outcome?stderr: obj)
        failureObj (rgFailure (rgExitFailureDetail stdout stderr))
    elif summary then
        let exitCode = int outcome?status
        let stdout = string (outcome?stdout: obj)
        createObj [ "ok" ==> true; "exitCode" ==> exitCode; "paths" ==> splitRgPaths args stdout ]
    else
        let exitCode = int outcome?status
        let stdout = string (outcome?stdout: obj)
        renderRgJsonOutcome exitCode stdout

let private isRgSummary (args: string array) : bool =
    args
    |> Array.exists (fun token ->
        token = "--files"
        || token = "--files-with-matches"
        || token = "-l"
        || token = "--files-without-match"
        || token = "--count"
        || token = "-c"
        || token = "--count-matches"
        || token = "--quiet"
        || token = "-q"
        || token = "--vimgrep"
        || token = "--type-list")

let private executeRg (root: string) (args: string array) : Task<obj> =
    task {
        let rejected =
            pathArguments args
            |> List.tryPick (fun path ->
                match boundedPath root path with
                | Error failure -> Some failure
                | Ok() -> None)

        match rejected with
        | Some failure -> return failureObj failure
        | None ->
            let summary = isRgSummary args
            let invocation = if summary then args else Array.append [| "--json" |] args
            let! outcome = spawnRgAsync spawnProcess "rg" invocation root 16777216
            return renderRgOutcome summary args outcome
    }

let private makeRgMember (root: string) =
    "rg"
    ==> fun (argv: obj) ->
        if not (isStringArray argv) then
            Task.FromResult(failureObj (argumentFailure "rg requires one string array argv"))
        else
            let args = Array.init (jsLength argv) (fun index -> string (jsItem argv index))
            executeRg root args

/// Advance past one match: a missing match parks past the end so the loop
/// exits; an in-range match is recorded before advancing past the needle.
let private advanceWhereMatch
    (spans: ResizeArray<int * int>)
    (needle: string)
    (fromIndex: int)
    (contentLength: int)
    (found: int)
    : int =
    match found < 0, found >= fromIndex with
    | true, _ -> contentLength + 1
    | false, true ->
        spans.Add(found, found + needle.Length)
        found + max 1 needle.Length
    | false, false -> found + max 1 needle.Length

let private whereSpans (content: string) (needle: string) (fromIndex: int) =
    // 字面匹配：needle 与 content 原样 IndexOf，不折叠空白、不 trim。
    let spans = ResizeArray<int * int>()
    let mutable cursor = max 0 fromIndex

    while needle.Length > 0 && cursor <= content.Length - needle.Length do
        let found = content.IndexOf(needle, cursor)
        cursor <- advanceWhereMatch spans needle fromIndex content.Length found

    List.ofSeq spans

let private computeRowCell (aChar: char) (bChar: char) (leftDist: int) (aboveDist: int) (diagDist: int) =
    let substitution = if aChar = bChar then 0 else 1
    min (min (leftDist + 1) (aboveDist + 1)) (diagDist + substitution)

let private computeDistanceRow (aChar: char) (b: string) (i: int) (previous: int[]) (current: int[]) =
    current[0] <- i

    for j in 1 .. b.Length do
        current[j] <- computeRowCell aChar b[j - 1] current[j - 1] previous[j] previous[j - 1]

    Array.blit current 0 previous 0 current.Length

let private editDistance (left: string) (right: string) =
    let a = if left.Length > 200 then left.Substring(0, 200) else left

    let b =
        if right.Length > 200 then
            right.Substring(0, 200)
        else
            right

    let previous = Array.init (b.Length + 1) id
    let current = Array.zeroCreate<int> (b.Length + 1)

    for i in 1 .. a.Length do
        computeDistanceRow a[i - 1] b i previous current

    previous[b.Length]

type private NearestCandidate =
    { Distance: int
      Start: int
      End: int
      Text: string }

let private considerBetterCandidate
    (currentBest: NearestCandidate)
    (distance: int)
    (start: int)
    (endOffset: int)
    (text: string)
    =
    if distance < currentBest.Distance then
        { Distance = distance
          Start = start
          End = endOffset
          Text = text }
    else
        currentBest

let private scanLineCandidate (target: string) (offset: int) (line: string) (scanned: int) (best: NearestCandidate) =
    if scanned >= 2000 || System.String.IsNullOrWhiteSpace line then
        scanned, best
    else
        let distance = editDistance line target
        scanned + 1, considerBetterCandidate best distance offset (offset + line.Length) line

let private scanNearestLine (content: string) (target: string) =
    let lines = content.Split('\n')
    // DSL-MUTABLE: algorithm-scratch — nearest-line scan state
    let mutable offset = 0
    let mutable scanned = 0

    // DSL-MUTABLE: algorithm-scratch — nearest candidate so far
    let mutable best =
        { Distance = System.Int32.MaxValue
          Start = 0
          End = 0
          Text = "" }

    for line in lines do
        let nextScanned, nextBest = scanLineCandidate target offset line scanned best
        scanned <- nextScanned
        best <- nextBest
        offset <- offset + line.Length + 1

    best

let private renderNearestMatch (best: NearestCandidate) : obj =
    if best.Distance = System.Int32.MaxValue then
        null
    else
        createObj
            [ "span" ==> jsSpan best.Start best.End
              "text" ==> best.Text
              "distance" ==> best.Distance ]

/// Diagnostic for a zero-match where: the closest single line, bounded to
/// the first 2000 non-empty lines so a huge file cannot dominate cost.
let private nearestLine (content: string) (needle: string) =
    if needle.Length = 0 then
        null
    else
        renderNearestMatch (scanNearestLine content needle)

/// Shared suspension path: park(payload) and where ambiguity both fire
/// the same signal and await the same deferred promise.
let private candidateObjects (content: string) (spans: (int * int) list) =
    spans
    |> List.truncate 8
    |> List.map (fun (beginIndex, endIndex) ->
        let contextStart = max 0 (beginIndex - 80)
        let contextEnd = min content.Length (endIndex + 80)

        createObj
            [ "span" ==> jsSpan beginIndex endIndex
              "context" ==> content.Substring(contextStart, contextEnd - contextStart) ])
    |> Array.ofList

let private resolveStartIndex (fromIndex: obj) =
    if isUndefined fromIndex then
        0
    else
        max 0 (int (unbox<float> fromIndex))

let private whereNearestDiagnostic (content: string) (needle: string) (spans: (int * int) list) : obj =
    if List.isEmpty spans then
        nearestLine content needle
    else
        null

let private dispatchWhereOutcome (needle: string) (content: string) (spans: (int * int) list) =
    match spans with
    | [ beginIndex, endIndex ] -> createObj [ "ok" ==> true; "span" ==> jsSpan beginIndex endIndex ]
    | _ ->
        createObj
            [ "__programPark"
              ==> createObj
                      [ "needle" ==> needle
                        "candidates" ==> candidateObjects content spans
                        "nearest" ==> whereNearestDiagnostic content needle spans ] ]

/// whereAll(content, needle, from?): every normalized match as [start, end].
let makeWhereAllMember () =
    "whereAll"
    ==> fun (content: string) (needle: string) (fromIndex: obj) ->
        if isNull content || isNull needle then
            failureObj (argumentFailure "whereAll requires string content and needle")
        else
            let start = resolveStartIndex fromIndex
            let spans = whereSpans content needle start

            createObj
                [ "ok" ==> true
                  "spans"
                  ==> (spans
                       |> List.map (fun (beginIndex, endIndex) -> jsSpan beginIndex endIndex)
                       |> Array.ofList) ]

/// where(content, needle, from?): exactly one match returns its span;
/// zero or many suspend the program through the same park channel as
/// park, with a diagnostic payload. The injected value is returned
/// verbatim (Unix responsibility: a wrong injection fails downstream).
let makeWhereMember () =
    "where"
    ==> fun (content: string) (needle: string) (fromIndex: obj) (_stack: obj) ->
        if isNull content || isNull needle then
            failureObj (argumentFailure "where requires string content and needle")
        else
            let start = resolveStartIndex fromIndex
            let spans = whereSpans content needle start
            dispatchWhereOutcome needle content spans

let RuntimeTools (root: string) : obj =
    createObj [ makeRgMember root; makeWhereAllMember (); makeWhereMember () ]
