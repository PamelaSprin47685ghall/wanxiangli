module Wanxiangli.Ablation.AblationRuntime

open System
open Fable.Core
open Fable.Core.JsInterop

let private isAbsent (value: obj) : bool =
    isNull value || jsTypeof value = "undefined"

let private parseModeWord (word: string) : string option =
    match word with
    | "ablated" -> Some "ablated"
    | "borrowed" -> Some "borrowed"
    | "active" -> Some "active"
    | _ -> None

let private normalizeMode (raw: string) : string option =
    if isNull raw then
        None
    else
        parseModeWord (raw.Trim().ToLowerInvariant())

[<AttachMembers>]
type AblationToolMapStore() =
    let mutable cached: Map<string, string> option = None

    let ensureLoaded (loader: unit -> (string * string)[]) =
        match cached with
        | Some table -> table
        | None ->
            let table = loader () |> Map.ofArray
            cached <- Some table
            table

    member _.resetCache() : unit = cached <- None

    member _.tryNode(toolName: string, loader: unit -> (string * string)[]) : string =
        ensureLoaded loader |> Map.tryFind toolName |> Option.toObj

[<AttachMembers>]
type AblationFactMapStore() =
    let mutable cached: Map<string, string> option = None

    let ensureLoaded (loader: unit -> (string * string)[]) =
        match cached with
        | Some table -> table
        | None ->
            let table = loader () |> Map.ofArray
            cached <- Some table
            table

    member _.resetCache() : unit = cached <- None

    member _.tryNode(factTag: string, loader: unit -> (string * string)[]) : string =
        ensureLoaded loader |> Map.tryFind factTag |> Option.toObj

[<AttachMembers>]
type AblationGateState() =
    let mutable registryCell: obj option = None

    let isAblated (modeWire: string) = modeWire = "ablated"

    let allowsSchema (modeWire: string) =
        modeWire = "active" || modeWire = "borrowed"

    member _.useRegistry(registry: obj) : unit = registryCell <- Some registry

    member _.resetRegistry() : unit = registryCell <- None

    member _.installedRegistry() : obj =
        match registryCell with
        | Some reg -> reg
        | None -> null

    member _.resolveRegistry(fallback: unit -> obj) : obj =
        match registryCell with
        | Some installed -> installed
        | None -> fallback ()

    member _.deniedFactPath: string = "journal/denied-ablation"

    member _.toolDenied(modeOfNode: string -> string, tryToolNode: string -> string, toolName: string) : bool =
        tryToolNode toolName
        |> Option.ofObj
        |> Option.map (modeOfNode >> isAblated)
        |> Option.defaultValue false

    member _.toolSchemaDenied(modeOfNode: string -> string, tryToolNode: string -> string, toolName: string) : bool =
        tryToolNode toolName
        |> Option.ofObj
        |> Option.map (modeOfNode >> allowsSchema >> not)
        |> Option.defaultValue false

    member _.factDenied(modeOfNode: string -> string, tryFactNode: string -> string, factTag: string) : bool =
        tryFactNode factTag
        |> Option.ofObj
        |> Option.map (modeOfNode >> isAblated)
        |> Option.defaultValue false

    member _.primaryAgentAllowed(isActiveNode: string -> bool, agentName: string) : bool =
        match agentName.ToLowerInvariant() with
        | "manager" -> isActiveNode "work"
        | "orchestrator" -> isActiveNode "change-integration"
        | "inquiry" -> isActiveNode "epistemic-reasoning"
        | "browser" -> false
        | _ -> true

    member _.fissionVisible(isActiveNode: string -> bool) : bool =
        isActiveNode "intra-participant-parallelism"

[<AttachMembers>]
type AblationConfig() =
    let cleanEnvValue (raw: string) : string option =
        if isAbsent (box raw) || String.IsNullOrWhiteSpace raw then
            None
        else
            Some(raw.Trim())

    let appendIfPresent (acc: (string * string) list) (itemOpt: (string * string) option) =
        match itemOpt with
        | Some pair -> pair :: acc
        | None -> acc

    let parseNodeOverride (readEnv: string -> string) (nodeId: string) =
        let normalized = nodeId.Replace('.', '_').Replace('-', '_').ToLowerInvariant()
        let envKey = "WANXIANGSHU_ABLATION_" + normalized
        let rawOpt = cleanEnvValue (readEnv envKey)

        match rawOpt, Option.bind normalizeMode rawOpt with
        | None, _ -> Ok None
        | Some _, Some modeWire -> Ok(Some(nodeId, modeWire))
        | Some raw, None -> Error(nodeId, raw)

    let stepOverride (readEnv: string -> string) (state: Result<(string * string) list, string * string>) (nodeId: string) =
        state
        |> Result.bind (fun acc -> parseNodeOverride readEnv nodeId |> Result.map (appendIfPresent acc))

    member _.envKeyForNode(nodeId: string) : string =
        let normalized = nodeId.Replace('.', '_').Replace('-', '_').ToLowerInvariant()
        "WANXIANGSHU_ABLATION_" + normalized

    member _.resolveProfile(readEnv: string -> string) : string =
        cleanEnvValue (readEnv "WANXIANGSHU_ABLATION_PROFILE") |> Option.toObj

    member _.resolveOverrides(nodeIds: string[], readEnv: string -> string) : obj =
        match nodeIds |> Array.fold (stepOverride readEnv) (Ok []) with
        | Ok list -> createObj [ "ok" ==> box true; "pairs" ==> box (list |> List.rev |> List.toArray) ]
        | Error(node, raw) -> createObj [ "ok" ==> box false; "node" ==> box node; "raw" ==> box raw ]

let ablationToolMapStore = AblationToolMapStore()
let ablationFactMapStore = AblationFactMapStore()
let ablationGateState = AblationGateState()
let ablationConfig = AblationConfig()
