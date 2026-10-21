namespace Wanxiangli.Authority

open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBoolean (_value: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isAbsent (_value: obj) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    let malformed (what: string) : 'T = raise (System.ArgumentException(sprintf "wanxiangli/authority: malformed %s" what))

    let text (what: string) (value: obj) : string =
        if isString value then unbox<string> value else malformed what

    let rootKind (value: obj) : RootKind =
        match (if isString value then unbox<string> value else "") with
        | "HumanRoot" -> RootKind.HumanRoot
        | "AgentOwnerRoot" -> RootKind.AgentOwnerRoot
        | _ -> malformed "root kind"

    let rootKindLabel (kind: RootKind) : string =
        match kind with
        | RootKind.HumanRoot -> "HumanRoot"
        | RootKind.AgentOwnerRoot -> "AgentOwnerRoot"

    let root (value: obj) : RunRoot =
        if not (isObject value) then malformed "root"
        else
            { SessionId = text "root.sessionId" (field value "sessionId")
              LogicalRunId = text "root.logicalRunId" (field value "logicalRunId")
              RootId = text "root.rootId" (field value "rootId")
              Kind = rootKind (field value "kind")
              Seed = text "root.seed" (field value "seed") }

    let optionalRoot (value: obj) : RunRoot option =
        if isAbsent value then None else Some(root value)

    let flag (what: string) (value: obj) : bool =
        if isBoolean value then unbox<bool> value else malformed what

    let origin (value: obj) : Origin =
        if not (isObject value) then malformed "origin"
        else
            match (if isString (field value "kind") then unbox<string> (field value "kind") else "") with
            | "AuthorityRoot" -> Origin.AuthorityRoot(rootKind (field value "root"))
            | "Continuation" -> Origin.Continuation(text "origin.continuation" (field value "continuation"))
            | "HostInternal" -> Origin.HostInternal
            | "UnknownOrigin" -> Origin.UnknownOrigin
            | _ -> malformed "origin kind"

    let originView (origin: Origin) : obj =
        match origin with
        | Origin.AuthorityRoot kind -> createObj [ "kind" ==> "AuthorityRoot"; "root" ==> rootKindLabel kind ]
        | Origin.Continuation continuation ->
            createObj [ "kind" ==> "Continuation"; "continuation" ==> continuation ]
        | Origin.HostInternal -> createObj [ "kind" ==> "HostInternal" ]
        | Origin.UnknownOrigin -> createObj [ "kind" ==> "UnknownOrigin" ]

    let optionalText (what: string) (value: obj) : string option =
        if isAbsent value then None else Some(text what value)

    let optionalOrigin (value: obj) : Origin option =
        if isAbsent value then None else Some(origin value)

    let activeFacts (value: obj) : ActiveFacts =
        if not (isObject value) then malformed "active"
        else
            { Kind = rootKind (field value "kind")
              SelectedAgent = text "active.selectedAgent" (field value "selectedAgent") }

    let pendingClaim (value: obj) : PendingClaimFacts =
        if not (isObject value) then malformed "pendingClaim"
        else
            { SessionId = text "pendingClaim.sessionId" (field value "sessionId")
              Origin = origin (field value "origin")
              SelectedAgent = text "pendingClaim.selectedAgent" (field value "selectedAgent") }

    let acceptedFacts (value: obj) : AcceptedFacts =
        if not (isObject value) then malformed "acceptedEvidence"
        else
            { SessionId = text "acceptedEvidence.sessionId" (field value "sessionId")
              PhysicalId = text "acceptedEvidence.physicalId" (field value "physicalId")
              Origin = origin (field value "origin")
              SelectedAgent = text "acceptedEvidence.selectedAgent" (field value "selectedAgent") }

    /// authority: null/undefined = 快照不可用；{ active: null } = 有快照无活跃运行。
    let authoritySnapshot (value: obj) : ActiveFacts option option =
        if isAbsent value then None
        elif not (isObject value) then malformed "authority"
        else
            let active = field value "active"
            Some(if isAbsent active then None else Some(activeFacts active))

    let admissionInput (value: obj) : AdmissionInput =
        if not (isObject value) then malformed "admission input"
        else
            let carrier = optionalText "invalidCarrier" (field value "invalidCarrier")

            match carrier with
            | Some "SessionId"
            | Some "agent"
            | Some "PromptKey"
            | None -> ()
            | Some _ -> malformed "invalidCarrier"

            { InvalidCarrier = carrier
              SessionId = optionalText "sessionId" (field value "sessionId")
              PhysicalId = optionalText "physicalId" (field value "physicalId")
              PromptKey = optionalText "promptKey" (field value "promptKey")
              ExplicitAgent = optionalText "explicitAgent" (field value "explicitAgent")
              ExplicitRootAgent = optionalText "explicitRootAgent" (field value "explicitRootAgent")
              HostInternal = flag "hostInternal" (field value "hostInternal")
              Authority = authoritySnapshot (field value "authority")
              AcceptedContinuation = optionalText "acceptedContinuation" (field value "acceptedContinuation")
              LandedOrigin = optionalOrigin (field value "landedOrigin")
              PendingClaim =
                (if isAbsent (field value "pendingClaim") then None
                 else Some(pendingClaim (field value "pendingClaim")))
              AcceptedEvidence =
                (if isAbsent (field value "acceptedEvidence") then None
                 else Some(acceptedFacts (field value "acceptedEvidence"))) }

    let rejectionLabel (rejection: AdmissionRejection) : string =
        match rejection with
        | AdmissionRejection.MalformedCarrier _ -> "malformed-carrier"
        | AdmissionRejection.MissingSession -> "missing-session"
        | AdmissionRejection.MissingPhysical -> "missing-physical"
        | AdmissionRejection.AuthorityUnavailable -> "authority-unavailable"
        | AdmissionRejection.InvalidExplicitAgent -> "invalid-explicit-agent"
        | AdmissionRejection.AcceptedParticipantConflict -> "accepted-participant-conflict"
        | AdmissionRejection.PromptKeyNotClaimed -> "prompt-key-not-claimed"
        | AdmissionRejection.AgentOwnerRootPromptNotClaimed -> "agent-owner-root-prompt-not-claimed"
        | AdmissionRejection.ClaimSessionMismatch -> "claim-session-mismatch"
        | AdmissionRejection.ClaimOriginNotAdmissible -> "claim-origin-not-admissible"
        | AdmissionRejection.UnknownOriginWhileActive -> "unknown-origin-while-active"

    let admissionView (admission: Admission) : obj =
        match admission with
        | Admission.Unmanaged -> createObj [ "kind" ==> "unmanaged" ]
        | Admission.AlreadyAccepted origin -> createObj [ "kind" ==> "already-accepted"; "origin" ==> originView origin ]
        | Admission.HostInternal -> createObj [ "kind" ==> "host-internal" ]
        | Admission.AcceptedRootReplay -> createObj [ "kind" ==> "accepted-root-replay" ]
        | Admission.ExternalRoot -> createObj [ "kind" ==> "external-root" ]
        | Admission.ActiveHumanContinuation -> createObj [ "kind" ==> "active-human-continuation" ]
        | Admission.PendingPrompt -> createObj [ "kind" ==> "pending-prompt" ]
        | Admission.Reject(AdmissionRejection.MalformedCarrier carrier) ->
            createObj [ "kind" ==> "reject"; "reason" ==> "malformed-carrier"; "carrier" ==> carrier ]
        | Admission.Reject rejection -> createObj [ "kind" ==> "reject"; "reason" ==> rejectionLabel rejection ]


    // --- interaction-authority-018 closure (CUT-09-b) ---

    [<Emit("JSON.stringify($0)")>]
    let jsonStrings (_values: string array) : string = jsNative

    [<Emit("(function(t){try{var v=JSON.parse(t);return Array.isArray(v)&&v.every(function(x){return typeof x==='string'})?v:null}catch(e){return null}})($0)")>]
    let parseStrings (_text: string) : string array = jsNative

    let closureKindLabel (kind: ClosureKind) : string =
        match kind with
        | ClosureKind.HumanRootManagerLife -> "HumanRootManagerLife"
        | ClosureKind.HumanRootManagedRun -> "HumanRootManagedRun"
        | ClosureKind.AgentOwnerChildWork -> "AgentOwnerChildWork"
        | ClosureKind.AgentOwnerAttachedWork -> "AgentOwnerAttachedWork"
        | ClosureKind.AgentOwnerInternalLeaf -> "AgentOwnerInternalLeaf"

    let closureKind (value: obj) : ClosureKind =
        match (if isString value then unbox<string> value else "") with
        | "HumanRootManagerLife" -> ClosureKind.HumanRootManagerLife
        | "HumanRootManagedRun" -> ClosureKind.HumanRootManagedRun
        | "AgentOwnerChildWork" -> ClosureKind.AgentOwnerChildWork
        | "AgentOwnerAttachedWork" -> ClosureKind.AgentOwnerAttachedWork
        | "AgentOwnerInternalLeaf" -> ClosureKind.AgentOwnerInternalLeaf
        | _ -> malformed "closure kind"

    let agentOwnerLife (value: obj) : AgentOwnerLife option =
        if isAbsent value then None
        else
            match (if isString value then unbox<string> value else "") with
            | "child" -> Some AgentOwnerLife.Child
            | "attached" -> Some AgentOwnerLife.Attached
            | "internal-leaf" -> Some AgentOwnerLife.InternalLeaf
            | _ -> malformed "agentOwnerLife"

    let witnessView (witness: ClosureWitness) : obj =
        match witness with
        | ClosureWitness.LifeCompleted(life, fact) ->
            createObj [ "kind" ==> "LifeCompleted"; "lifeId" ==> life; "factId" ==> fact ]
        | ClosureWitness.ManagedLogicalRunTerminal(run, fact) ->
            createObj [ "kind" ==> "ManagedLogicalRunTerminal"; "logicalRunId" ==> run; "factId" ==> fact ]
        | ClosureWitness.ChildLogicalRunTerminal(owner, child, fact) ->
            createObj
                [ "kind" ==> "ChildLogicalRunTerminal"
                  "ownerLogicalRunId" ==> owner
                  "childLogicalRunId" ==> child
                  "factId" ==> fact ]
        | ClosureWitness.AttachedLogicalRunTerminal(owner, child, attachment, generation, fact) ->
            createObj
                [ "kind" ==> "AttachedLogicalRunTerminal"
                  "ownerLogicalRunId" ==> owner
                  "childLogicalRunId" ==> child
                  "attachmentKind" ==> attachment
                  "associationGeneration" ==> generation
                  "factId" ==> fact ]
        | ClosureWitness.InternalLeafTerminal(owner, leaf, decision, fact) ->
            createObj
                [ "kind" ==> "InternalLeafTerminal"
                  "ownerLogicalRunId" ==> owner
                  "leafLogicalRunId" ==> leaf
                  "decisionOrTransactionId" ==> decision
                  "factId" ==> fact ]

    let witness (value: obj) : ClosureWitness =
        if not (isObject value) then malformed "witness"
        else
            let t name = text ("witness." + name) (field value name)

            match (if isString (field value "kind") then unbox<string> (field value "kind") else "") with
            | "LifeCompleted" -> ClosureWitness.LifeCompleted(t "lifeId", t "factId")
            | "ManagedLogicalRunTerminal" -> ClosureWitness.ManagedLogicalRunTerminal(t "logicalRunId", t "factId")
            | "ChildLogicalRunTerminal" ->
                ClosureWitness.ChildLogicalRunTerminal(t "ownerLogicalRunId", t "childLogicalRunId", t "factId")
            | "AttachedLogicalRunTerminal" ->
                ClosureWitness.AttachedLogicalRunTerminal(
                    t "ownerLogicalRunId",
                    t "childLogicalRunId",
                    t "attachmentKind",
                    t "associationGeneration",
                    t "factId"
                )
            | "InternalLeafTerminal" ->
                ClosureWitness.InternalLeafTerminal(
                    t "ownerLogicalRunId",
                    t "leafLogicalRunId",
                    t "decisionOrTransactionId",
                    t "factId"
                )
            | _ -> malformed "witness kind"

    let decodeWitness (text: string) : ClosureWitness option =
        match parseStrings text with
        | null -> None
        | values -> ClosureLaw.ofFields (List.ofArray values)

    let closingRoot (value: obj) : ClosingRoot =
        if not (isObject value) then malformed "closing"
        else
            { Kind = closureKind (field value "kind")
              SessionId = text "closing.sessionId" (field value "sessionId")
              LogicalRunId = text "closing.logicalRunId" (field value "logicalRunId")
              RootId = text "closing.rootId" (field value "rootId")
              OwnerLogicalRunId = optionalText "closing.ownerLogicalRunId" (field value "ownerLogicalRunId")
              LifeId = optionalText "closing.lifeId" (field value "lifeId") }

    let refusalLabel (refusal: ClosureRefusal) : string =
        match refusal with
        | ClosureRefusal.RootKindMismatch -> "root-kind-mismatch"
        | ClosureRefusal.MalformedWitness -> "malformed-witness"
        | ClosureRefusal.WitnessKindMismatch -> "witness-kind-mismatch"
        | ClosureRefusal.WitnessIdentityMismatch -> "witness-identity-mismatch"
        | ClosureRefusal.ClosingIdentityMissing -> "closing-identity-missing"

/// wanxiangli/authority 公开入口：逻辑根注册、精确关闭与来源解析优先级的纯决议。
/// 无状态；投影记录、事实编解码与 durable 写入归宿主。JS 边界只收发 plain data，
/// 畸形输入是调用方缺陷，直接抛 ArgumentException，不猜测。
[<AttachMembers>]
type Authority() =

    /// 注册一个根：'admit' | 'replay' | 'conflict'。active 可为 null。
    member _.register(active: obj, requested: obj) : string =
        match RunLaw.register (Wire.optionalRoot active) (Wire.root requested) with
        | Registration.Admit -> "admit"
        | Registration.Replay -> "replay"
        | Registration.Conflict -> "conflict"

    /// 精确关闭：'close' | 'already-closed' | 'mismatch' | 'no-authority'。
    member _.close(active: obj, last: obj, logicalRunId: obj, rootId: obj) : string =
        RunLaw.close
            (Wire.optionalRoot active)
            (Wire.optionalRoot last)
            (Wire.text "logicalRunId" logicalRunId)
            (Wire.text "rootId" rootId)
        |> Authority.closureLabel

    /// 已完成子工作的关闭；活跃根不是非 Manager 的 AgentOwnerRoot 时为 'not-child-work'。
    member _.closeChildWork(active: obj, activeIsManager: obj, last: obj, logicalRunId: obj, rootId: obj) : string =
        RunLaw.closeChildWork
            (Wire.optionalRoot active)
            (Wire.flag "activeIsManager" activeIsManager)
            (Wire.optionalRoot last)
            (Wire.text "logicalRunId" logicalRunId)
            (Wire.text "rootId" rootId)
        |> Authority.closureLabel

    /// 来源解析。input = { acceptedContinuation?: string, claimOrigin?: Origin, hasPromptKey: boolean,
    /// hostCompaction: boolean, activeKind?: RootKind }。
    member _.resolveOrigin(input: obj) : obj =
        if not (Wire.isObject input) then Wire.malformed "origin input"
        else
            RunLaw.resolveOrigin
                (if Wire.isAbsent (Wire.field input "acceptedContinuation") then None
                 else Some(Wire.text "acceptedContinuation" (Wire.field input "acceptedContinuation")))
                (if Wire.isAbsent (Wire.field input "claimOrigin") then None else Some(Wire.origin (Wire.field input "claimOrigin")))
                (Wire.flag "hasPromptKey" (Wire.field input "hasPromptKey"))
                (Wire.flag "hostCompaction" (Wire.field input "hostCompaction"))
                (if Wire.isAbsent (Wire.field input "activeKind") then None else Some(Wire.rootKind (Wire.field input "activeKind")))
            |> Wire.originView

    /// 入口准入（CUT-09-a）：见 index.d.ts 的 AdmissionInput / Admission。
    member _.admit(input: obj) : obj =
        AdmissionLaw.admit (Wire.admissionInput input) |> Wire.admissionView


    /// interaction-authority-018：根的唯一预期关闭类别；无法唯一归类时为 null（该根不得被接受）。
    /// agentOwnerLife: 'child' | 'attached' | 'internal-leaf' | null（HumanRoot 必须为 null）。
    member _.expectedClosureKind(rootKind: obj, isManager: obj, agentOwnerLife: obj) : obj =
        match
            ClosureLaw.expectedKind (Wire.rootKind rootKind) (Wire.flag "isManager" isManager) (Wire.agentOwnerLife agentOwnerLife)
        with
        | Some kind -> box (Wire.closureKindLabel kind)
        | None -> null

    /// witness 的规范编码（写入 AuthorityLogicalRunClosed.ClosureWitness 的唯一拼法）。
    member _.encodeClosureWitness(witness: obj) : string =
        Wire.witness witness |> ClosureLaw.fields |> List.toArray |> Wire.jsonStrings

    /// 规范编码的读回；不是五类之一的规范编码时为 null。
    member _.decodeClosureWitness(text: obj) : obj =
        match Wire.decodeWitness (Wire.text "witness text" text) with
        | Some witness -> Wire.witnessView witness
        | None -> null

    /// 一条关闭（新写入或 durable 读回）是否精确命中被关闭的根：
    /// { ok: true, witness, legacy } | { ok: false, reason }。
    member _.admitClosure(closing: obj, recordedRootKind: obj, witnessText: obj) : obj =
        let raw = Wire.text "witness text" witnessText

        match ClosureLaw.admitRecorded (Wire.closingRoot closing) (Wire.rootKind recordedRootKind) (Wire.decodeWitness raw) raw with
        | Ok(witness, legacy) ->
            createObj [ "ok" ==> true; "witness" ==> Wire.witnessView witness; "legacy" ==> legacy ]
        | Error refusal -> createObj [ "ok" ==> false; "reason" ==> Wire.refusalLabel refusal ]

    static member private closureLabel(closure: Closure) : string =
        match closure with
        | Closure.Close -> "close"
        | Closure.AlreadyClosed -> "already-closed"
        | Closure.Mismatch -> "mismatch"
        | Closure.NoAuthority -> "no-authority"
        | Closure.NotChildWork -> "not-child-work"
