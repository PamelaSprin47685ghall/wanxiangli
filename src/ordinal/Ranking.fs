namespace Wanxiangli.Ordinal

/// Ranking likelihoods, each stating what it may be used for.
///
/// WHAT[sphinx-v2-014]: a ranking is not a bag of pairs. Expanding a ranked ballot into
/// all its constituent pairs is legal only as a *composite* likelihood that keeps the
/// ballot cluster, because the pairs are dependent. Counting them as independent samples
/// is how a ten-item ballot becomes forty-five votes.

module Ranking =

    /// log(exp(total)) is computed by summing exponentials directly: the candidate set
    /// is small and the strengths are bounded, so logSumExp is not needed here.
    let private pairTotal (theta: Map<string, float>) (presented: string list) : float option =
        let pairs =
            presented
            |> List.collect (fun left -> presented |> List.map (fun right -> left, right))
            |> List.filter (fun (left, right) -> left <> right)

        let terms =
            pairs
            |> List.choose (fun (left, right) ->
                match Map.tryFind left theta, Map.tryFind right theta with
                | Some tl, Some tr -> Some(System.Math.Exp(tl - tr))
                | _ -> None)

        match List.length terms = List.length pairs with
        | true -> Some(List.sum terms)
        | false -> None

    /// `total` must be positive; a non-positive denominator is a modeling failure, not a
    /// zero-probability observation.
    let private positiveLog (total: float) : float option =
        match total > 0.0 with
        | true -> Some(System.Math.Log total)
        | false -> None

    /// MaxDiff joint likelihood for one best/worst observation.
    ///
    /// P(b,w | S,theta) = exp(theta_b - theta_w) / sum over distinct (i,j) in S.
    /// The denominator is the full set of ordered pairs, not just the chosen one, which
    /// is what makes it a proper joint likelihood rather than two independent picks.
    let maxDiffLogProbability
        (theta: Map<string, float>)
        (presented: string list)
        (best: string)
        (worst: string)
        : float option =
        match Map.tryFind best theta, Map.tryFind worst theta, pairTotal theta presented with
        | Some tb, Some tw, Some total -> positiveLog total |> Option.map (fun denominator -> (tb - tw) - denominator)
        | _ -> None

    /// Plackett–Luce for a strict complete ranking. Every item in the ranking must be
    /// present in theta; a partial ranking is a different model, not a truncated one.
    let plackettLuceLogProbability (theta: Map<string, float>) (order: string list) : float option =
        let strengthsOf (available: Set<string>) : float list =
            available |> Set.toList |> List.choose (fun item -> Map.tryFind item theta)

        let logNormalizer (available: Set<string>) : float option =
            let strengths = strengthsOf available

            match List.length strengths = Set.count available with
            | true -> positiveLog (strengths |> List.sumBy System.Math.Exp)
            | false -> None

        let rec walk (remaining: string list) (available: Set<string>) (acc: float) : float option =
            match
                remaining, Map.tryFind (List.tryHead remaining |> Option.defaultValue "") theta, logNormalizer available
            with
            | [], _, _ -> Some acc
            | item :: rest, Some ti, Some denominator -> walk rest (Set.remove item available) (acc + ti - denominator)
            | _ -> None

        walk order (Set.ofList order) 0.0

    /// The expansion of a ranked ballot into pairs, kept as a *composite* term whose
    /// cluster the caller must carry. The returned count is not a sample size.
    let compositePairs (order: string list) : (string * string) list =
        order
        |> List.mapi (fun i item -> order |> List.skip (i + 1) |> List.map (fun other -> item, other))
        |> List.concat

    /// Borda as a descriptive baseline. It is not a likelihood and carries no
    /// uncertainty; the caller must label it as descriptive and report the exposure
    /// matrix that produced it (WHAT[sphinx-v2-024]).
    let bordaCounts (ballots: string list list) (candidates: string list) : Map<string, float> =
        let points (order: string list) (item: string) =
            match List.tryFindIndex ((=) item) order with
            | Some index -> float (List.length order - index)
            | None -> 0.0

        let appearances (item: string) =
            ballots |> List.filter (fun order -> List.contains item order) |> List.length

        candidates
        |> List.map (fun candidate ->
            let total = ballots |> List.sumBy (fun order -> points order candidate)
            let shown = appearances candidate

            match shown with
            | 0 -> candidate, 0.0
            | n -> candidate, total / float n)
        |> Map.ofList
