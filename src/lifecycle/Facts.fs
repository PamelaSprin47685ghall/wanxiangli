namespace Wanxiangli.Lifecycle

open System.Collections.Generic
open Wire

module internal Identities =
    let originator workId = identity "originator-v1" [ workId ]
    let successor retirementId = identity "successor-v1" [ retirementId ]
    let ask workId tenure call = identity "ask-v1" [ workId; tenure; call ]
    let relay workId tenure call = identity "relay-v1" [ workId; tenure; call ]
    let barrier workId call = identity "barrier-v1" [ workId; call ]
    let successorPrompt retirementId = identity "successor-prompt-v1" [ retirementId ]
    let advancePrompt tenure milestone = identity "advance-prompt-v1" [ tenure; milestone ]
    let launch workId run call digest = identity "launch-v1" [ workId; run; call; digest ]
    let complete workId tenure call = identity "complete-v1" [ workId; tenure; call ]
    let stop workId tenure = identity "stop-v1" [ workId; tenure ]
    let reopen workId messageId = identity "reopen-v1" [ workId; messageId ]

type internal Tenure =
    { Id: string
      Origin: string
      Milestone: string
      Substantive: bool
      Obligations: Map<string, string> }

type internal Round =
    { Id: string
      Origin: string
      Milestone: string
      Outcome: string
      RetirementId: string }

[<RequireQualifiedAccess>]
type internal Slot =
    | Ask of id: string * text: string * incumbency: string * outcome: string option
    | Dispatch of id: string * promptKind: string * milestone: string * text: string * incumbency: string * outcome: string option
    | Launch of id: string * digest: string * run: string * call: string * incumbency: string * session: string option * status: string
    | Stop of id: string * incumbency: string * requested: bool * observed: bool * unknown: bool

[<RequireQualifiedAccess>]
type internal Fact =
    | WorkOpened of workId: string * office: string
    | IncumbencyOpened of id: string * origin: string * milestone: string * messageId: string option
    | QuestionRequested of id: string * incumbency: string * run: string * call: string * text: string * updates: (string * string option) list
    | OperatorAnswered of messageId: string * incumbency: string * questionId: string
    | Reviewed of incumbency: string * run: string * call: string * updates: (string * string option) list
    | IncumbencyRetired of id: string * incumbency: string * outcome: string * run: string * call: string * updates: (string * string option) list
    | ContextBarrier of id: string * run: string * call: string * successorId: string
    | PromptObliged of id: string * kind: string * milestone: string * text: string * incumbency: string
    | MilestoneAdvanced of incumbency: string * fromMilestone: string * toMilestone: string * run: string * call: string * updates: (string * string option) list
    | DeliveryRequested of id: string * incumbency: string * run: string * call: string * digest: string * updates: (string * string option) list
    | DeliverySessionBound of id: string * session: string
    | DeliveryAdmitted of id: string * session: string
    | DeliveryRejected of id: string * reason: string
    | EffectConfirmed of id: string * outcome: string * session: string option * reason: string option
    | StopObliged of id: string * incumbency: string
    | DevOpsBound of id: string * target: string option * trigger: string

[<RequireQualifiedAccess>]
type internal Seal =
    | Tool of string
    | Message of string
    | None

