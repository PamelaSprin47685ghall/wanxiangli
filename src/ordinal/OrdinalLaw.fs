module Wanxiangli.Ordinal.OrdinalLaw

open System
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'number' && Number.isFinite($0)")>]
let private isFiniteNumber (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBoolean (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.keys($0)")>]
let private keys (_value: obj) : string array = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (ArgumentException(sprintf "wanxiangli/ordinal: malformed %s" what))

let private text what (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private number what (value: obj) : float =
    if isFiniteNumber value then unbox<float> value else malformed what

let private flag what (value: obj) : bool =
    if isBoolean value then unbox<bool> value else malformed what

let private strings what (value: obj) : string list =
    if isArray value then
        unbox<obj array> value |> Array.mapi (fun i v -> text (sprintf "%s[%d]" what i) v) |> List.ofArray
    else
        malformed what

let private theta (value: obj) : Map<string, float> =
    if not (isObject value) then malformed "theta"
    keys value |> Array.map (fun k -> k, number ("theta." + k) (field value k)) |> Map.ofArray

let private mapView (m: Map<string, float>) : obj =
    freeze (createObj (m |> Map.toList |> List.map (fun (k, v) -> k ==> v)))

let private optionNumber (value: float option) : obj =
    match value with
    | Some v -> box v
    | None -> null

/// WHAT[sphinx-v2-025] ordinal likelihoods: stable log-space pairwise (BTL and
/// tie-aware) likelihoods and gradient, Plackett–Luce and MaxDiff ranking
/// likelihoods, composite pairs and the descriptive Borda baseline.
/// Pure and stateless; Sphinx is the caller.
[<AttachMembers>]
type OrdinalLaw() =
    member _.contractVersion = 1

    member _.logSigmoid(x: obj) : float = Pairwise.logSigmoid (number "x" x)
    member _.logSumExp(a: obj, b: obj) : float = Pairwise.logSumExp (number "a" a) (number "b" b)

    member _.directionalLogLikelihood(thetaWinner: obj, thetaLoser: obj, beta: obj, position: obj) : float =
        Pairwise.directionalLogLikelihood
            (number "thetaWinner" thetaWinner)
            (number "thetaLoser" thetaLoser)
            (number "beta" beta)
            (number "position" position)

    member _.tieAwareLogLikelihood
        (thetaLeft: obj, thetaRight: obj, beta: obj, position: obj, kappa: obj, observedTie: obj)
        : float =
        Pairwise.tieAwareLogLikelihood
            (number "thetaLeft" thetaLeft)
            (number "thetaRight" thetaRight)
            (number "beta" beta)
            (number "position" position)
            (number "kappa" kappa)
            (flag "observedTie" observedTie)

    member _.directionalGradient(thetaWinner: obj, thetaLoser: obj, beta: obj, position: obj) : obj =
        let a, b, c =
            Pairwise.directionalGradient
                (number "thetaWinner" thetaWinner)
                (number "thetaLoser" thetaLoser)
                (number "beta" beta)
                (number "position" position)

        [| box a; box b; box c |] |> box |> freeze

    member _.maxDiffLogProbability(theta': obj, set: obj, best: obj, worst: obj) : obj =
        Ranking.maxDiffLogProbability (theta theta') (strings "set" set) (text "best" best) (text "worst" worst)
        |> optionNumber

    member _.plackettLuceLogProbability(theta': obj, order: obj) : obj =
        Ranking.plackettLuceLogProbability (theta theta') (strings "order" order) |> optionNumber

    member _.compositePairs(order: obj) : obj =
        Ranking.compositePairs (strings "order" order)
        |> List.map (fun (a, b) -> freeze (box [| a; b |]))
        |> Array.ofList
        |> box
        |> freeze

    member _.bordaCounts(rankings: obj, candidates: obj) : obj =
        let rankings =
            if isArray rankings then
                unbox<obj array> rankings |> Array.map (strings "rankings[]") |> List.ofArray
            else
                malformed "rankings"

        Ranking.bordaCounts rankings (strings "candidates" candidates) |> mapView
