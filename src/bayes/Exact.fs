/// Bayes exact inference over a finite discrete hypothesis set (WHAT[sphinx-v2-009/021/025/026]).
///
/// A factor must name an explicit dependency group, cover every hypothesis key and carry a
/// finite likelihood in [0,1]. The product is computed in log space with log-sum-exp
/// normalization; a zero prior stays zero. A repeated delivery of one observation id is one
/// observation; two different ids in one dependency group keep the first and record the rest
/// as dropped by the declared conservative rule (no joint factor declared).
module Wanxiangli.Bayes.Exact

open System

type Hypothesis = { Key: string; Prior: float }

type Factor =
    { ObservationId: string
      DependencyKey: string
      Likelihoods: Map<string, float>
      Qualified: bool }

type Posterior =
    { Probabilities: Map<string, float>
      LogPartition: float
      UsedObservations: string list
      Dropped: (string * string) list }

[<RequireQualifiedAccess>]
type ExactFault =
    | TooFewHypotheses of count: int
    | BlankHypothesisKey
    | DuplicateHypothesisKey of key: string
    | InvalidPrior of key: string
    | ZeroPriorMass
    | BlankDependencyKey of semanticKey: string
    | NoQualifiedFactor
    | UnknownHypothesisKey of semanticKey: string * key: string
    | IncompleteLikelihood of semanticKey: string * missingKey: string
    | InvalidLikelihood of semanticKey: string * key: string
    | NonPositivePartition

let private isFiniteNumber (value: float) : bool =
    not (Double.IsNaN value) && not (Double.IsInfinity value)

let private logSumExp (values: float list) : float =
    match values with
    | [] -> Double.NegativeInfinity
    | _ ->
        let peak = List.max values

        if peak = Double.NegativeInfinity then
            Double.NegativeInfinity
        else
            peak + Math.Log(values |> List.sumBy (fun value -> Math.Exp(value - peak)))

let private checkHypotheses (hypotheses: Hypothesis list) : Result<unit, ExactFault> =
    let keys = hypotheses |> List.map (fun hypothesis -> hypothesis.Key)

    if List.length hypotheses < 2 then
        Error(ExactFault.TooFewHypotheses(List.length hypotheses))
    elif keys |> List.exists String.IsNullOrWhiteSpace then
        Error ExactFault.BlankHypothesisKey
    else
        // The fault names the key that is actually repeated, not merely the first key.
        match keys |> List.countBy id |> List.tryFind (fun (_, count) -> count > 1) with
        | Some(key, _) -> Error(ExactFault.DuplicateHypothesisKey key)
        | None -> Ok()

let private normalizedPrior (hypotheses: Hypothesis list) : Result<Map<string, float>, ExactFault> =
    match hypotheses |> List.tryFind (fun h -> not (isFiniteNumber h.Prior) || h.Prior < 0.0) with
    | Some hypothesis -> Error(ExactFault.InvalidPrior hypothesis.Key)
    | None ->
        let total = hypotheses |> List.sumBy (fun hypothesis -> hypothesis.Prior)

        if isFiniteNumber total && total > 0.0 then
            Ok(hypotheses |> List.map (fun h -> h.Key, h.Prior / total) |> Map.ofList)
        else
            Error ExactFault.ZeroPriorMass

let private checkFactor (keys: Set<string>) (factor: Factor) : Result<unit, ExactFault> =
    let entries = factor.Likelihoods |> Map.toList
    let unknownKey = entries |> List.tryFind (fun (key, _) -> not (Set.contains key keys))

    let missingKey =
        keys |> Set.toList |> List.tryFind (fun key -> not (Map.containsKey key factor.Likelihoods))

    let badValue =
        entries |> List.tryFind (fun (_, value) -> not (isFiniteNumber value) || value < 0.0 || value > 1.0)

    match String.IsNullOrWhiteSpace factor.DependencyKey, unknownKey, missingKey, badValue with
    | true, _, _, _ -> Error(ExactFault.BlankDependencyKey factor.DependencyKey)
    | _, Some(key, _), _, _ -> Error(ExactFault.UnknownHypothesisKey(factor.ObservationId, key))
    | _, _, Some missing, _ -> Error(ExactFault.IncompleteLikelihood(factor.ObservationId, missing))
    | _, _, _, Some(key, _) -> Error(ExactFault.InvalidLikelihood(factor.ObservationId, key))
    | false, None, None, None -> Ok()

/// One dependency group: the members kept and the members the conservative rule dropped.
let private foldGroup (group: Factor list) : Factor list * (string * string) list =
    match group |> List.map (fun factor -> factor.ObservationId) |> Set.ofList |> Set.count with
    | 1 -> List.distinctBy (fun factor -> factor.ObservationId) group, []
    | _ ->
        [ List.head group ],
        group
        |> List.tail
        |> List.map (fun factor -> factor.ObservationId, "conservative-rule: joint factor not declared")

let private qualifiedGroups (factors: Factor list) : Result<Factor list * (string * string) list, ExactFault> =
    match factors |> List.filter (fun factor -> factor.Qualified) with
    | [] -> Error ExactFault.NoQualifiedFactor
    | qualified ->
        let folded =
            qualified |> List.groupBy (fun factor -> factor.DependencyKey) |> List.map (snd >> foldGroup)

        Ok(folded |> List.collect fst, folded |> List.collect snd)

let private posteriorFrom (prior: Map<string, float>) (used: Factor list) dropped : Result<Posterior, ExactFault> =
    let scored =
        prior
        |> Map.toList
        |> List.map (fun (key, mass) ->
            key, used |> List.fold (fun sum factor -> sum + Math.Log(Map.find key factor.Likelihoods)) (Math.Log mass))

    let normalizer = logSumExp (scored |> List.map snd)

    if not (isFiniteNumber normalizer) then
        Error ExactFault.NonPositivePartition
    else
        Ok
            { Probabilities = scored |> List.map (fun (key, mass) -> key, Math.Exp(mass - normalizer)) |> Map.ofList
              LogPartition = normalizer
              UsedObservations = used |> List.map (fun factor -> factor.ObservationId)
              Dropped = dropped }

let infer (hypotheses: Hypothesis list) (factors: Factor list) : Result<Posterior, ExactFault> =
    checkHypotheses hypotheses
    |> Result.bind (fun () -> normalizedPrior hypotheses)
    |> Result.bind (fun prior ->
        let keys = prior |> Map.keys |> Set.ofSeq

        qualifiedGroups factors
        |> Result.bind (fun (used, dropped) ->
            used
            |> List.fold (fun state factor -> state |> Result.bind (fun () -> checkFactor keys factor)) (Ok())
            |> Result.bind (fun () -> posteriorFrom prior used dropped)))

/// A prior-only run is legal and says so: no new evidence, no convergence. It is held to the
/// same hypothesis-set contract as `infer` (at least two distinct, non-blank keys).
let priorOnly (hypotheses: Hypothesis list) : Result<Posterior, ExactFault> =
    checkHypotheses hypotheses
    |> Result.bind (fun () -> normalizedPrior hypotheses)
    |> Result.map (fun prior ->
        { Probabilities = prior
          LogPartition = 0.0
          UsedObservations = []
          Dropped = [] })