module internal FactCodec =
    let private make name values = objectOf (("type", box name) :: values)
    let private oneOf allowed value =
        let name = text value
        require (List.contains name allowed) ("Unknown value: " + name)
        name

    let encode fact =
        match fact with
        | Fact.WorkOpened(workId, office) -> make "WorkOpened" [ "workId", box workId; "office", box office ]
        | Fact.IncumbencyOpened(id, origin, milestone, messageId) ->
            make "IncumbencyOpened" [ "incumbencyId", box id; "origin", box origin; "milestone", box milestone; "messageId", nullable messageId ]
        | Fact.QuestionRequested(id, incumbency, run, call, text, updates) ->
            make "QuestionRequested" [ "questionId", box id; "incumbencyId", box incumbency; "providerRunId", box run; "toolCallId", box call; "text", box text; "updates", box (encodeUpdates updates) ]
        | Fact.OperatorAnswered(messageId, incumbency, questionId) ->
            make "OperatorAnswered" [ "messageId", box messageId; "incumbencyId", box incumbency; "questionId", box questionId ]
        | Fact.Reviewed(incumbency, run, call, updates) ->
            make "Reviewed" [ "incumbencyId", box incumbency; "providerRunId", box run; "toolCallId", box call; "updates", box (encodeUpdates updates) ]
        | Fact.IncumbencyRetired(id, incumbency, outcome, run, call, updates) ->
            make "IncumbencyRetired" [ "retirementId", box id; "incumbencyId", box incumbency; "outcome", box outcome; "providerRunId", box run; "toolCallId", box call; "updates", box (encodeUpdates updates) ]
        | Fact.ContextBarrier(id, run, call, successorId) ->
            make "ContextBarrier" [ "barrierId", box id; "providerRunId", box run; "toolCallId", box call; "successorId", box successorId ]
        | Fact.PromptObliged(id, kind, milestone, text, incumbency) ->
            make "PromptObliged" [ "promptId", box id; "promptKind", box kind; "milestone", box milestone; "text", box text; "incumbencyId", box incumbency ]
        | Fact.MilestoneAdvanced(incumbency, fromMilestone, toMilestone, run, call, updates) ->
            make "MilestoneAdvanced" [ "incumbencyId", box incumbency; "from", box fromMilestone; "to", box toMilestone; "providerRunId", box run; "toolCallId", box call; "updates", box (encodeUpdates updates) ]
        | Fact.DeliveryRequested(id, incumbency, run, call, digest, updates) ->
            make "DeliveryRequested" [ "operationId", box id; "incumbencyId", box incumbency; "providerRunId", box run; "toolCallId", box call; "digest", box digest; "updates", box (encodeUpdates updates) ]
        | Fact.DeliverySessionBound(id, session) -> make "DeliverySessionBound" [ "operationId", box id; "execSessionId", box session ]
        | Fact.DeliveryAdmitted(id, session) -> make "DeliveryAdmitted" [ "operationId", box id; "execSessionId", box session ]
        | Fact.DeliveryRejected(id, reason) -> make "DeliveryRejected" [ "operationId", box id; "reason", box reason ]
        | Fact.EffectConfirmed(id, outcome, session, reason) ->
            make "EffectConfirmed" [ "effectId", box id; "outcome", box outcome; "execSessionId", nullable session; "reason", nullable reason ]
        | Fact.StopObliged(id, incumbency) -> make "StopObliged" [ "stopId", box id; "incumbencyId", box incumbency ]
        | Fact.DevOpsBound(id, target, trigger) -> make "DevOpsBound" [ "devopsId", box id; "target", nullable target; "trigger", box trigger ]

    let decode (value: obj) =
        let exact names = fields ("type" :: names) [] value
        let id key = identifier (get value key)
        let word key = text (get value key)
        let optionalId key = if isNull (get value key) then None else Some(identifier (get value key))
        match word "type" with
        | "WorkOpened" ->
            exact [ "workId"; "office" ]
            Fact.WorkOpened(id "workId", oneOf [ "Plan"; "Manager" ] (get value "office"))
        | "IncumbencyOpened" ->
            exact [ "incumbencyId"; "origin"; "milestone"; "messageId" ]
            Fact.IncumbencyOpened(id "incumbencyId", oneOf [ "Originator"; "Successor" ] (get value "origin"), word "milestone", optionalId "messageId")
        | "QuestionRequested" ->
            exact [ "questionId"; "incumbencyId"; "providerRunId"; "toolCallId"; "text"; "updates" ]
            Fact.QuestionRequested(id "questionId", id "incumbencyId", id "providerRunId", id "toolCallId", word "text", updates (get value "updates"))
        | "OperatorAnswered" ->
            exact [ "messageId"; "incumbencyId"; "questionId" ]
            Fact.OperatorAnswered(id "messageId", id "incumbencyId", id "questionId")
        | "Reviewed" ->
            exact [ "incumbencyId"; "providerRunId"; "toolCallId"; "updates" ]
            Fact.Reviewed(id "incumbencyId", id "providerRunId", id "toolCallId", updates (get value "updates"))
        | "IncumbencyRetired" ->
            exact [ "retirementId"; "incumbencyId"; "outcome"; "providerRunId"; "toolCallId"; "updates" ]
            Fact.IncumbencyRetired(id "retirementId", id "incumbencyId", oneOf [ "Relayed"; "Completed" ] (get value "outcome"), id "providerRunId", id "toolCallId", updates (get value "updates"))
        | "ContextBarrier" ->
            exact [ "barrierId"; "providerRunId"; "toolCallId"; "successorId" ]
            Fact.ContextBarrier(id "barrierId", id "providerRunId", id "toolCallId", id "successorId")
        | "PromptObliged" ->
            exact [ "promptId"; "promptKind"; "milestone"; "text"; "incumbencyId" ]
            Fact.PromptObliged(id "promptId", oneOf [ "Successor"; "Advance" ] (get value "promptKind"), word "milestone", word "text", id "incumbencyId")
        | "MilestoneAdvanced" ->
            exact [ "incumbencyId"; "from"; "to"; "providerRunId"; "toolCallId"; "updates" ]
            Fact.MilestoneAdvanced(id "incumbencyId", word "from", word "to", id "providerRunId", id "toolCallId", updates (get value "updates"))
        | "DeliveryRequested" ->
            exact [ "operationId"; "incumbencyId"; "providerRunId"; "toolCallId"; "digest"; "updates" ]
            Fact.DeliveryRequested(id "operationId", id "incumbencyId", id "providerRunId", id "toolCallId", word "digest", updates (get value "updates"))
        | "DeliverySessionBound" -> exact [ "operationId"; "execSessionId" ]; Fact.DeliverySessionBound(id "operationId", id "execSessionId")
        | "DeliveryAdmitted" -> exact [ "operationId"; "execSessionId" ]; Fact.DeliveryAdmitted(id "operationId", id "execSessionId")
        | "DeliveryRejected" -> exact [ "operationId"; "reason" ]; Fact.DeliveryRejected(id "operationId", word "reason")
        | "EffectConfirmed" ->
            exact [ "effectId"; "outcome"; "execSessionId"; "reason" ]
            Fact.EffectConfirmed(id "effectId", oneOf [ "Parked"; "Sent"; "Unknown"; "Requested"; "Observed" ] (get value "outcome"), optionalId "execSessionId", if isNull (get value "reason") then None else Some(word "reason"))
        | "StopObliged" -> exact [ "stopId"; "incumbencyId" ]; Fact.StopObliged(id "stopId", id "incumbencyId")
        | "DevOpsBound" ->
            exact [ "devopsId"; "target"; "trigger" ]
            let target = if isNull (get value "target") then None else Some(word "target")
            Fact.DevOpsBound(id "devopsId", target, oneOf [ "Ask"; "Resume"; "Horizon" ] (get value "trigger"))
        | _ -> fail "Unknown lifecycle event"

