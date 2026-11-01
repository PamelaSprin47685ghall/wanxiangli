namespace Wanxiangli.FissionGroup

open Fable.Core
open Fable.Core.JsInterop

module internal FissionHistoryValue =
    let get<'a> (value: obj) (name: string) : 'a =
        let field: obj = value?(name)
        unbox field
    let optional<'a> (value: obj) (name: string) : 'a option =
        let item: obj = value?(name)
        if isNullOrUndefined item then None else Some(unbox item)
    let text value name = get<string> value name
    let nullable value = Option.map box value |> Option.defaultValue null
    let held previous same =
        match previous with
        | None -> null
        | Some value -> box (if same value then "same" else "different")
    type Takeover =
        { Lane: int; Session: string; Prompt: string option; Physical: string option; Reference: string; Digest: string }
    type Terminal =
        | Open
        | Converged of string * string * string * string
        | Failed of string
    type Group =
        { Id: string; Owner: string; Parent: string option; Origin: string; Count: int
          Sessions: Map<int, string>; Prompts: Map<int, string>; OwnerReference: string; OwnerDigest: string
          Before: Set<string>; Work: Map<int, string * string>; Runs: Map<int, string>
          Captured: Map<string, string * string>; Delivered: Map<string, Set<int>>
          Affinities: Map<string, int>; Takeover: Takeover option; Terminal: Terminal }
    type State =
        { Groups: Map<string, Group>; Active: Map<string, string>; Latest: Map<string, string>
          Owners: Map<string, string>; Membership: Map<string, string * int> }
    let empty = { Groups = Map.empty; Active = Map.empty; Latest = Map.empty; Owners = Map.empty; Membership = Map.empty }
    let law = FissionGroupLawCore.FissionGroupLaw()
    let progress group =
        createObj
            [ "workedLanes" ==> (group.Work |> Map.toArray |> Array.map (fst >> box))
              "deliveries" ==> (group.Before |> Set.toArray |> Array.map (fun key -> Map.tryFind key group.Delivered |> Option.defaultValue Set.empty |> Set.toArray |> Array.map box)) ]
    let ready group = law.convergenceReady(createObj [ "laneCount" ==> group.Count; "progress" ==> progress group ])
    let terminalName = function Open -> "Open" | Converged _ -> "Converged" | Failed _ -> "Failed"
    let takeoverDto value =
        createObj [ "laneIndex" ==> value.Lane; "session" ==> value.Session; "prompt" ==> nullable value.Prompt
                    "physical" ==> nullable value.Physical; "reference" ==> value.Reference; "digest" ==> value.Digest ]
    let terminalDto value =
        match value with
        | Open -> createObj [ "kind" ==> "Open" ]
        | Failed reason -> createObj [ "kind" ==> "Failed"; "reason" ==> reason ]
        | Converged(session, run, reference, digest) ->
            createObj [ "kind" ==> "Converged"; "session" ==> session; "run" ==> run; "reference" ==> reference; "digest" ==> digest ]
    let dto group =
        createObj
            [ "id" ==> group.Id; "owner" ==> group.Owner; "parent" ==> nullable group.Parent
              "origin" ==> group.Origin; "count" ==> group.Count
              "sessions" ==> (group.Sessions |> Map.toArray); "prompts" ==> (group.Prompts |> Map.toArray)
              "ownerReference" ==> group.OwnerReference; "ownerDigest" ==> group.OwnerDigest
              "before" ==> (group.Before |> Set.toArray); "work" ==> (group.Work |> Map.toArray)
              "runs" ==> (group.Runs |> Map.toArray); "captured" ==> (group.Captured |> Map.toArray)
              "delivered" ==> (group.Delivered |> Map.toArray |> Array.map (fun (key, lanes) -> key, Set.toArray lanes))
              "affinities" ==> (group.Affinities |> Map.toArray)
              "takeover" ==> (group.Takeover |> Option.map takeoverDto |> Option.defaultValue null)
              "terminal" ==> terminalDto group.Terminal ]
    let admission event =
        { Id = text event "groupId"; Owner = text event "owner"; Parent = optional event "parent"
          Origin = text event "origin"; Count = get event "count"
          Sessions = get<string array> event "sessions" |> Array.mapi (fun index value -> index, value) |> Map.ofArray
          Prompts = get<string array> event "prompts" |> Array.mapi (fun index value -> index, value) |> Map.ofArray
          OwnerReference = text event "reference"; OwnerDigest = text event "digest"
          Before = get<string array> event "before" |> Set.ofArray; Work = Map.empty; Runs = Map.empty
          Captured = Map.empty; Delivered = Map.empty; Affinities = Map.empty; Takeover = None; Terminal = Open }
    let admissionMatches a b =
        a.Owner = b.Owner && a.Parent = b.Parent && a.Origin = b.Origin && a.Count = b.Count
        && a.Sessions = b.Sessions && a.Prompts = b.Prompts && a.OwnerReference = b.OwnerReference
        && a.OwnerDigest = b.OwnerDigest && a.Before = b.Before
    let laneSession group lane session =
        match Map.tryFind lane group.Sessions with
        | None -> "absent"
        | Some expected -> if expected = session then "match" else "mismatch"
    let takeover event =
        { Lane = get event "laneIndex"; Session = text event "session"; Prompt = optional event "prompt"
          Physical = optional event "physical"; Reference = text event "reference"; Digest = text event "digest" }
    let convergence event = Converged(text event "session", text event "run", text event "reference", text event "digest")

    let judge (state: State) (event: obj) group =
        let kind = text event "kind"
        let lane = optional<int> event "laneIndex" |> Option.defaultValue 0
        let laneCount = group |> Option.map (fun g -> g.Count) |> nullable
        let laneIdentity = group |> Option.map (fun g -> laneSession g lane (text event "session")) |> Option.defaultValue "absent"
        let common = [ "event" ==> kind; "laneCount" ==> laneCount; "laneIndex" ==> lane; "laneSession" ==> laneIdentity ]
        let additions =
            match kind with
            | "admitted" ->
                let fresh = admission event
                [ "event" ==> kind; "existing" ==> held group (fun g -> admissionMatches g fresh)
                  "laneCount" ==> fresh.Count; "sessionCount" ==> fresh.Sessions.Count; "promptCount" ==> fresh.Prompts.Count
                  "ownerActive" ==> Map.containsKey fresh.Owner state.Active ]
            | "laneMaterialized" ->
                [ "work" ==> held (group |> Option.bind (fun g -> Map.tryFind lane g.Work |> Option.map (fun work -> g, work)))
                    (fun (g, work) -> work = (text event "reference", text event "digest") && Map.tryFind lane g.Runs = Some(text event "run")) ]
            | "completionCaptured" ->
                let key = text event "completion"
                [ "preFission" ==> (group |> Option.exists (fun g -> Set.contains key g.Before))
                  "captured" ==> held (group |> Option.bind (fun g -> Map.tryFind key g.Captured)) (fun pair -> pair = (text event "reference", text event "digest")) ]
            | "completionDelivered" ->
                [ "captured" ==> (group |> Option.exists (fun g -> Map.containsKey (text event "completion") g.Captured)) ]
            | "externalAffinityBound" ->
                [ "bound" ==> held (group |> Option.bind (fun g -> Map.tryFind (text event "external") g.Affinities)) ((=) lane) ]
            | "takeover" ->
                [ "progress" ==> (group |> Option.map progress |> Option.defaultValue (createObj [ "workedLanes" ==> Array.empty<obj>; "deliveries" ==> Array.empty<obj> ]))
                  "takeover" ==> held (group |> Option.bind (fun g -> g.Takeover)) ((=) (takeover event)) ]
            | "converged" ->
                match group with
                | None -> []
                | Some g ->
                    [ "terminal" ==> terminalName g.Terminal; "terminalSame" ==> (g.Terminal = convergence event)
                      "progress" ==> progress g
                      "takeoverLane" ==> (g.Takeover |> Option.map (fun t -> if t.Session = text event "session" then "match" else "mismatch") |> nullable) ]
            | "failed" ->
                match group with
                | None -> []
                | Some g -> [ "terminal" ==> terminalName g.Terminal; "terminalSame" ==> (g.Terminal = Failed(text event "reason")) ]
            | _ -> invalidArg "event" "Unknown Fission event"
        law.judge(createObj (if kind = "admitted" then additions else common @ additions))

    let update state event =
        let id = text event "groupId"
        let lane = optional<int> event "laneIndex" |> Option.defaultValue 0
        match text event "kind" with
        | "admitted" ->
            let group = admission event
            { Groups = Map.add id group state.Groups
              Active = Map.add group.Owner id state.Active
              Latest = Map.add group.Owner id state.Latest
              Owners = group.Sessions |> Map.fold (fun acc _ session -> Map.add session group.Owner acc) state.Owners
              Membership = group.Sessions |> Map.fold (fun acc index session -> Map.add session (id, index) acc) state.Membership }
        | kind ->
            let group = Map.find id state.Groups
            let pair = text event "reference", text event "digest"
            let updated =
                match kind with
                | "laneMaterialized" -> { group with Work = Map.add lane pair group.Work; Runs = Map.add lane (text event "run") group.Runs }
                | "completionCaptured" -> { group with Captured = Map.add (text event "completion") pair group.Captured }
                | "completionDelivered" ->
                    let key = text event "completion"
                    let previous = Map.tryFind key group.Delivered |> Option.defaultValue Set.empty
                    { group with Delivered = Map.add key (Set.add lane previous) group.Delivered }
                | "externalAffinityBound" -> { group with Affinities = Map.add (text event "external") lane group.Affinities }
                | "takeover" -> { group with Takeover = Some(takeover event) }
                | "converged" -> { group with Terminal = convergence event }
                | "failed" -> { group with Terminal = Failed(text event "reason") }
                | _ -> invalidArg "event" "Unknown Fission event"
            { state with
                Groups = Map.add id updated state.Groups
                Active = if kind = "converged" || kind = "failed" then Map.remove group.Owner state.Active else state.Active }

