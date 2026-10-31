namespace Wanxiangli.LlmText

open System
open System.Text

[<RequireQualifiedAccess>]
module SyntheticToml =

    let normalizeNewlines (text: string) =
        if isNull text then
            ""
        else
            text.Replace("\r\n", "\n").Replace("\r", "\n")

    let private appendEscaped (sb: StringBuilder) (ch: char) =
        match ch with
        | '"' -> sb.Append "\\\"" |> ignore
        | '\\' -> sb.Append "\\\\" |> ignore
        | '\b' -> sb.Append "\\b" |> ignore
        | '\t' -> sb.Append "\\t" |> ignore
        | '\n' -> sb.Append "\\n" |> ignore
        | '\f' -> sb.Append "\\f" |> ignore
        | '\r' -> sb.Append "\\r" |> ignore
        | c when c < ' ' || c = '\u007F' -> sb.Append(sprintf "\\u%04X" (int c)) |> ignore
        | c -> sb.Append c |> ignore

    let private escapeBasic (text: string) =
        let sb = StringBuilder()

        for ch in text do
            appendEscaped sb ch

        sb.ToString()

    let private advanceLiteralSafety (c: char) (quoteRun: int) =
        if c = '\'' then
            let nextRun = quoteRun + 1
            nextRun, nextRun < 3
        elif c <> '\n' && c <> '\t' && Char.IsControl c then
            0, false
        else
            0, true

    let private literalSafeRange (text: string) (origin: int) (stop: int) =
        let mutable index = origin
        let mutable quoteRun = 0
        let mutable safe = true

        while safe && index < stop do
            let nextRun, stillSafe = advanceLiteralSafety text[index] quoteRun
            quoteRun <- nextRun
            safe <- stillSafe
            index <- index + 1

        safe

    let private literalSafe (text: string) = literalSafeRange text 0 text.Length

    let private appendMultilineCharacter (sb: StringBuilder) (ch: char) =
        if ch = '\n' then
            sb.Append '\n' |> ignore
        else
            appendEscaped sb ch

    let private escapeMultiline (text: string) =
        let sb = StringBuilder()

        for ch in text do
            appendMultilineCharacter sb ch

        sb.ToString()

    let renderString (raw: string) : string =
        let text = if isNull raw then "" else raw

        if text.EndsWith "\n" && literalSafe text then
            "'''\n" + text + "'''"
        elif text.Contains "\n" then
            let ending = if text.EndsWith "\n" then "" else "\\\n"
            "\"\"\"\n" + escapeMultiline text + ending + "\"\"\""
        else
            "\"" + escapeBasic text + "\""

    let comment (text: string) : string =
        normalizeNewlines text
        |> fun normalized -> normalized.Split '\n'
        |> Array.map (fun line -> if line = "" then "#" else "# " + line)
        |> String.concat "\n"

    let field (name: string) (renderedValue: string) : string = name + " = " + renderedValue

    let tableEntry (name: string) (fields: string list) : string =
        String.concat "\n" (("[" + name + "]") :: fields)

    let tableArrayEntry (name: string) (fields: string list) : string =
        String.concat "\n" (("[[" + name + "]]") :: fields)

    let renderBool (value: bool) = if value then "true" else "false"

    let renderInt (value: int64) = string value

    let renderFloat (value: float) =
        let text = string value

        if text.IndexOf '.' >= 0 || text.IndexOf 'e' >= 0 || text.IndexOf 'E' >= 0 then
            text
        else
            text + ".0"

    let private isBareKey (name: string) =
        name.Length > 0
        && name
           |> Seq.forall (fun c ->
               (c >= 'A' && c <= 'Z')
               || (c >= 'a' && c <= 'z')
               || (c >= '0' && c <= '9')
               || c = '_'
               || c = '-')

    let renderKey (name: string) =
        if isBareKey name then
            name
        else
            "\"" + escapeBasic name + "\""

    let private isTableBlock (block: string) =
        let firstLine = (block.Split '\n')[0]
        firstLine.StartsWith "[" && firstLine.EndsWith "]"

    let document (instructions: string list) (body: string list) : string =
        let header = instructions |> List.map comment
        let blocks = body |> List.filter (fun block -> block <> "")
        let bare, tables = blocks |> List.partition (isTableBlock >> not)
        let ordered = bare @ tables

        match header, ordered with
        | [], [] -> ""
        | _, [] -> String.concat "\n" header + "\n"
        | [], _ -> String.concat "\n" ordered + "\n"
        | _, _ -> String.concat "\n" header + "\n\n" + String.concat "\n" ordered + "\n"

    let private isUtf16LowSurrogate (code: int) = code >= 0xDC00 && code <= 0xDFFF

    let private utf8Step (text: string) (index: int) (stop: int) =
        let code = int text[index]

        if code < 0x80 then
            1, 1
        elif code < 0x800 then
            2, 1
        elif
            code >= 0xD800
            && code <= 0xDBFF
            && index + 1 < stop
            && isUtf16LowSurrogate (int text[index + 1])
        then
            4, 2
        else
            3, 1

    let private byteCountRange (text: string) (origin: int) (stop: int) : int =
        let mutable total = 0
        let mutable index = origin

        while index < stop do
            let width, advance = utf8Step text index stop
            total <- total + width
            index <- index + advance

        total

    let byteCount (text: string) : int =
        if isNull text then 0 else byteCountRange text 0 text.Length