module internal Effects =
    let ask id text incumbency =
        objectOf [ "kind", box "Ask"; "id", box id; "text", box text; "incumbencyId", box incumbency ]

    let dispatch id promptKind milestone text incumbency =
        objectOf [ "kind", box "Dispatch"; "id", box id; "promptKind", box promptKind; "milestone", box milestone; "text", box text; "incumbencyId", box incumbency ]

    let launch id phase digest run call session =
        objectOf [ "kind", box "Launch"; "id", box id; "phase", box phase; "digest", box digest; "providerRunId", box run; "toolCallId", box call; "execSessionId", nullable session ]

    let stop id incumbency =
        objectOf [ "kind", box "Stop"; "id", box id; "incumbencyId", box incumbency ]

    let ofSlot slot =
        match slot with
        | Slot.Ask(id, text, incumbency, None) -> Some(ask id text incumbency)
        | Slot.Dispatch(id, kind, milestone, text, incumbency, None) -> Some(dispatch id kind milestone text incumbency)
        | Slot.Launch(id, digest, run, call, _, session, "Create") -> Some(launch id "Create" digest run call session)
        | Slot.Launch(id, digest, run, call, _, session, "Send") -> Some(launch id "Send" digest run call session)
        | Slot.Stop(id, incumbency, false, _, false) -> Some(stop id incumbency)
        | _ -> None

    let blocks slot =
        match slot with
        | Slot.Ask(_, _, _, None) -> true
        | Slot.Dispatch(_, _, _, _, _, None) -> true
        | Slot.Stop(_, _, false, _, false) -> true
        | _ -> false

    let idOf = function
        | Slot.Ask(id, _, _, _) -> id
        | Slot.Dispatch(id, _, _, _, _, _) -> id
        | Slot.Launch(id, _, _, _, _, _, _) -> id
        | Slot.Stop(id, _, _, _, _) -> id

module internal View =
    let obligations map =
        map
        |> Map.toList
        |> List.sortBy fst
        |> List.map (fun (key, value) -> objectOf [ "key", box key; "value", box value ])
        |> List.toArray

    let applyUpdates current updates =
        updates |> List.fold (fun acc (key, value) ->
            match value with
            | None -> Map.remove key acc
            | Some text -> Map.add key text acc) current

type internal Receipt = { Hash: string; Result: obj }

