module Wanxiangli.Grounding.Catalog

open System
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Grounding.Wire

[<Import("existsSync", "node:fs")>]
let private existsSync (path: string) : bool = jsNative

[<Import("readFileSync", "node:fs")>]
let private readFileSync (path: string, encoding: string) : string = jsNative

[<Import("readdirSync", "node:fs")>]
let private readdirSync (path: string) : string array = jsNative

[<Import("statSync", "node:fs")>]
let private statSync (path: string) : obj = jsNative

[<Import("lstatSync", "node:fs")>]
let private lstatSync (path: string) : obj = jsNative

[<Import("realpathSync", "node:fs")>]
let private realpathSync (path: string) : string = jsNative

[<Import("join", "node:path")>]
let private pathJoin (a: string, b: string) : string = jsNative

[<Import("relative", "node:path")>]
let private pathRelative (fromPath: string, toPath: string) : string = jsNative

[<Import("dirname", "node:path")>]
let private pathDirectory (path: string) : string = jsNative

[<Import("basename", "node:path")>]
let private pathName (path: string) : string = jsNative

[<Import("resolve", "node:path")>]
let private pathResolve (path: string) : string = jsNative

[<Import("isAbsolute", "node:path")>]
let private pathIsAbsolute (path: string) : bool = jsNative

[<Emit("$0.isDirectory()")>]
let private isDirectory (stat: obj) : bool = jsNative

[<Emit("$0.isFile()")>]
let private isFile (stat: obj) : bool = jsNative

let private slash (value: string) = value.Replace('\\', '/')

let canonicalWorkspace (workspace: string) =
    let resolved = pathResolve workspace

    try
        realpathSync resolved
    with _ ->
        resolved

let private absolutePath root path =
    if pathIsAbsolute path then
        pathResolve path
    else
        pathResolve (pathJoin (root, path))

let private relativeWithin root absolute =
    let relative = pathRelative (root, absolute) |> slash

    if relative = "" then
        Some ""
    elif
        relative = ".."
        || relative.StartsWith("../", StringComparison.Ordinal)
        || pathIsAbsolute relative
    then
        None
    else
        Some relative

let private missingEntry path =
    try
        lstatSync path |> ignore
        false
    with error ->
        emitJsExpr error "$0.code === 'ENOENT'"

let rec private canonicalMissingTarget path =
    let parent = pathDirectory path

    if parent = path || not (missingEntry path) then
        None
    else
        canonicalTarget parent
        |> Option.map (fun resolved -> pathJoin (resolved, pathName path))

and private canonicalTarget path =
    try
        Some(realpathSync path)
    with _ ->
        canonicalMissingTarget path

let private workspaceRelative workspace canonicalRoot path =
    absolutePath (pathResolve workspace) path
    |> canonicalTarget
    |> Option.bind (relativeWithin canonicalRoot)

let workspaceRelativePath workspace path =
    let root = pathResolve workspace
    let absolute = absolutePath root path

    match relativeWithin (canonicalWorkspace workspace) absolute with
    | Some relative -> Some relative
    | None -> relativeWithin root absolute

let private matches pattern path = matchesPathPattern pattern path

let private ruleBody (raw: string) =
    let line = raw.Trim()

    if line = "" || line.StartsWith("#", StringComparison.Ordinal) then
        None
    else
        let includeRule = not (line.StartsWith("!", StringComparison.Ordinal))
        let pattern = if includeRule then line else line.Substring 1
        Some(includeRule, pattern)

let private validateRule packageName includeRule pattern =
    let selfProbe = "requirements/" + packageName + "/WHAT.md"

    if String.IsNullOrWhiteSpace pattern then
        None
    elif matches pattern selfProbe then
        failwith ("APPLIES-TO must not declare package self coverage: " + packageName)
    else
        Some(includeRule, pattern)

let private parseRule (packageName: string) (raw: string) =
    ruleBody raw
    |> Option.bind (fun (includeRule, pattern) -> validateRule packageName includeRule pattern)

let private directoryExists path =
    try
        isDirectory (statSync path)
    with _ ->
        false

let private fileExists path =
    try
        isFile (statSync path)
    with _ ->
        false

let private loadRules packageName packageRoot =
    let path = pathJoin (packageRoot, "APPLIES-TO")

    if not (existsSync path) then
        []
    else
        let text = readFileSync (path, "utf8")

        text.Split('\n') |> Array.toList |> List.choose (parseRule packageName)

let private tryPackage requirementsRoot name =
    let root = pathJoin (requirementsRoot, name)
    let what = pathJoin (root, "WHAT.md")

    if directoryExists root && fileExists what then
        Some(name, root, loadRules name root)
    else
        None

