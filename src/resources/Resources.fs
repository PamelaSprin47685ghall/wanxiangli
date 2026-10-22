namespace Wanxiangli.Resources

open System
open Fable.Core
open Fable.Core.JsInterop

/// Bilingual semantic resources anchored at a package root.
/// Resource root is resolved from the package's own absolute location
/// (import.meta.url walk to package.json); never from process.cwd().
/// A read touches only the selected language: the selected leaf missing
/// fails closed with no fallback to the other language. Whether every
/// declared language leaf is present and whether the language pair carries
/// the same placeholder set is a distribution property, checked by the
/// distribution check of this module, not by every runtime read.
[<AttachMembers>]
type Resources(?rootDir: string) =

    [<Import("readFileSync", "node:fs")>]
    static let readFileSync (path: string, encoding: string) : string = jsNative

    [<Import("existsSync", "node:fs")>]
    static let existsSync (path: string) : bool = jsNative

    [<Import("join", "node:path")>]
    static let pathJoin (a: string, b: string) : string = jsNative

    [<Import("dirname", "node:path")>]
    static let dirname (path: string) : string = jsNative

    [<Import("fileURLToPath", "node:url")>]
    static let fileURLToPath (url: string) : string = jsNative

    /// Fable 对值绑定的 Emit 不生效（生成 native 占位抛错），须以函数形态承载。
    [<Emit("import.meta.url")>]
    static let moduleUrl () : string = jsNative

    let packageRoot =
        match rootDir with
        | Some root -> root
        | None -> Resources.selfPackageRoot ()

    do
        if not (existsSync (pathJoin (packageRoot, "resources"))) then
            raise (
                InvalidOperationException(
                    sprintf "package resource root missing: %s" (pathJoin (packageRoot, "resources"))
                )
            )

    let resourcesRoot = pathJoin (packageRoot, "resources")

    let resolveResource (relativeResourcePath: string) : string =
        pathJoin (resourcesRoot, relativeResourcePath)

    let languageOf (raw: string) : ProviderLanguage = ProviderLanguage.parse raw

    let semanticLeaf (language: ProviderLanguage) (semanticPath: string) : string =
        let trimmed =
            if String.IsNullOrWhiteSpace semanticPath then
                ""
            else
                semanticPath.Trim().TrimStart('/').TrimStart('\\')

        let segments = trimmed.Split('/', '\\')

        if
            String.IsNullOrWhiteSpace trimmed
            || semanticPath.Contains ":"
            || semanticPath.StartsWith "/"
            || semanticPath.StartsWith "\\"
            || Array.contains ".." segments
        then
            raise (ArgumentException(sprintf "invalid provider semantic path: %s" semanticPath))
        else
            sprintf "provider/%s/%s" trimmed (ProviderLanguage.resourceFileName language)

    let readResource (relativeResourcePath: string) : string =
        let full = resolveResource relativeResourcePath

        if not (existsSync full) then
            raise (InvalidOperationException(sprintf "package resource missing: %s" full))

        readFileSync (full, "utf8")

    let substitutionsOf (value: obj) : Map<string, string> =
        if isNull value then
            Map.empty
        else
            let keys: string array = emitJsExpr value "Object.keys($0)"

            keys
            |> Array.toList
            |> List.map (fun key -> key, string (emitJsExpr (value, key) "$0[$1]"))
            |> Map.ofList

    /// True when `resources/<relativeResourcePath>` exists (file or directory).
    member _.resourceExists(relativeResourcePath: string) : bool =
        existsSync (resolveResource relativeResourcePath)

    /// Walk up from `startDirectory` to the nearest package.json.
    /// Terminates with "package root not found" when the filesystem stops
    /// yielding a different parent.
    static member packageRootFrom(startDirectory: string) : string =
        let rec walk (dir: string) : string =
            if isNull dir then
                raise (InvalidOperationException "package root not found")
            elif existsSync (pathJoin (dir, "package.json")) then
                dir
            else
                let parent = dirname dir

                if parent = dir then
                    raise (InvalidOperationException "package root not found")
                else
                    walk parent

        walk startDirectory

    /// Walk up from this module's directory to the nearest package.json.
    static member private selfPackageRoot () : string =
        Resources.packageRootFrom (dirname (fileURLToPath (moduleUrl ())))

    /// `provider/<semanticPath>/{en.md|zh-CN.md}` relative to the resource root.
    member _.relativePath(languageRaw: string, semanticPath: string) : string =
        semanticLeaf (languageOf languageRaw) semanticPath

    member _.exists(languageRaw: string, semanticPath: string) : bool =
        existsSync (resolveResource (semanticLeaf (languageOf languageRaw) semanticPath))

    /// Read the selected language of a semantic path. Only the selected
    /// leaf is validated: a missing counterpart does not affect this read,
    /// and a missing selected leaf fails closed with no fallback.
    member this.readText(languageRaw: string, semanticPath: string) : string =
        let language = languageOf languageRaw
        (readResource (semanticLeaf language semanticPath)).Trim()

    /// Load the selected language's template and substitute on it. Missing
    /// substitution keys and leftover placeholders fail closed.
    member this.render(languageRaw: string, semanticPath: string, substitutions: obj) : string =
        let language = languageOf languageRaw
        let template = readResource (semanticLeaf language semanticPath)

        // 与 readText 一致：主仓旧链路 readText 先 Trim 再替换，
        // 渲染结果不得携带资源尾换行（嵌入 JS 字符串字面量会断行）。
        ProseTemplate.substitute template (substitutionsOf substitutions) |> fun text -> text.Trim()

    /// Substitute `{{name}}` on a raw template with no resource involvement.
    /// Missing keys and leftover placeholders fail closed.
    member _.renderTemplate(template: string, substitutions: obj) : string =
        ProseTemplate.substitute template (substitutionsOf substitutions)

    member _.tryParseLanguage(raw: string) : obj =
        match ProviderLanguage.tryParse raw with
        | Some language -> box (ProviderLanguage.externalName language)
        | None -> null

    member _.parseLanguage(raw: string) : string =
        ProviderLanguage.parse raw |> ProviderLanguage.externalName

    /// Preference ladder: explicit env → host config → locale detection →
    /// English. An invalid explicit preference is an error, never a silent
    /// fallback (HOST-026).
    member _.resolvePreference
        (explicitPreference: obj, hostConfig: obj, vscodeNls: obj, posixLocale: obj, intlLocale: obj)
        : obj =
        let observation (value: obj) =
            if isNull value then None else Some(string value)

        match
            ProviderLanguage.fromObservationLadder
                (observation explicitPreference)
                (observation hostConfig)
                (observation vscodeNls)
                (observation posixLocale)
                (observation intlLocale)
        with
        | Ok language ->
            box {| ok = true; value = ProviderLanguage.externalName language; error = "" |}
        | Error error -> box {| ok = false; value = ""; error = error |}

    /// Re-resolve the process-wide global language preference (HOST-026).
    member _.refreshGlobalLanguage(resolve: unit -> string) : unit =
        GlobalProviderLanguage.refresh (fun () -> ProviderLanguage.parse (resolve ()))

    /// The live global preference as an external name string.
    member _.currentGlobalLanguage() : string =
        GlobalProviderLanguage.current () |> ProviderLanguage.externalName
