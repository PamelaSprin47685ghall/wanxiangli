module Wanxiangli.Association.TurnBindingStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type ActiveRunBindingRecord =
    { sessionId: string
      runId: string option
      authorityRootUserMessageId: string option
      physicalUserMessageId: string option
      continuationMessageIds: string array
      role: string option
      directory: string option
      inheritedAuthorityOwner: string option }

[<AttachMembers>]
type ProjectedRunBinding =
    { activeRootId: string option
      canonicalRole: string option
      inheritedOwnerSessionId: string option
      inheritedOwnerRootId: string option
      inheritedOwnerRole: string option
      lanePhysicalId: string option }

module private BindingInternal =

    [<Emit("Array.isArray($0)")>]
    let isArray (value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'object' && $0 !== null")>]
    let isObject (x: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (x: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isAbsent (x: obj) : bool = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (x: obj) : obj = jsNative

    let parseString (value: obj) : string option =
        if isNull value then None
        elif isString value then
            let s = (string value).Trim()
            if String.IsNullOrWhiteSpace s || s = "undefined" || s = "null" then None
            else Some s
        else None

    let parseStringArray (value: obj) : string array =
        if isNull value then [||]
        elif isArray value then
            let arr = unbox<obj array> value
            arr |> Array.choose parseString
        else [||]

    let getField (input: obj) (camel: string) (pascal: string) : string option =
        let v1 = input?(camel)
        if not (isNull v1) then parseString v1
        else
            let v2 = input?(pascal)
            if not (isNull v2) then parseString v2
            else None

    let parseBindingInput (input: obj) : ActiveRunBindingRecord option =
        if isNull input || not (isObject input) then None
        else
            let sidOpt = getField input "sessionId" "SessionId"
            match sidOpt with
            | None -> None
            | Some sid ->
                let runId = getField input "runId" "RunId"
                let rootId = getField input "authorityRootUserMessageId" "AuthorityRootUserMessageId"
                let physId = getField input "physicalUserMessageId" "PhysicalUserMessageId"
                let role = getField input "role" "Role"
                let dir = getField input "directory" "Directory"
                let owner = getField input "inheritedAuthorityOwner" "InheritedAuthorityOwner"
                let contObj =
                    let c1 = input?("continuationMessageIds")
                    if not (isNull c1) then c1
                    else input?("ContinuationMessageIds")
                let conts = parseStringArray contObj
                Some
                    { sessionId = sid
                      runId = runId
                      authorityRootUserMessageId = rootId
                      physicalUserMessageId = physId
                      continuationMessageIds = conts
                      role = role
                      directory = dir
                      inheritedAuthorityOwner = owner }

    let parseProjectedSummary (input: obj) : ProjectedRunBinding option =
        if isNull input || not (isObject input) then None
        else
            let activeRootId = getField input "activeRootId" "ActiveRootId"
            let canonicalRole = getField input "canonicalRole" "CanonicalRole"
            let inheritedOwnerSessionId = getField input "inheritedOwnerSessionId" "InheritedOwnerSessionId"
            let inheritedOwnerRootId = getField input "inheritedOwnerRootId" "InheritedOwnerRootId"
            let inheritedOwnerRole = getField input "inheritedOwnerRole" "InheritedOwnerRole"
            let lanePhysicalId = getField input "lanePhysicalId" "LanePhysicalId"

            let allEmpty =
                activeRootId.IsNone
                && canonicalRole.IsNone
                && inheritedOwnerSessionId.IsNone
                && inheritedOwnerRootId.IsNone
                && inheritedOwnerRole.IsNone
                && lanePhysicalId.IsNone

            if allEmpty then None
            else
                Some
                    { activeRootId = activeRootId
                      canonicalRole = canonicalRole
                      inheritedOwnerSessionId = inheritedOwnerSessionId
                      inheritedOwnerRootId = inheritedOwnerRootId
                      inheritedOwnerRole = inheritedOwnerRole
                      lanePhysicalId = lanePhysicalId }

    let recordToObj (r: ActiveRunBindingRecord) : obj =
        createObj
            [ "sessionId" ==> r.sessionId
              "runId" ==> (match r.runId with Some v -> box v | None -> null)
              "authorityRootUserMessageId" ==> (match r.authorityRootUserMessageId with Some v -> box v | None -> null)
              "physicalUserMessageId" ==> (match r.physicalUserMessageId with Some v -> box v | None -> null)
              "continuationMessageIds" ==> box r.continuationMessageIds
              "role" ==> (match r.role with Some v -> box v | None -> null)
              "directory" ==> (match r.directory with Some v -> box v | None -> null)
              "inheritedAuthorityOwner" ==> (match r.inheritedAuthorityOwner with Some v -> box v | None -> null) ]
        |> freeze

/// 进程内逻辑运行绑定与合流自治存储（Package-14）。
/// 独占拥有 userMessageBindings、activeBindings、continuationMessageIds 三个字典状态；
/// 完全自治管理：
/// - bindUserMessage: 派生 root (PROMPT-002 promotion)，更新 physical 游标，保留已有 role
/// - bindContinuationUserMessage: 累积 continuationMessageIds 集合，更新 physical 游标
/// - bindPhysicalUserMaterial: 仅更新 physical 游标，不造 root，不造 continuation
/// - bindActiveRun: 合并 continuation 集合，注册活跃运行
/// - activeRunBinding: explicit 与 projected 合流（durable authority 拥有 root，explicit 保留 physical/role/directory，continuationIds 并集，Fission lane 继承 owner binding）
/// - tryPhysicalUserMessage: 优先 activeBindings.physical，回退 userMessageBindings
/// - clearSession: 彻底清空三字典
[<AttachMembers>]
type TurnBindingStore() =
    let userMessageBindings = Dictionary<string, string>()
    let activeBindings = Dictionary<string, ActiveRunBindingRecord>()
    let continuationMessageIds = Dictionary<string, HashSet<string>>()

    member _.bindUserMessage(sessionId: obj, physical: obj, ?agentRole: obj) : bool =
        let sidOpt = BindingInternal.parseString sessionId
        let physOpt = BindingInternal.parseString physical
        match sidOpt, physOpt with
        | Some key, Some phys ->
            let roleOpt =
                match agentRole with
                | Some r -> BindingInternal.parseString r
                | None -> None

            let root = phys
            userMessageBindings.[key] <- phys

            match activeBindings.TryGetValue key with
            | true, binding ->
                activeBindings.[key] <-
                    { binding with
                        authorityRootUserMessageId = Some root
                        physicalUserMessageId = Some phys
                        role = roleOpt |> Option.orElse binding.role }
            | false, _ ->
                activeBindings.[key] <-
                    { sessionId = key
                      runId = None
                      authorityRootUserMessageId = Some root
                      physicalUserMessageId = Some phys
                      continuationMessageIds = [||]
                      role = roleOpt
                      directory = None
                      inheritedAuthorityOwner = None }
            true
        | _ -> false

    member _.bindContinuationUserMessage(sessionId: obj, physical: obj) : bool =
        let sidOpt = BindingInternal.parseString sessionId
        let physOpt = BindingInternal.parseString physical
        match sidOpt, physOpt with
        | Some key, Some phys ->
            let continuations =
                match continuationMessageIds.TryGetValue key with
                | true, set ->
                    set.Add phys |> ignore
                    set
                | false, _ ->
                    let set = HashSet<string>()
                    set.Add phys |> ignore
                    continuationMessageIds.[key] <- set
                    set

            let contArr = Array.ofSeq continuations
            userMessageBindings.[key] <- phys

            match activeBindings.TryGetValue key with
            | true, binding ->
                activeBindings.[key] <-
                    { binding with
                        physicalUserMessageId = Some phys
                        continuationMessageIds = contArr }
            | false, _ ->
                activeBindings.[key] <-
                    { sessionId = key
                      runId = None
                      authorityRootUserMessageId = None
                      physicalUserMessageId = Some phys
                      continuationMessageIds = contArr
                      role = None
                      directory = None
                      inheritedAuthorityOwner = None }
            true
        | _ -> false

    member _.bindPhysicalUserMaterial(sessionId: obj, physical: obj) : bool =
        let sidOpt = BindingInternal.parseString sessionId
        let physOpt = BindingInternal.parseString physical
        match sidOpt, physOpt with
        | Some key, Some phys ->
            userMessageBindings.[key] <- phys

            match activeBindings.TryGetValue key with
            | true, binding ->
                activeBindings.[key] <-
                    { binding with
                        physicalUserMessageId = Some phys }
            | false, _ ->
                activeBindings.[key] <-
                    { sessionId = key
                      runId = None
                      authorityRootUserMessageId = None
                      physicalUserMessageId = Some phys
                      continuationMessageIds = [||]
                      role = None
                      directory = None
                      inheritedAuthorityOwner = None }
            true
        | _ -> false

    member _.bindActiveRun(bindingInput: obj) : bool =
        match BindingInternal.parseBindingInput bindingInput with
        | None -> false
        | Some binding ->
            let key = binding.sessionId
            let continuations =
                match continuationMessageIds.TryGetValue key with
                | true, set ->
                    let combined = HashSet<string>(binding.continuationMessageIds)
                    for s in set do combined.Add s |> ignore
                    Array.ofSeq combined
                | false, _ -> binding.continuationMessageIds

            activeBindings.[key] <-
                { binding with
                    continuationMessageIds = continuations }
            true

    member _.activeRunBinding(sessionId: obj, ?projectedSummary: obj) : obj =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> null
        | Some key ->
            let fromExplicit () =
                match activeBindings.TryGetValue key with
                | true, binding when binding.authorityRootUserMessageId.IsSome -> Some binding
                | true, binding when binding.physicalUserMessageId.IsSome -> Some binding
                | _ -> None

            let continuations =
                match continuationMessageIds.TryGetValue key with
                | true, set -> set
                | false, _ -> HashSet<string>()

            let contArr = Array.ofSeq continuations

            let tryBoundPhysical (sid: string) =
                match userMessageBindings.TryGetValue sid with
                | true, bound -> Some bound
                | false, _ -> None

            let summaryOpt =
                match projectedSummary with
                | Some p -> BindingInternal.parseProjectedSummary p
                | None -> None

            let projectedBinding (proj: ProjectedRunBinding) =
                match proj.activeRootId with
                | Some rootId ->
                    Some
                        { sessionId = key
                          runId = None
                          authorityRootUserMessageId = Some rootId
                          physicalUserMessageId = tryBoundPhysical key
                          continuationMessageIds = contArr
                          role = proj.canonicalRole
                          directory = None
                          inheritedAuthorityOwner = None }
                | None ->
                    match proj.inheritedOwnerRootId with
                    | Some ownerRootId ->
                        Some
                            { sessionId = key
                              runId = None
                              authorityRootUserMessageId = Some ownerRootId
                              physicalUserMessageId = proj.lanePhysicalId
                              continuationMessageIds = contArr
                              role = proj.inheritedOwnerRole
                              directory = None
                              inheritedAuthorityOwner = proj.inheritedOwnerSessionId }
                    | None -> None

            let mergeProjectedBinding (binding: ActiveRunBindingRecord) (projected: ActiveRunBindingRecord) =
                let mergedConts =
                    let set = HashSet<string>(binding.continuationMessageIds)
                    for c in continuations do set.Add c |> ignore
                    for c in projected.continuationMessageIds do set.Add c |> ignore
                    Array.ofSeq set

                { binding with
                    authorityRootUserMessageId = projected.authorityRootUserMessageId
                    physicalUserMessageId =
                        binding.physicalUserMessageId |> Option.orElse projected.physicalUserMessageId
                    continuationMessageIds = mergedConts
                    role = binding.role |> Option.orElse projected.role
                    inheritedAuthorityOwner =
                        projected.inheritedAuthorityOwner
                        |> Option.orElse binding.inheritedAuthorityOwner }

            let mergeBindings (explicitBinding: ActiveRunBindingRecord option) (projected: ActiveRunBindingRecord option) =
                match explicitBinding, projected with
                | Some binding, Some proj -> Some (mergeProjectedBinding binding proj)
                | Some binding, None ->
                    let mergedConts =
                        let set = HashSet<string>(binding.continuationMessageIds)
                        for c in continuations do set.Add c |> ignore
                        Array.ofSeq set
                    Some { binding with continuationMessageIds = mergedConts }
                | None, Some proj ->
                    let mergedConts =
                        let set = HashSet<string>(proj.continuationMessageIds)
                        for c in continuations do set.Add c |> ignore
                        Array.ofSeq set
                    Some { proj with continuationMessageIds = mergedConts }
                | None, None -> None

            let resolvedOpt =
                match summaryOpt with
                | None -> fromExplicit ()
                | Some proj -> mergeBindings (fromExplicit ()) (projectedBinding proj)

            match resolvedOpt with
            | Some r -> BindingInternal.recordToObj r
            | None -> null

    member _.tryPhysicalUserMessage(sessionId: obj) : obj =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> null
        | Some key ->
            let fromActive =
                match activeBindings.TryGetValue key with
                | true, binding -> binding.physicalUserMessageId
                | false, _ -> None

            match fromActive with
            | Some phys -> box phys
            | None ->
                match userMessageBindings.TryGetValue key with
                | true, bound -> box bound
                | false, _ -> null

    member _.clearSession(sessionId: obj) : bool =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> false
        | Some key ->
            userMessageBindings.Remove key |> ignore
            activeBindings.Remove key |> ignore
            continuationMessageIds.Remove key |> ignore
            true

    member _.getUserMessageBinding(sessionId: obj) : obj =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> null
        | Some key ->
            match userMessageBindings.TryGetValue key with
            | true, bound -> box bound
            | false, _ -> null

    member _.getContinuationMessageIds(sessionId: obj) : string array =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> [||]
        | Some key ->
            match continuationMessageIds.TryGetValue key with
            | true, set -> Array.ofSeq set
            | false, _ -> [||]

    member _.getActiveBinding(sessionId: obj) : obj =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> null
        | Some key ->
            match activeBindings.TryGetValue key with
            | true, binding -> BindingInternal.recordToObj binding
            | false, _ -> null

    member _.allUserMessageBindings() : obj array =
        let list = ResizeArray<obj>()
        for kv in userMessageBindings do
            list.Add(createObj [ "sessionId" ==> kv.Key; "physical" ==> kv.Value ])
        list.ToArray()

    member _.snapshot(sessionId: obj) : obj =
        let sidOpt = BindingInternal.parseString sessionId
        match sidOpt with
        | None -> null
        | Some key ->
            let userPhys =
                match userMessageBindings.TryGetValue key with
                | true, bound -> box bound
                | false, _ -> null
            let activeObj =
                match activeBindings.TryGetValue key with
                | true, b -> BindingInternal.recordToObj b
                | false, _ -> null
            let conts =
                match continuationMessageIds.TryGetValue key with
                | true, s -> box (Array.ofSeq s)
                | false, _ -> box [||]
            createObj
                [ "sessionId" ==> key
                  "userMessageBinding" ==> userPhys
                  "activeBinding" ==> activeObj
                  "continuationMessageIds" ==> conts ]
            |> BindingInternal.freeze

    member _.clearAll() : unit =
        userMessageBindings.Clear()
        activeBindings.Clear()
        continuationMessageIds.Clear()

let turnBindingStore = TurnBindingStore()
