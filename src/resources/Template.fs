namespace Wanxiangli.Resources

open System
open System.Text.RegularExpressions

/// PROMPT-019: strict `{{name}}` placeholder extraction and substitution.
/// Values are literal: never re-expanded, never translated.
[<RequireQualifiedAccess>]
module ProseTemplate =

    let private placeholderRe =
        Regex(@"\{\{([A-Za-z][A-Za-z0-9_]*)\}\}", RegexOptions.Compiled)

    /// Distinct placeholder names in first-occurrence order.
    let placeholders (template: string) : string list =
        if isNull (box template) then
            []
        else
            placeholderRe.Matches(template)
            |> Seq.cast<Match>
            |> Seq.map (fun matched -> matched.Groups.[1].Value)
            |> Seq.distinct
            |> List.ofSeq

    /// Replace `{{name}}` with values. Missing keys fail closed; leftover
    /// placeholders after substitution fail closed.
    let substitute (template: string) (substitutions: Map<string, string>) : string =
        let replaced =
            placeholderRe.Replace(
                template,
                MatchEvaluator(fun matched ->
                    let key = matched.Groups.[1].Value

                    match Map.tryFind key substitutions with
                    | Some value -> value
                    | None ->
                        raise (
                            InvalidOperationException(
                                sprintf "provider prose missing substitution {{%s}} (PROMPT-019)" key
                            )
                        ))
            )

        if placeholderRe.IsMatch replaced then
            raise (InvalidOperationException("provider prose retained unsubstituted placeholders (PROMPT-019)"))

        replaced
