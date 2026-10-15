namespace Wanxiangli.Resources

open System

/// Closed provider-facing language algebra (PROMPT-017 / HOST-026).
[<RequireQualifiedAccess>]
type ProviderLanguage =
    | English
    | SimplifiedChinese

[<RequireQualifiedAccess>]
module ProviderLanguage =

    let externalName language =
        match language with
        | ProviderLanguage.English -> "English"
        | ProviderLanguage.SimplifiedChinese -> "SimplifiedChinese"

    let label language =
        match language with
        | ProviderLanguage.English -> "en"
        | ProviderLanguage.SimplifiedChinese -> "zh-CN"

    let resourceDirectory language = label language

    /// Locale leaf filename under a semantic resource directory.
    let resourceFileName language =
        match language with
        | ProviderLanguage.English -> "en.md"
        | ProviderLanguage.SimplifiedChinese -> "zh-CN.md"

    let private parseNormalized (normalized: string) : ProviderLanguage option =
        match normalized with
        | "en"
        | "eng"
        | "english" -> Some ProviderLanguage.English
        | "zh-cn"
        | "zh"
        | "zh_cn"
        | "chs"
        | "chinese"
        | "simplifiedchinese"
        | "simplified-chinese"
        | "cn" -> Some ProviderLanguage.SimplifiedChinese
        | _ -> None

    let tryParse (raw: string) : ProviderLanguage option =
        if String.IsNullOrWhiteSpace raw then
            None
        else
            raw.Trim().ToLowerInvariant() |> parseNormalized

    let parse (raw: string) : ProviderLanguage =
        match tryParse raw with
        | Some language -> language
        | None -> raise (ArgumentException(sprintf "unrecognized ProviderLanguage: %s (PROMPT-017)" raw))

    let private configuredPreference (raw: string) : Result<ProviderLanguage, string> =
        match tryParse raw with
        | Some language -> Ok language
        | None -> Error(sprintf "WANXIANGSHU_PROVIDER_LANGUAGE unrecognized: %s (HOST-026)" raw)

    /// The sole policy for interpreting the raw provider-language preference.
    let fromPreferenceObservation (observation: string option) : Result<ProviderLanguage, string> =
        match observation with
        | None -> Ok ProviderLanguage.English
        | Some raw when String.IsNullOrWhiteSpace raw -> Ok ProviderLanguage.English
        | Some raw -> configuredPreference raw

    let private isChineseLocale (raw: string) : bool =
        if String.IsNullOrWhiteSpace raw then
            false
        else
            let lower = raw.ToLowerInvariant()

            lower.StartsWith "zh"
            || lower.Contains "zh-cn"
            || lower.Contains "zh_cn"
            || lower.Contains "zh-hans"
            || lower.Contains "chs"
            || lower.Contains "chinese"

    let private tryExplicitPreference (explicit: string option) (hostConfig: string option) =
        [ explicit; hostConfig ]
        |> List.tryPick (function
            | Some raw when not (String.IsNullOrWhiteSpace raw) -> Some raw
            | _ -> None)

    let private detectSystemLanguage (candidates: string option list) =
        candidates
        |> List.tryPick (function
            | Some raw when isChineseLocale raw -> Some ProviderLanguage.SimplifiedChinese
            | _ -> None)
        |> Option.defaultValue ProviderLanguage.English

    /// Resolves global preference through the normative preference ladder:
    /// 1. Explicit environment variable (WANXIANGSHU_PROVIDER_LANGUAGE)
    /// 2. Host config preference (opencode.json language)
    /// 3. IDE / System locale (VSCODE_NLS_CONFIG, POSIX LC_ALL/LANG, Node Intl)
    /// 4. Default fallback: ProviderLanguage.English
    let fromObservationLadder
        (explicit: string option)
        (hostConfig: string option)
        (vscodeNls: string option)
        (posixLocale: string option)
        (intlLocale: string option)
        : Result<ProviderLanguage, string> =
        match tryExplicitPreference explicit hostConfig with
        | Some raw -> configuredPreference raw
        | None -> Ok(detectSystemLanguage [ vscodeNls; posixLocale; intlLocale ])

    /// HOST-026: child / attached / InternalLeaf language = owner | commissioner.
    let inheritFrom (owner: ProviderLanguage) : ProviderLanguage = owner

/// HOST-026: the live global preference is the only language authority.
/// Every Class A render reads it, so changing the setting changes the
/// language of the next request even mid-session.
[<RequireQualifiedAccess>]
module GlobalProviderLanguage =

    // DSL-MUTABLE: resource — live global preference cache, replaced by host configuration refresh
    let mutable private currentLanguage = ProviderLanguage.English

    /// Re-resolve the live global preference. Called at startup and whenever
    /// the host preference changes.
    let refresh (resolve: unit -> ProviderLanguage) : unit = currentLanguage <- resolve ()

    let current () : ProviderLanguage = currentLanguage
