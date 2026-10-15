namespace Wanxiangli.Identity

open System
open Fable.Core
open Fable.Core.JsInterop

/// wanxiangli/identity 公开入口。无状态目录对象：角色词汇、身份解析、
/// 来源鉴别（D-01）与物理执行绑定的纯合同都从这里进入；JS 边界只收发 plain data。
[<AttachMembers>]
type Identity() =

    /// 活跃角色解析（participant-identity-010）：仅六个活跃角色；历史角色、
    /// 内部槽位名与非字符串输入一律 null。
    member _.tryParseRole(label: obj): obj =
        if Wire.isString label then
            match Roles.tryParseRole(unbox<string> label) with
            | Some role -> box (Roles.roleLabel role)
            | None -> null
        else
            null

    /// 历史角色解码：活跃 + 历史 11 个角色，供历史事件/日志解码边界。
    member _.tryParseHistoricalRole(label: obj): obj =
        if Wire.isString label then
            match Roles.tryParseHistoricalRole(unbox<string> label) with
            | Some role -> box (Roles.roleLabel role)
            | None -> null
        else
            null

    /// 角色 → Persona（V1 目录）。
    member this.personaOfRole(label: obj): obj =
        if not (Wire.isString label) then null
        else
            match Roles.tryParseHistoricalRole(unbox<string> label) with
            | Some role -> box (PersonaCatalog.personaV1 role)
            | None -> null

    /// 根选定身份：成功返回 { name, role, persona, catalogVersion, origin }，
    /// 失败返回 { error, detail? }。
    member _.resolveAtRoot(name: obj): obj =
        if not (Wire.isString name) then ParticipantIdentity.errorView ParticipantIdentityError.BlankParticipantName
        else
            match ParticipantIdentity.resolveAtRoot(unbox<string> name) with
            | Ok evidence -> createObj [ "ok", box true; "evidence", ParticipantIdentity.toView evidence ]
            | Error error -> ParticipantIdentity.errorView error

    /// 继承身份：子参与者沿用所有者的 persona 与目录版本。
    /// owner 必须是 resolveAtRoot/inheritFromOwner 的成功结果（plain 视图），
    /// 并经完整重水化校验。
    member _.inheritFromOwner(name: obj, owner: obj): obj =
        if not (Wire.isString name) then ParticipantIdentity.errorView ParticipantIdentityError.BlankParticipantName
        else
            match ParticipantIdentity.rehydrate None owner with
            | Error ownerError -> ParticipantIdentity.errorView ownerError
            | Ok ownerEvidence ->
                match ParticipantIdentity.inheritFromOwner(unbox<string> name) ownerEvidence with
                | Ok evidence -> createObj [ "ok", box true; "evidence", ParticipantIdentity.toView evidence ]
                | Error error -> ParticipantIdentity.errorView error

    /// 重水化：对既有身份输入做完整校验。owner 为 null 时，
    /// InheritedFromOwner 输入必须被拒绝（OwnerRequired）。
    member _.rehydrate(owner: obj, input: obj): obj =
        let ownerEvidence =
            if Wire.isPlainObject owner then
                match ParticipantIdentity.rehydrate None owner with
                | Ok evidence -> Some evidence
                | Error _ -> None
            else
                None

        match ParticipantIdentity.rehydrate ownerEvidence input with
        | Ok evidence -> createObj [ "ok", box true; "evidence", ParticipantIdentity.toView evidence ]
        | Error error -> ParticipantIdentity.errorView error

    /// D-01 来源鉴别：成功返回 { ok: true, origin }，
    /// 失败返回 { error: 'UnknownPromptOrigin', reason }。不存在 human 回退分支。
    member _.classifyOrigin(raw: obj): obj =
        match PromptOrigin.classify raw with
        | Ok origin -> createObj [ "ok", box true; "origin", PromptOrigin.toView origin ]
        | Error(OriginRejection.UnknownPromptOrigin reason) ->
            createObj [ "error", box "UnknownPromptOrigin"; "reason", box reason ]

    /// 建立物理执行绑定。输入为 plain 对象 { sessionId, physicalUserMessageId,
    /// role, evidence, modelTarget, capacityFence }；evidence 经完整重水化校验。
    member _.bindExecution(input: obj): obj =
        match ExecutionBinding.bind input with
        | Ok binding -> createObj [ "ok", box true; "binding", ExecutionBinding.toView binding ]
        | Error error -> ExecutionBinding.errorView error

    /// 模型目标重绑：只改 modelTarget/capacityFence，身份证据逐字段保持原值。
    /// 输入 binding 为 bindExecution 成功返回的 plain 视图；任何篡改都会在
    /// 完整重水化时被拒绝。
    member _.rebindTarget(binding: obj, target: obj): obj =
        match ExecutionBinding.rehydrate binding with
        | Error error -> ExecutionBinding.errorView error
        | Ok original ->
            match ExecutionBinding.rebindTarget original target with
            | Ok rebound -> createObj [ "ok", box true; "binding", ExecutionBinding.toView rebound ]
            | Error error -> ExecutionBinding.errorView error
