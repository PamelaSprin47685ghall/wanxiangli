module Wanxiangli.CasebookAccess.CasebookAccessLaw

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("typeof $0 === 'number' || typeof $0 === 'boolean' || typeof $0 === 'bigint'")>]
let private isScalar (value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBoolean (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isPlainObject (value: obj) : bool = jsNative

[<Emit("$0 == null")>]
let private isAbsent (value: obj) : bool = jsNative

[<Emit("String($0)")>]
let private scalarText (value: obj) : string = jsNative

[<Emit("$0[$1]")>]
let private field (item: obj) (name: string) : obj = jsNative

/// 与主仓 String.IsNullOrWhiteSpace（Fable：/^\s*$/）同一判定。
[<Emit("/^\\s*$/.test($0)")>]
let private isBlank (text: string) : bool = jsNative

[<Emit("($0 < $1 ? -1 : $0 > $1 ? 1 : 0)")>]
let private compareText (left: string) (right: string) : int = jsNative

[<Emit("[...$0].sort($1)")>]
let private sorted (items: string array) (comparer: string -> string -> int) : string array = jsNative

let private requireText (name: string) (value: obj) : string =
    if isString value then unbox<string> value
    else raise (System.ArgumentException(name + " must be a string"))

let private requireBool (name: string) (value: obj) : bool =
    if isBoolean value then unbox<bool> value
    else raise (System.ArgumentException(name + " must be a boolean"))

/// 工具参数里的路径值：字符串原样；数字/布尔按 String 转写；对象、数组、缺失都不是路径。
let private argText (value: obj) : string option =
    if isString value then Some(unbox<string> value)
    elif isScalar value then Some(scalarText value)
    else None

let private present (paths: string list) = paths |> List.filter (isBlank >> not)

/// 去掉空白路径、去重，按码元序升序。
let private normalize (paths: string seq) : string array =
    sorted (paths |> Seq.filter (isBlank >> not) |> Seq.distinct |> Seq.toArray) compareText

// ---- 执行器读取容忍（§63）：cat/head/tail/sed 单文件读取 ----------------------

/// 按空格/制表符切分，单引号成对切换引用（尽力而为的类型化解析，不是转录推断）。
let private tokenize (command: string) : string list =
    let rec go (chars: char list) (current: string) (inQuote: bool) (acc: string list) : string list =
        match chars with
        | [] -> List.rev (if current = "" then acc else current :: acc)
        | ''' :: rest -> go rest current (not inQuote) acc
        | c :: rest when (c = ' ' || c = '\t') && not inQuote -> go rest "" false (if current = "" then acc else current :: acc)
        | c :: rest -> go rest (current + string c) inQuote acc
    go (List.ofSeq command) "" false []

/// cat 的选项都是开关（`cat -n f` 的 -n 是编号）；head/tail 的 -n、-c 带一个值（`tail -n +5 f`、`head -c 100 f`），值不是文件。
let rec private firstReadFile (valued: bool) (tokens: string list) : string option =
    match tokens with
    | [] -> None
    | ("-n" | "-c") :: _value :: tail when valued -> firstReadFile valued tail
    | token :: tail when token.StartsWith "-" -> firstReadFile valued tail
    | file :: _ -> Some file

let private sedReadFile (rest: string list) =
    match rest |> List.skipWhile (fun token -> token.StartsWith "-") with
    | _script :: file :: _ -> Some file
    | _ -> None

let private execReadOf (command: string) : string option =
    if isBlank command then None
    // 命令替换（`$(...)` 或反引号）的读取目标不可静态得知，整条不计。
    elif command.Contains "$(" || command.Contains "`" then None
    else
        match tokenize command with
        | "cat" :: rest -> firstReadFile false rest
        | "head" :: rest | "tail" :: rest -> firstReadFile true rest
        | "sed" :: rest -> sedReadFile rest
        | _ -> None

let private pathArgOf (args: obj) : string option =
    if not (isPlainObject args) then None
    else
        // 第一个出现的键决定路径（与主仓一致）；它的值不是文本时就没有路径，不再看后面的键。
        [ "path"; "filePath"; "file" ]
        |> List.tryFind (fun key -> not (isAbsent (field args key)))
        |> Option.bind (fun key -> argText (field args key))

/// Casebook 实质访问的纯分类（knowledge-reuse-003/010）。不读文件、不持有会话状态、不写事件；
/// 每会话的累积器与 Observation 构造归调用方。
[<AttachMembers>]
type CasebookAccessLaw() =
    /// 一次已发生的访问 → 计入 relatedPaths 的路径。
    /// kind：read / create / edit / delete（path）；move（source、destination 两端）；
    /// mutation（path + committed：只有已提交才计入）；grep / glob / list / stat / mention 不构成实质访问。空白路径不计。
    member _.accessPaths(access: obj) : string array =
        if not (isPlainObject access) then raise (System.ArgumentException "access must be an object")
        let path () = requireText "path" (field access "path")
        match requireText "kind" (field access "kind") with
        | "read" | "create" | "edit" | "delete" -> present [ path () ] |> List.toArray
        | "move" -> present [ requireText "source" (field access "source"); requireText "destination" (field access "destination") ] |> List.toArray
        | "mutation" -> if requireBool "committed" (field access "committed") then present [ path () ] |> List.toArray else [||]
        | "grep" | "glob" | "list" | "stat" | "mention" -> [||]
        | kind -> raise (System.ArgumentException("unknown access kind " + kind))

    /// 工具执行结果 → 路径：create / rewrite / delete 取参数 path|filePath|file（首个非空者），move 取 source 与 destination（两者都在才计）；
    /// 未提交（committed=false）一律不计；其它工具名不构成实质访问。
    member _.toolPaths(toolName: obj, args: obj, committed: obj) : string array =
        let name = requireText "toolName" toolName
        let committed = requireBool "committed" committed
        if not committed then [||]
        else
            match name with
            | "create" | "rewrite" | "delete" -> pathArgOf args |> Option.toList |> present |> List.toArray
            | "move" when isPlainObject args ->
                match argText (field args "source"), argText (field args "destination") with
                | Some source, Some destination -> present [ source; destination ] |> List.toArray
                | _ -> [||]
            | _ -> [||]

    /// 仅 create / rewrite 是“实质性”工具名（创建/改写内容）。
    member _.isSubstantiveTool(toolName: obj) : bool =
        match requireText "toolName" toolName with
        | "create" | "rewrite" -> true
        | _ -> false

    /// relatedPaths 的规范形：去空白、去重、码元序升序。Fission 各 lane 与裂变前访问取并集同样用它。
    member _.relatedPaths(paths: obj) : string array =
        if not (isArray paths) then raise (System.ArgumentException "paths must be an array")
        normalize (unbox<obj array> paths |> Array.map (requireText "path"))

    /// 执行器命令里的单文件读取（cat / head / tail / sed，可带选项前缀；`cat f | grep x` 仍算读 f）；
    /// 含命令替换或不是读取命令时为 null。
    member _.execRead(command: obj) : string =
        execReadOf (requireText "command" command) |> Option.toObj
