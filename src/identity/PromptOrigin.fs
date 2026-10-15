namespace Wanxiangli.Identity

open System
open Fable.Core
open Fable.Core.JsInterop

/// 已验证的提示来源。只有这四类；未知输入一律拒绝，绝不回退 human。
[<RequireQualifiedAccess>]
type VerifiedPromptOrigin =
    | HumanRoot of participant: string
    | AgentOwnerRoot of ownerLogicalRun: string * childLogicalRun: string * childParticipant: string
    | HostInternal
    | Continuation of kind: string

[<RequireQualifiedAccess>]
type OriginRejection =
    | UnknownPromptOrigin of reason: string

/// D-01：来源鉴别。缺失或未知来源的入站请求必须被拒绝，
/// 不得静默归为人类，也不得把物理模型重绑混同为身份变更。
module PromptOrigin =

    /// Continuation 的闭合词汇（与宿主主仓一致）。
    let continuationKinds: string list =
        [ "InteractionRepair"; "JoinGuard"; "ProviderRetryAttempt"
          "ModelTargetRebind"; "CapacityFence"; "SessionResume"
          "SessionRevival"; "PrefixCompaction"; "FissionContinuation"; "SphinxRound" ]

    let private requiredString (raw: obj) (key: string) (what: string): Result<string, OriginRejection> =
        match Wire.string raw key with
        | Some value -> Ok value
        | None -> Error(OriginRejection.UnknownPromptOrigin $"missing %s{what}")

    /// 分类原始来源输入。任何缺失、非字符串、未知词汇一律 UnknownPromptOrigin；
    /// 不存在产出 human 的回退分支。
    let classify (raw: obj): Result<VerifiedPromptOrigin, OriginRejection> =
        if not (Wire.isPlainObject raw) then
            Error(OriginRejection.UnknownPromptOrigin "expected a plain object")
        else
            match Wire.string raw "kind" with
            | None -> Error(OriginRejection.UnknownPromptOrigin "missing kind")
            | Some kind ->
                match kind with
                | "human-root" ->
                    // interaction-authority-006：human-root 必须携带 participant 证明。
                    requiredString raw "participant" "participant proof for human-root"
                    |> Result.map (fun participant -> VerifiedPromptOrigin.HumanRoot participant)
                | "agent-owner-root" ->
                    // owner-derived-008：owner 与 child 的 logical run 及 child 参与者缺一不可。
                    match requiredString raw "ownerLogicalRun" "ownerLogicalRun for agent-owner-root" with
                    | Error rejection -> Error rejection
                    | Ok ownerLogicalRun ->
                        match requiredString raw "childLogicalRun" "childLogicalRun for agent-owner-root" with
                        | Error rejection -> Error rejection
                        | Ok childLogicalRun ->
                            match requiredString raw "childParticipant" "childParticipant for agent-owner-root" with
                            | Error rejection -> Error rejection
                            | Ok childParticipant ->
                                Ok(VerifiedPromptOrigin.AgentOwnerRoot(ownerLogicalRun, childLogicalRun, childParticipant))
                | "host-internal" -> Ok VerifiedPromptOrigin.HostInternal
                | "continuation" ->
                    match Wire.string raw "continuationKind" with
                    | None -> Error(OriginRejection.UnknownPromptOrigin "missing continuationKind for continuation")
                    | Some continuationKind ->
                        if List.contains continuationKind continuationKinds then
                            Ok(VerifiedPromptOrigin.Continuation continuationKind)
                        else
                            Error(OriginRejection.UnknownPromptOrigin $"unknown continuationKind: %s{continuationKind}")
                | other ->
                    Error(OriginRejection.UnknownPromptOrigin $"unknown kind: %s{other}")

    /// 已验证来源的 plain 投影。
    let toView (origin: VerifiedPromptOrigin): obj =
        match origin with
        | VerifiedPromptOrigin.HumanRoot participant ->
            createObj [ "kind", box "human-root"; "participant", box participant ]
        | VerifiedPromptOrigin.AgentOwnerRoot (ownerLogicalRun, childLogicalRun, childParticipant) ->
            createObj [
                "kind", box "agent-owner-root"
                "ownerLogicalRun", box ownerLogicalRun
                "childLogicalRun", box childLogicalRun
                "childParticipant", box childParticipant
            ]
        | VerifiedPromptOrigin.HostInternal ->
            createObj [ "kind", box "host-internal" ]
        | VerifiedPromptOrigin.Continuation kind ->
            createObj [ "kind", box "continuation"; "continuationKind", box kind ]
