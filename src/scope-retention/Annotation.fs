module Wanxiangli.ScopeRetention.Annotation

open System
open Fable.Core
open Fable.Core.JsInterop

let MaxRetentionBudget = 48

let private exemptTools =
    Set.ofList [ "negotiate"; "askPreviousScope"; "askPrevious"; "deliver" ]

let isExemptTool (name: string) : bool =
    if String.IsNullOrWhiteSpace name then false
    else exemptTools.Contains name

[<Emit("$0 == null")>]
let private isNullish (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'number' && Number.isFinite($0)")>]
let private isFiniteNumber (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

type ScopeKind =
    | ResetScope
    | KeepLast
    | RemoveLast
    | MeToo

type ScopeAnnotation =
    { Kind: ScopeKind
      OldScopeVerboseVerbatim: string
      NewScopeGoal: string
      NewScopeRetentionBudget: int
      Replacement: string }

let private kindOf (raw: string) : ScopeKind option =
    match raw with
    | "resetScope" -> Some ResetScope
    | "keepLast" -> Some KeepLast
    | "removeLast" -> Some RemoveLast
    | "meToo" -> Some MeToo
    | _ -> None

let private textField (scope: obj) (name: string) : string =
    let value = field scope name
    if isNullish value then ""
    elif isString value then unbox<string> value
    else ""

let private intField (scope: obj) (name: string) : int option =
    let value = field scope name
    if isNullish value then None
    elif isFiniteNumber value then
        let n = unbox<float> value
        if n = Math.Floor n && n >= 1.0 && n <= float MaxRetentionBudget then Some(int n)
        else None
    else None

/// Flat object: { kind, oldScopeVerboseVerbatim?, newScopeGoal?, newScopeRetentionBudget?, replacement? }
let parseScopeAnnotation (raw: obj) : Result<ScopeAnnotation, string> =
    if isNullish raw then Error "scope annotation required"
    elif not (isObject raw) then Error "scope must be an object"
    else
        let kindRaw = field raw "kind"
        if not (isString kindRaw) then Error "scope.kind must be a string"
        else
            match kindOf (unbox<string> kindRaw) with
            | None -> Error "scope.kind must be resetScope | keepLast | removeLast | meToo"
            | Some kind ->
                Ok
                    { Kind = kind
                      OldScopeVerboseVerbatim = textField raw "oldScopeVerboseVerbatim"
                      NewScopeGoal = textField raw "newScopeGoal"
                      NewScopeRetentionBudget = intField raw "newScopeRetentionBudget" |> Option.defaultValue 0
                      Replacement = textField raw "replacement" }

let validateScopeFields (annotation: ScopeAnnotation) : Result<unit, string> =
    match annotation.Kind with
    | ResetScope ->
        if String.IsNullOrWhiteSpace annotation.NewScopeGoal then
            Error "resetScope requires newScopeGoal"
        elif annotation.NewScopeRetentionBudget < 1 || annotation.NewScopeRetentionBudget > MaxRetentionBudget then
            Error ("resetScope requires newScopeRetentionBudget in 1.." + string MaxRetentionBudget)
        else Ok()
    | KeepLast
    | MeToo -> Ok()
    | RemoveLast ->
        if String.IsNullOrWhiteSpace annotation.Replacement then
            Error "removeLast requires replacement (lesson required; state world side effects when any)"
        else Ok()
