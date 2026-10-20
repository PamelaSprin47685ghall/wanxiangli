module Wanxiangli.WarmStart.WarmStartLaw

open System
open Fable.Core
open Fable.Core.JsInterop

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("Number.isInteger($0)")>]
let private isInteger (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'function'")>]
let private isFunction (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("$0($1, $2)")>]
let private call2 (_f: obj) (_a: int) (_b: int) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("JSON.stringify($0)")>]
let private json (_value: obj) : string = jsNative

let private malformed (what: string) : 'T =
    raise (ArgumentException(sprintf "wanxiangli/warm-start: malformed %s" what))

let private array (what: string) (value: obj) : obj array =
    if isArray value then unbox<obj array> value else malformed what

let private integer (what: string) (value: obj) : int =
    if isInteger value then unbox<int> value else malformed what

/// At most this many distinct keyword lines are searched (repository-investigation-009).
let private MaxKeywords = 8
/// At most this many hits are kept per keyword, ranked 1..k in search order.
let private TopKPerKeyword = 4
/// At most this many hints survive de-duplication across all keywords.
let private MaxHintsTotal = 24
/// Byte budget of the rendered warm-start document; only whole entries are dropped.
let private MaxWarmStartBytes = 64 * 1024

/// repository-investigation-008: only roles that may touch repository code (canonical
/// lower-case role labels "engineer" and "devops")
/// evidence directly receive warm-start snippets.
let private isDirectConsumerImpl (role: string) : bool = role = "engineer" || role = "devops"

/// repository-investigation-007: one explicit non-empty line is one complete query.
/// CRLF/CR become LF, every line is trimmed, blank lines are dropped, exact
/// (case-sensitive) duplicates keep their first occurrence, at most MaxKeywords.
/// No keyword at all means zero work.
let private normalizeKeywordsImpl (raw: obj) : string array =
    if isAbsent raw then
        [||]
    elif not (isString raw) then
        malformed "keywords"
    else
        let text = unbox<string> raw

        if String.IsNullOrWhiteSpace text then
            [||]
        else
            let lines = text.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n')
            let kept = ResizeArray<string>()
            let seen = Collections.Generic.HashSet<string>()
            let mutable index = 0

            while index < lines.Length && kept.Count < MaxKeywords do
                let item = lines[index].Trim()

                if item <> "" && seen.Add item then
                    kept.Add item

                index <- index + 1

            kept.ToArray()

/// Ranks one keyword's hits: the first TopKPerKeyword in search order get
/// localRank 1..k under the keyword's ordinal. Hits are carried by reference.
let private rankHitsImpl (ordinal: obj) (hits: obj) : obj array =
    let ordinal = integer "ordinal" ordinal
    let hits = array "hits" hits

    hits
    |> Array.truncate TopKPerKeyword
    |> Array.mapi (fun index hit -> freeze (createObj [ "keywordOrdinal" ==> ordinal; "localRank" ==> index + 1; "hit" ==> hit ]))

let private identity (hint: obj) : string =
    if isAbsent hint then
        malformed "hint"
    else
        json (
            box
                [| field hint "filePath"
                   field hint "startLine"
                   field hint "endLine"
                   field hint "content" |]
        )

/// repository-investigation-009 merge: searches in keyword-ordinal order, their
/// hints concatenated in that order, stably de-duplicated by
/// (filePath, startLine, endLine, content), capped at MaxHintsTotal. `omitted`
/// counts every original hint that did not survive (duplicates included).
/// Searches and hints are returned by reference.
let private selectImpl (searches: obj) : obj =
    let searches = array "searches" searches

    let ordered =
        searches
        |> Array.mapi (fun index search ->
            if isAbsent search then malformed "search"
            integer "search.ordinal" (field search "ordinal"), index, search)
        |> Array.sortBy (fun (ordinal, index, _) -> ordinal, index)
        |> Array.map (fun (_, _, search) -> search)

    let all = ordered |> Array.collect (fun search -> array "search.hints" (field search "hints"))
    let seen = Collections.Generic.HashSet<string>()
    let kept = ResizeArray<obj>()

    for hint in all do
        if seen.Add(identity hint) then
            kept.Add hint

    let hints = kept.ToArray() |> Array.truncate MaxHintsTotal

    freeze (
        createObj
            [ "searches" ==> freeze (box ordered)
              "hints" ==> freeze (box hints)
              "omitted" ==> max 0 (all.Length - hints.Length) ]
    )

/// Whole-entry budget: keeps the longest prefix of `count` hints whose rendered
/// document, as measured by the caller (`measure(kept, omitted)` in bytes), fits
/// `budget`; every dropped hint adds one to `omitted`. Never cuts an entry.
/// Returns null when even zero hints do not fit — the caller then falls back.
let private fitImpl (count: obj) (initialOmitted: obj) (measure: obj) (budget: obj) : obj =
    let count = integer "count" count
    let initialOmitted = integer "omitted" initialOmitted
    let budget = if isAbsent budget then MaxWarmStartBytes else integer "budget" budget

    if count < 0 || initialOmitted < 0 then malformed "count"
    if not (isFunction measure) then malformed "measure"

    let rec loop kept =
        if kept < 0 then
            null
        else
            let omitted = initialOmitted + (count - kept)
            let bytes = call2 measure kept omitted

            if isInteger bytes && unbox<int> bytes <= budget then
                freeze (createObj [ "kept" ==> kept; "omitted" ==> omitted ])
            elif isInteger bytes then
                loop (kept - 1)
            else
                malformed "measure result"

    loop count

/// repository-investigation-007/008/009 warm-start law. Pure and stateless.
[<AttachMembers>]
type WarmStartLaw() =
    member _.contractVersion = 1
    member _.maxKeywords = MaxKeywords
    member _.topKPerKeyword = TopKPerKeyword
    member _.maxHintsTotal = MaxHintsTotal
    member _.maxWarmStartBytes = MaxWarmStartBytes
    member _.isDirectConsumer(role: string) : bool = isDirectConsumerImpl role
    member _.normalizeKeywords(raw: obj) : string array = normalizeKeywordsImpl raw
    member _.rankHits(ordinal: obj, hits: obj) : obj array = rankHitsImpl ordinal hits
    member _.select(searches: obj) : obj = selectImpl searches
    member _.fit(count: obj, initialOmitted: obj, measure: obj, budget: obj) : obj = fitImpl count initialOmitted measure budget
