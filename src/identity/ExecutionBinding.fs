namespace Wanxiangli.Identity

open System
open Fable.Core
open Fable.Core.JsInterop

[<RequireQualifiedAccess>]
type ExecutionBindingError =
    | MissingBindingField of field: string
    | RoleNotActive of role: string
    | IdentityMismatch of error: ParticipantIdentityError

/// 物理执行绑定：会话/消息的物理落点、执行角色、模型目标与容量围栏。
/// 稳定的参与者身份（ParticipantIdentityEvidence）在此只是只读证据；
/// 换模型、换租约不改变身份，身份变更也不得伪装成重绑（D-01）。
type ExecutionBinding =
    private
        { SessionId: string
          PhysicalUserMessageId: string
          Role: Role
          Evidence: ParticipantIdentityEvidence
          ModelTarget: string
          CapacityFence: string }

[<RequireQualifiedAccess>]
module ExecutionBinding =

    let private requiredString (raw: obj) (key: string): Result<string, ExecutionBindingError> =
        match Wire.string raw key with
        | Some value -> Ok value
        | None -> Error(ExecutionBindingError.MissingBindingField key)

    /// 建立绑定。输入为 plain 对象 { sessionId, physicalUserMessageId, role,
    /// evidence, modelTarget, capacityFence }；role 必须是活跃角色，
    /// evidence 必须先经完整重水化校验，且其身份角色与绑定角色一致。
    let bind (input: obj): Result<ExecutionBinding, ExecutionBindingError> =
        if not (Wire.isPlainObject input) then
            Error(ExecutionBindingError.MissingBindingField "sessionId")
        else
            let rawRole = Wire.get input "role"
            let rawEvidence = Wire.get input "evidence"

            match requiredString input "sessionId" with
            | Error error -> Error error
            | Ok sessionId ->
                match requiredString input "physicalUserMessageId" with
                | Error error -> Error error
                | Ok physicalUserMessageId ->
                    match Wire.string input "role" with
                    | None -> Error(ExecutionBindingError.MissingBindingField "role")
                    | Some roleLabel ->
                        match Roles.tryParseRole roleLabel with
                        | None -> Error(ExecutionBindingError.RoleNotActive roleLabel)
                        | Some role ->
                            // 身份 evidence 缺失或非对象先按缺字段拒绝，不落入身份校验错误。
                            if not (Wire.isPlainObject rawEvidence) then
                                Error(ExecutionBindingError.MissingBindingField "evidence")
                            else
                                // 身份证据必须重新完整校验：外部传入的 plain 视图不可信任。
                                match ParticipantIdentity.rehydrate None rawEvidence with
                                | Error identityError -> Error(ExecutionBindingError.IdentityMismatch identityError)
                                | Ok evidence ->
                                    match ParticipantIdentity.roleOf evidence with
                                    | Some evidenceRole when evidenceRole = role ->
                                        match requiredString input "modelTarget" with
                                        | Error error -> Error error
                                        | Ok modelTarget ->
                                            match requiredString input "capacityFence" with
                                            | Error error -> Error error
                                            | Ok capacityFence ->
                                                Ok
                                                    { SessionId = sessionId
                                                      PhysicalUserMessageId = physicalUserMessageId
                                                      Role = role
                                                      Evidence = evidence
                                                      ModelTarget = modelTarget
                                                      CapacityFence = capacityFence }
                                    | _ ->
                                        Error(ExecutionBindingError.IdentityMismatch(ParticipantIdentityError.RoleMismatch(expected = Some role, actual = ParticipantIdentity.roleOf evidence)))

    /// 模型目标重绑：只改 ModelTarget 与 CapacityFence，身份证据逐字段保持原值。
    let rebindTarget (binding: ExecutionBinding) (target: obj): Result<ExecutionBinding, ExecutionBindingError> =
        match requiredString target "modelTarget" with
        | Error error -> Error error
        | Ok modelTarget ->
            match requiredString target "capacityFence" with
            | Error error -> Error error
            | Ok capacityFence ->
                Ok
                    { binding with
                        ModelTarget = modelTarget
                        CapacityFence = capacityFence }

    /// 从 plain 视图恢复绑定：所有字段与身份证据全部重新校验（防篡改）。
    let rehydrate (view: obj): Result<ExecutionBinding, ExecutionBindingError> =
        bind view

    let toView (binding: ExecutionBinding): obj =
        createObj [
            "sessionId", box binding.SessionId
            "physicalUserMessageId", box binding.PhysicalUserMessageId
            "role", box (Roles.roleLabel binding.Role)
            "evidence", ParticipantIdentity.toView binding.Evidence
            "modelTarget", box binding.ModelTarget
            "capacityFence", box binding.CapacityFence
        ]

    let errorView (error: ExecutionBindingError): obj =
        match error with
        | ExecutionBindingError.MissingBindingField field ->
            createObj [ "error", box "MissingBindingField"; "detail", box field ]
        | ExecutionBindingError.RoleNotActive role ->
            createObj [ "error", box "RoleNotActive"; "detail", box role ]
        | ExecutionBindingError.IdentityMismatch identityError -> ParticipantIdentity.errorView identityError
