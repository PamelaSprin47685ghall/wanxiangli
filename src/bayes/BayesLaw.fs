module Wanxiangli.Bayes.BayesLaw

open System
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Bayes.Exact

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'number'")>]
let private isNumber (_value: obj) : bool = jsNative

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
    raise (ArgumentException(sprintf "wanxiangli/bayes: malformed %s" what))

let private text what (value: obj) : string =
    if isString value then unbox<string> value else malformed what

/// Any JS number, NaN and infinities included: rejecting those is the law's job, not the boundary's.
let private number what (value: obj) : float =
    if isNumber value then unbox<float> value else malformed what

let private flag what (value: obj) : bool =
    if isBoolean value then unbox<bool> value else malformed what

let private items what (value: obj) : obj list =
    if isArray value then unbox<obj array> value |> List.ofArray else malformed what

let private record what (value: obj) : obj =
    if isObject value then value else malformed what

let private hypothesis (value: obj) : Hypothesis =
    let value = record "hypothesis" value

    { Key = text "hypothesis.key" (field value "key")
      Prior = number "hypothesis.prior" (field value "prior") }

let private factor (value: obj) : Factor =
    let value = record "factor" value
    let likelihoods = record "factor.likelihoods" (field value "likelihoods")

    { ObservationId = text "factor.observationId" (field value "observationId")
      DependencyKey = text "factor.dependencyKey" (field value "dependencyKey")
      Likelihoods =
        keys likelihoods
        |> Array.map (fun k -> k, number ("factor.likelihoods." + k) (field likelihoods k))
        |> Map.ofArray
      Qualified = flag "factor.qualified" (field value "qualified") }

let private faultView (fault: ExactFault) : obj =
    let view =
        match fault with
        | ExactFault.TooFewHypotheses count -> createObj [ "kind" ==> "TooFewHypotheses"; "count" ==> count ]
        | ExactFault.BlankHypothesisKey -> createObj [ "kind" ==> "BlankHypothesisKey" ]
        | ExactFault.DuplicateHypothesisKey key -> createObj [ "kind" ==> "DuplicateHypothesisKey"; "key" ==> key ]
        | ExactFault.InvalidPrior key -> createObj [ "kind" ==> "InvalidPrior"; "key" ==> key ]
        | ExactFault.ZeroPriorMass -> createObj [ "kind" ==> "ZeroPriorMass" ]
        | ExactFault.BlankDependencyKey semanticKey ->
            createObj [ "kind" ==> "BlankDependencyKey"; "semanticKey" ==> semanticKey ]
        | ExactFault.NoQualifiedFactor -> createObj [ "kind" ==> "NoQualifiedFactor" ]
        | ExactFault.UnknownHypothesisKey(semanticKey, key) ->
            createObj [ "kind" ==> "UnknownHypothesisKey"; "semanticKey" ==> semanticKey; "key" ==> key ]
        | ExactFault.IncompleteLikelihood(semanticKey, missingKey) ->
            createObj [ "kind" ==> "IncompleteLikelihood"; "semanticKey" ==> semanticKey; "missingKey" ==> missingKey ]
        | ExactFault.InvalidLikelihood(semanticKey, key) ->
            createObj [ "kind" ==> "InvalidLikelihood"; "semanticKey" ==> semanticKey; "key" ==> key ]
        | ExactFault.NonPositivePartition -> createObj [ "kind" ==> "NonPositivePartition" ]

    freeze view

let private resultView (result: Result<Posterior, ExactFault>) : obj =
    match result with
    | Ok posterior ->
        let probabilities =
            posterior.Probabilities |> Map.toList |> List.map (fun (k, v) -> k ==> v) |> createObj |> freeze

        let posteriorView =
            createObj
                [ "probabilities" ==> probabilities
                  "logPartition" ==> posterior.LogPartition
                  "usedObservations" ==> freeze (box (Array.ofList posterior.UsedObservations))
                  "dropped"
                  ==> freeze (box (posterior.Dropped |> List.map (fun (a, b) -> freeze (box [| a; b |])) |> Array.ofList)) ]
            |> freeze

        freeze (createObj [ "ok" ==> true; "posterior" ==> posteriorView ])
    | Error fault -> freeze (createObj [ "ok" ==> false; "fault" ==> faultView fault ])

/// WHAT[sphinx-v2-009/021/025/026] exact posterior over a finite hypothesis set. Pure and stateless.
[<AttachMembers>]
type BayesLaw() =
    member _.contractVersion = 1

    member _.infer(hypotheses: obj, factors: obj) : obj =
        let hypotheses = items "hypotheses" hypotheses |> List.map hypothesis
        let factors = items "factors" factors |> List.map factor
        Exact.infer hypotheses factors |> resultView

    member _.priorOnly(hypotheses: obj) : obj =
        Exact.priorOnly (items "hypotheses" hypotheses |> List.map hypothesis) |> resultView
