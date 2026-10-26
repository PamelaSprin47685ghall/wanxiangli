[<AutoOpen>]
module Wanxiangli.Resources.Language

open System
open Fable.Core

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

[<AutoOpen>]
module private ProviderLanguageHelpers =

    let toObservation (value: obj) : string option =
        if isNull value then None
        else
            let s = string value
            if String.IsNullOrWhiteSpace s then None else Some s

/// Autonomous state holder for process-wide provider language configuration,
/// host config preference and observation ladder resolution (HOST-026).
[<AttachMembers>]
type ProviderLanguageStore(?initialLanguage: string) =

    let mutable currentLang =
        match initialLanguage with
        | Some raw when not (String.IsNullOrWhiteSpace raw) ->
            ProviderLanguage.parse raw
        | _ -> ProviderLanguage.English

    let mutable hostConfigPref: string option = None

    member _.current() : string =
        ProviderLanguage.externalName currentLang

    member _.currentLanguage() : ProviderLanguage =
        currentLang

    member _.refresh(resolve: unit -> string) : string =
        currentLang <- ProviderLanguage.parse (resolve ())
        ProviderLanguage.externalName currentLang

    member _.refreshWithLanguage(resolve: unit -> ProviderLanguage) : unit =
        currentLang <- resolve ()

    member _.setHostConfigPreference(raw: string) : unit =
        if isNull (box raw) then
            hostConfigPref <- None
        else
            hostConfigPref <- Some raw

    member _.clearHostConfigPreference() : unit =
        hostConfigPref <- None

    member _.hostConfigPreference() : string option =
        hostConfigPref

    member _.getHostConfigPreference() : string =
        match hostConfigPref with
        | Some v -> v
        | None -> null

    member _.forSessionText(_sessionText: string) : string =
        ProviderLanguage.externalName currentLang

    member _.tryParseLanguage(raw: string) : obj =
        match ProviderLanguage.tryParse raw with
        | Some language -> box (ProviderLanguage.externalName language)
        | None -> null

    member _.parseLanguage(raw: string) : string =
        ProviderLanguage.parse raw |> ProviderLanguage.externalName

    member _.resolvePreference
        (explicit: obj, hostConfig: obj, vscodeNls: obj, posixLocale: obj, intlLocale: obj)
        : obj =
        let explicitOpt = toObservation explicit
        let hostConfigOpt =
            match toObservation hostConfig with
            | Some _ as v -> v
            | None -> hostConfigPref
        let vscodeNlsOpt = toObservation vscodeNls
        let posixLocaleOpt = toObservation posixLocale
        let intlLocaleOpt = toObservation intlLocale

        match
            ProviderLanguage.fromObservationLadder
                explicitOpt
                hostConfigOpt
                vscodeNlsOpt
                posixLocaleOpt
                intlLocaleOpt
        with
        | Ok lang ->
            box {| ok = true; value = ProviderLanguage.externalName lang; error = "" |}
        | Error err ->
            box {| ok = false; value = ""; error = err |}

    member this.resolveLadder
        (explicit: obj, hostConfig: obj, vscodeNls: obj, posixLocale: obj, intlLocale: obj)
        : obj =
        this.resolvePreference(explicit, hostConfig, vscodeNls, posixLocale, intlLocale)

    member this.resolveFromObservations
        (explicit: obj, vscodeNls: obj, posixLocale: obj, intlLocale: obj)
        : obj =
        this.resolvePreference(explicit, null, vscodeNls, posixLocale, intlLocale)

let providerLanguageStore = ProviderLanguageStore()

/// HOST-026: the live global preference is the only language authority.
/// Every Class A render reads it, so changing the setting changes the
/// language of the next request even mid-session.
[<RequireQualifiedAccess>]
module GlobalProviderLanguage =

    let refresh (resolve: unit -> ProviderLanguage) : unit =
        providerLanguageStore.refreshWithLanguage resolve

    let current () : ProviderLanguage =
        providerLanguageStore.currentLanguage ()
