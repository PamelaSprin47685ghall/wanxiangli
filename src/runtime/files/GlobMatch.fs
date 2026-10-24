namespace Wanxiangli.Fs

open Wanxiangli.Fs.Native

/// wildmatch / gitignore 路径匹配内核：`*` 不跨 `/`，`**` 匹配零段或多段
/// 目录，`?` 单字符，`[...]` 字符类；无 `/` 的模式视为任意深度。
/// 供文件枚举与需求发现（APPLIES-TO）共用。
module GlobMatch =

    type GlobPatternError = | InvalidPattern

    let testCompiled (regex: obj) (text: string) : bool = regexTest regex text

    let private wildmatchRegex (pattern: string) : Result<obj, GlobPatternError> =
        let rec convert (chars: char list) (acc: string) : Result<string, GlobPatternError> =
            match chars with
            | [] -> Ok acc
            | '*' :: '*' :: '/' :: rest -> convert rest (acc + "(?:.*/)?")
            | '*' :: '*' :: rest -> convert rest (acc + ".*")
            | '*' :: rest -> convert rest (acc + "[^/]*")
            | '?' :: rest -> convert rest (acc + "[^/]")
            | '[' :: rest -> takeClass rest "" 0 acc
            | c :: rest -> convert rest (acc + System.Text.RegularExpressions.Regex.Escape(string c))

        and takeClass (xs: char list) (buf: string) (count: int) (acc: string) : Result<string, GlobPatternError> =
            match xs with
            | [] -> Error InvalidPattern
            | ']' :: more when count > 0 -> convert more (acc + "[" + buf + "]")
            | '!' :: more when count = 0 -> takeClass more "^" 1 acc
            | c :: more ->
                let piece = if c = '\\' then "\\\\" else string c
                takeClass more (buf + piece) (count + 1) acc

        if System.String.IsNullOrEmpty pattern then
            Error InvalidPattern
        else
            convert (List.ofSeq pattern) "^"
            |> Result.map (fun body -> regexExact (body + "$"))

    let compilePattern (pattern: string) : Result<obj, GlobPatternError> =
        let leading = pattern.StartsWith("/")
        let rest = if leading then pattern.Substring(1) else pattern

        if System.String.IsNullOrEmpty rest then
            Error InvalidPattern
        else
            let body =
                if leading then rest
                elif rest.Contains("/") then rest
                else "**/" + rest

            wildmatchRegex body

    let matchesPathPattern (pattern: string) (path: string) : Result<bool, GlobPatternError> =
        compilePattern pattern |> Result.map (fun regex -> testCompiled regex path)