[<Sealed; AttachMembers>]
type FissionHistory(?snapshot: obj) =
    let state: FissionHistoryValue.State =
        snapshot |> Option.map unbox |> Option.defaultValue FissionHistoryValue.empty
    member this.apply(event: obj) : obj =
        let id = FissionHistoryValue.text event "groupId"
        let group = Map.tryFind id state.Groups
        let verdict = FissionHistoryValue.judge state event group
        match FissionHistoryValue.text verdict "verdict" with
        | "keep" -> createObj [ "ok" ==> true; "history" ==> this ]
        | "set" -> createObj [ "ok" ==> true; "history" ==> FissionHistory(box (FissionHistoryValue.update state event)) ]
        | _ -> createObj [ "ok" ==> false; "rejection" ==> FissionHistoryValue.text verdict "rejection" ]
    member _.group(id: string) = Map.tryFind id state.Groups |> Option.map FissionHistoryValue.dto |> Option.defaultValue null
    member this.activeForOwner(owner: string) = Map.tryFind owner state.Active |> Option.map this.group |> Option.defaultValue null
    member this.latestForOwner(owner: string) = Map.tryFind owner state.Latest |> Option.map this.group |> Option.defaultValue null
    member _.ownerOfLane(session: string) = Map.tryFind session state.Owners |> FissionHistoryValue.nullable
    member _.membership(session: string) =
        Map.tryFind session state.Membership
        |> Option.bind (fun (id, lane) -> Map.tryFind id state.Groups |> Option.map (fun group -> createObj [ "group" ==> FissionHistoryValue.dto group; "laneIndex" ==> lane ]))
        |> Option.defaultValue null
    member _.activeGroups() = state.Active |> Map.toArray |> Array.choose (fun (_, id) -> Map.tryFind id state.Groups |> Option.map FissionHistoryValue.dto)
    member _.convergenceReady(id: string) = Map.tryFind id state.Groups |> Option.exists FissionHistoryValue.ready
