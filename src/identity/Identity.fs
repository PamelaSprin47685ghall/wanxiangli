namespace Wanxiangli.Identity

open System
open Fable.Core
open Fable.Core.JsInterop

/// wanxiangli/identity 公开入口。无状态目录对象：角色词汇、身份解析、
/// 来源鉴别（D-01）与物理执行绑定的纯合同都从这里进入；JS 边界只收发 plain data。
[<AttachMembers>]
type Identity() =

    let labelOrNull (role: Role option): obj =
        match role with
        | Some value -> box (Roles.roleLabel value)
        | None -> null

    let identityResult (result: Result<ParticipantIdentityEvidence, ParticipantIdentityError>): obj =
        match result with
        | Ok evidence -> createObj [ "ok", box true; "evidence", ParticipantIdentity.toView evidence ]
        | Error error -> ParticipantIdentity.errorView error

    /// 已记录证据（owner 见证）的校验：解码 + restoreRecorded。
    let recorded (view: obj): Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        ParticipantIdentity.decodeInput view |> Result.bind ParticipantIdentity.restoreRecorded

    /// 活跃角色标签，按目录顺序。
    member _.activeRoleLabels(): string array = Roles.active |> List.map Roles.roleLabel |> List.toArray

    /// 已退役、只供历史解码的角色标签。
    member _.historicalRoleLabels(): string array = Roles.historical |> List.map Roles.roleLabel |> List.toArray

    /// 内部角色判定（Advisor、Distiller）；非角色标签返回 false。
    member _.isInternalRole(label: obj): bool =
        Wire.isString label
        && (match Roles.tryParseHistoricalRole(unbox<string> label) with
            | Some role -> Roles.isInternal role
            | None -> false)

    /// 历史/废弃参与者名（不含下划线复合名规则）。
    member _.legacyNames(): string array = ParticipantIdentity.legacyNames |> List.toArray

    /// 历史/废弃参与者名判定（大小写不敏感，含下划线复合名）。
    member _.isLegacyName(name: obj): bool =
        Wire.isString name && ParticipantIdentity.isLegacyName((unbox<string> name).ToLowerInvariant())

    /// 活跃角色解析（participant-identity-010）：仅六个活跃角色；历史角色、
    /// 内部槽位名与非字符串输入一律 null。
    member _.tryParseRole(label: obj): obj =
        if Wire.isString label then labelOrNull (Roles.tryParseRole(unbox<string> label)) else null

    /// 历史角色解码：活跃 + 历史 11 个角色，供历史事件/日志解码边界。
    member _.tryParseHistoricalRole(label: obj): obj =
        if Wire.isString label then labelOrNull (Roles.tryParseHistoricalRole(unbox<string> label)) else null

    /// 角色 → Persona（V1 目录），接受活跃与历史角色。
    member _.personaOfRole(label: obj): obj =
        if not (Wire.isString label) then null
        else
            match Roles.tryParseHistoricalRole(unbox<string> label) with
            | Some role -> box (PersonaCatalog.personaV1 role)
            | None -> null

    /// Bookkeeper 内部槽位的目录人格。
    member _.bookkeeperPersona(): string = PersonaCatalog.bookkeeperPersonaV1

    /// persona 标签解码为规范拼写（含历史别名 DirectorV1）；未知返回 null。
    member _.tryParsePersona(label: obj): obj =
        if not (Wire.isString label) then null
        else
            match Persona.tryParse(unbox<string> label) with
            | Some persona -> box (Persona.render persona)
            | None -> null

    /// 根选定身份：成功返回 { ok, evidence }，失败返回 { error, detail? | expected, actual }。
    member _.resolveAtRoot(name: obj): obj =
        if not (Wire.isString name) then ParticipantIdentity.errorView ParticipantIdentityError.BlankParticipantName
        else identityResult (ParticipantIdentity.resolveAtRoot(unbox<string> name))

    /// 继承身份：子参与者沿用所有者的 persona 与目录版本。owner 是本库先前产出的
    /// 证据视图，经 restoreRecorded 完整校验后才被采信。
    member _.inheritFromOwner(name: obj, owner: obj): obj =
        if not (Wire.isString name) then ParticipantIdentity.errorView ParticipantIdentityError.BlankParticipantName
        else
            match recorded owner with
            | Error ownerError -> ParticipantIdentity.errorView ownerError
            | Ok ownerEvidence -> identityResult (ParticipantIdentity.inheritFromOwner (unbox<string> name) ownerEvidence)

    /// 重水化：对既有身份输入做完整校验。owner 为 null 时，
    /// InheritedFromOwner 输入必须被拒绝（OwnerRequired）；owner 视图本身无效时按其错误拒绝。
    member _.rehydrate(owner: obj, input: obj): obj =
        let ownerEvidence =
            if Wire.isNullOrUndefined owner then Ok None
            else recorded owner |> Result.map Some

        match ownerEvidence with
        | Error error -> ParticipantIdentity.errorView error
        | Ok ownerOption ->
            ParticipantIdentity.decodeInput input
            |> Result.bind (ParticipantIdentity.rehydrate ownerOption)
            |> identityResult

    /// 已记录证据的恢复：见 ParticipantIdentity.restoreRecorded。
    member _.restoreRecorded(input: obj): obj = identityResult (recorded input)

    /// D-01 来源鉴别：成功返回 { ok: true, origin }，
    /// 失败返回 { error: 'UnknownPromptOrigin', reason }。不存在 human 回退分支。
    member _.classifyOrigin(raw: obj): obj =
        match PromptOrigin.classify raw with
        | Ok origin -> createObj [ "ok", box true; "origin", PromptOrigin.toView origin ]
        | Error(OriginRejection.UnknownPromptOrigin reason) ->
            createObj [ "error", box "UnknownPromptOrigin"; "reason", box reason ]

    /// 建立物理执行绑定。输入为 plain 对象 { sessionId, physicalUserMessageId,
    /// role, evidence, modelTarget, capacityFence }；evidence 经完整校验。
    member _.bindExecution(input: obj): obj =
        match ExecutionBinding.bind input with
        | Ok binding -> createObj [ "ok", box true; "binding", ExecutionBinding.toView binding ]
        | Error error -> ExecutionBinding.errorView error

    /// 模型目标重绑：只改 modelTarget/capacityFence，身份证据逐字段保持原值。
    member _.rebindTarget(binding: obj, target: obj): obj =
        match ExecutionBinding.rehydrate binding with
        | Error error -> ExecutionBinding.errorView error
        | Ok original ->
            match ExecutionBinding.rebindTarget original target with
            | Ok rebound -> createObj [ "ok", box true; "binding", ExecutionBinding.toView rebound ]
            | Error error -> ExecutionBinding.errorView error