let private packageEntry (name: string, root: string, rules: (bool * string) list) =
    let ruleList =
        rules
        |> List.map (fun (includeRule, pattern) -> createObj [ "include" ==> includeRule; "pattern" ==> pattern ])
        |> List.toArray

    createObj [ "name" ==> name; "root" ==> root; "rules" ==> ruleList ]

let private discoverPackages (root: string) =
    let requirementsRoot = pathJoin (root, "requirements")

    if not (existsSync requirementsRoot) then
        []
    else
        readdirSync requirementsRoot
        |> Array.toList
        |> List.choose (tryPackage requirementsRoot)

/// 发现 requirements/ 下的规范包：直接子目录含 WHAT.md 即合法包，按包名升序。
let discover (workspace: string) : obj array =
    let root = canonicalWorkspace workspace
    let requirementsRoot = pathJoin (root, "requirements")

    if not (existsSync requirementsRoot) then
        [||]
    else
        readdirSync requirementsRoot
        |> Array.toList
        |> List.choose (tryPackage requirementsRoot)
        |> List.sortBy (fun (name, _, _) -> name)
        |> List.map packageEntry
        |> List.toArray

let private externalMatch (relativePath: string) (rules: (bool * string) list) =
    rules
    |> List.fold
        (fun included (includeRule, pattern) ->
            if matches pattern relativePath then
                includeRule
            else
                included)
        false

let private selfMatch (relativePath: string) (packageName: string) =
    let selfPrefix = "requirements/" + packageName + "/"

    relativePath = "requirements/" + packageName
    || relativePath.StartsWith(selfPrefix, StringComparison.Ordinal)

let private packageMatches (relativePath: string) (name: string, rules: (bool * string) list) =
    selfMatch relativePath name || externalMatch relativePath rules

/// 返回路径匹配的全部包名，按包名升序。
let resolve (workspace: string) (path: string) : obj array =
    let root = canonicalWorkspace workspace
    let packages = discoverPackages root

    match workspaceRelative workspace root path with
    | None -> [||]
    | Some relativePath ->
        packages
        |> List.filter (fun (name, _, rules) -> packageMatches relativePath (name, rules))
        |> List.map (fun (name, _, _) -> name)
        |> List.sort
        |> List.map box
        |> List.toArray

let private directMarkdownPaths packageRoot =
    readdirSync packageRoot
    |> Array.toList
    |> List.filter (fun name -> name.EndsWith(".md", StringComparison.Ordinal))
    |> List.filter (fun name ->
        let full = pathJoin (packageRoot, name)

        try
            isFile (statSync full)
        with _ ->
            false)
    |> List.sort

let private materializePaths (root: string) (name: string) (packageRoot: string) packageRelativePaths =
    let materials =
        packageRelativePaths
        |> List.map (fun packageRelative ->
            let full = pathJoin (packageRoot, packageRelative)

            let resultBytes = readFileSync (full, "utf8")
            let path = "requirements/" + name + "/" + slash packageRelative

            createObj [ "path" ==> path; "resultBytes" ==> resultBytes ])
        |> List.toArray

    let digestInput =
        materials
        |> Array.map (fun material ->
            unbox<string> (material?path) + "\u0000" + unbox<string> (material?resultBytes) + "\u0000")
        |> String.concat ""

    createObj
        [ "workspace" ==> root
          "packageName" ==> name
          "digest" ==> sha256Hex digestInput
          "materials" ==> materials ]

let private materializePackageMaterials (root: string) (name: string, packageRoot: string, _) =
    // 只注入包根目录直接存在的 *.md 规范正文；tests/ 与 APPLIES-TO 不进入上下文。
    directMarkdownPaths packageRoot |> materializePaths root name packageRoot

/// 物化一个包的规范快照；未知包名直接抛错。
let materialize (workspace: string) (packageName: string) : obj =
    let root = canonicalWorkspace workspace

    let package =
        discoverPackages root
        |> List.tryFind (fun (name, _, _) -> name = packageName)

    match package with
    | None -> failwith ("unknown requirement package: " + packageName)
    | Some found -> materializePackageMaterials root found

/// 按路径集合物化去重后的快照列表，按包名升序。
/// paths 为 JS 数组（Fable 的 F# list 与 JS 数组不互通）。
let snapshotsForPaths (workspace: string) (paths: string array) : obj array =
    let root = canonicalWorkspace workspace
    let packages = discoverPackages root

    paths
    |> Array.toList
    |> List.choose (workspaceRelative workspace root)
    |> List.collect (fun relativePath ->
        packages |> List.filter (fun (name, _, rules) -> packageMatches relativePath (name, rules)))
    |> List.groupBy (fun (name, _, _) -> name)
    |> List.sortBy fst
    |> List.map (fun (_, matches) -> materializePackageMaterials root (List.head matches))
    |> List.toArray
