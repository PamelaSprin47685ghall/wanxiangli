module Wanxiangli.Failure.RecoveryAttemptPlanStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<RequireQualifiedAccess>]
module AdmissionKind =
    [<Literal>]
    let Admitted = "Admitted"
    [<Literal>]
    let ReplayedExisting = "ReplayedExisting"
    [<Literal>]
    let IdentityMismatch = "IdentityMismatch"
    [<Literal>]
    let PlanConflict = "PlanConflict"

type BoundPlanEntry =
    { Plan: obj
      PhysicalUserMessageId: string }

/// 进程内 attempt 计划与恢复干预自治存储（RecoveryAttemptPlanStore）。
/// 独占拥有 pendingAttemptPlans、attemptPlans、manualChatInterventions 三个私有字典。
/// 封装:
/// - key 拼接 sessionId + "\u001F" + id
/// - 准入幂等重放与冲突检测（FreezePending）
/// - providerRun 绑定与跨 physical 改绑抛错（BindProviderRun / TryBindAttemptPlan）
/// - ConsumeAttemptPlan 原子移除 attemptPlans 与对应 pendingAttemptPlans
/// - ManualIntervention 增删查
/// - ClearSession 与 ClearAttemptPlansFor 前缀清理
[<AttachMembers>]
type RecoveryAttemptPlanStore() =
    let pendingAttemptPlans = Dictionary<string, obj>()
    let attemptPlans = Dictionary<string, BoundPlanEntry>()
    let manualChatInterventions = Dictionary<string, obj * string>()

    [<Literal>]
    let separator = "\u001F"

    let physicalPlanKey (sessionId: string) (physicalUserMessageId: string) =
        sessionId + separator + physicalUserMessageId

    let providerPlanKey (sessionId: string) (providerRun: string) =
        sessionId + separator + providerRun

    let interventionKey (sessionId: string) (physicalUserMessageId: string) =
        sessionId + separator + physicalUserMessageId

    /// 冻结 pre-inference attempt 计划。
    /// 校验 plan 归属 sessionId 与 physicalUserMessageId，若不匹配返回 IdentityMismatch；
    /// 若已有条目且相等返回 ReplayedExisting；若已有但不相等返回 PlanConflict；若无则存入并返回 Admitted。
    member _.FreezePending
        (
            sessionId: string,
            physicalUserMessageId: string,
            planSessionId: string,
            planPhysicalUserMessageId: string,
            plan: obj,
            ?isEqual: obj -> obj -> bool
        ) : obj =
        if planSessionId <> sessionId || planPhysicalUserMessageId <> physicalUserMessageId then
            createObj
                [ "kind" ==> AdmissionKind.IdentityMismatch
                  "expectedSession" ==> sessionId
                  "expectedPhysical" ==> physicalUserMessageId
                  "attempted" ==> plan ]
        else
            let key = physicalPlanKey sessionId physicalUserMessageId
            match pendingAttemptPlans.TryGetValue key with
            | true, existing ->
                let eq =
                    match isEqual with
                    | Some f -> f existing plan
                    | None -> obj.Equals(existing, plan)

                if eq then
                    createObj
                        [ "kind" ==> AdmissionKind.ReplayedExisting
                          "existing" ==> existing ]
                else
                    createObj
                        [ "kind" ==> AdmissionKind.PlanConflict
                          "existing" ==> existing
                          "attempted" ==> plan ]
            | false, _ ->
                pendingAttemptPlans.[key] <- plan
                createObj
                    [ "kind" ==> AdmissionKind.Admitted
                      "plan" ==> plan ]

    member _.TryPending(sessionId: string, physicalUserMessageId: string) : obj =
        let key = physicalPlanKey sessionId physicalUserMessageId
        match pendingAttemptPlans.TryGetValue key with
        | true, plan -> plan
        | false, _ -> null

    /// 直接绑定或重放 providerRun 下的 attemptPlan。
    /// 若已有相同 physicalUserMessageId 则幂等返回已存在的 plan；
    /// 若已有但绑定了不同的 physicalUserMessageId 则抛出 InvalidOperationException（包含 HOST-BOUNDARY-008 标记）；
    /// 若不存在则存入并返回传入的 plan。
    member _.BindProviderRun
        (
            sessionId: string,
            providerRun: string,
            physicalUserMessageId: string,
            plan: obj
        ) : obj =
        let key = providerPlanKey sessionId providerRun
        match attemptPlans.TryGetValue key with
        | true, established ->
            if established.PhysicalUserMessageId = physicalUserMessageId then
                established.Plan
            else
                raise (
                    InvalidOperationException(
                        sprintf
                            "HOST-BOUNDARY-008: cannot re-bind provider run %s to different physical user message %s"
                            providerRun
                            physicalUserMessageId
                    )
                )
        | false, _ ->
            attemptPlans.[key] <-
                { Plan = plan
                  PhysicalUserMessageId = physicalUserMessageId }
            plan

    /// 尝试读取已绑定的 attemptPlan（peek，不移除，保持存活）。
    member _.TryAttemptPlan(sessionId: string, providerRun: string) : obj =
        let key = providerPlanKey sessionId providerRun
        match attemptPlans.TryGetValue key with
        | true, established -> established.Plan
        | false, _ -> null

    /// 绑定或重放流程：
    /// 1. 若 attemptPlans 已存在：
    ///    - 相同 physicalUserMessageId 则重放返回；
    ///    - 不同 physicalUserMessageId 则返回 null（调用方表示无法绑定）；
    /// 2. 若不存在，在 pendingAttemptPlans 中查找：
    ///    - 若无 pending 则返回 null；
    ///    - 若有 pending 则通过 bindFn(pending) 生成 boundPlan 并经 BindProviderRun 存入。
    member this.TryBindAttemptPlan
        (
            sessionId: string,
            physicalUserMessageId: string,
            providerRun: string,
            bindFn: obj -> obj
        ) : obj =
        let provKey = providerPlanKey sessionId providerRun
        match attemptPlans.TryGetValue provKey with
        | true, established ->
            if established.PhysicalUserMessageId = physicalUserMessageId then
                established.Plan
            else
                null
        | false, _ ->
            let pendKey = physicalPlanKey sessionId physicalUserMessageId
            match pendingAttemptPlans.TryGetValue pendKey with
            | false, _ -> null
            | true, pending ->
                let bound = bindFn pending
                this.BindProviderRun(sessionId, providerRun, physicalUserMessageId, bound)

    /// 单次消费 attemptPlan：终态对齐时调用。
    /// 原子移除 attemptPlans 中的对应条目，并同时移除 pendingAttemptPlans 中对应 (sessionId, physicalUserMessageId) 条目。
    /// 返回被消费的 plan；若不存在返回 null。
    member _.ConsumeAttemptPlan(sessionId: string, providerRun: string) : obj =
        let provKey = providerPlanKey sessionId providerRun
        match attemptPlans.TryGetValue provKey with
        | true, established ->
            attemptPlans.Remove provKey |> ignore
            let pendKey = physicalPlanKey sessionId established.PhysicalUserMessageId
            pendingAttemptPlans.Remove pendKey |> ignore
            established.Plan
        | false, _ ->
            null

    member _.PublishManualIntervention(sessionId: string, physicalUserMessageId: string, request: obj) : unit =
        let key = interventionKey sessionId physicalUserMessageId
        manualChatInterventions.[key] <- (request, sessionId)

    member _.ManualInterventions() : obj array =
        manualChatInterventions.Values
        |> Seq.map fst
        |> Seq.toArray

    member _.RevokeManualIntervention(sessionId: string, physicalUserMessageId: string) : unit =
        let key = interventionKey sessionId physicalUserMessageId
        manualChatInterventions.Remove key |> ignore

    /// 会话前缀清理：清除该 session 的所有 attemptPlans 与 pendingAttemptPlans，
    /// 并清除 manualChatInterventions 中属于该 sessionId 的所有条目。
    member this.ClearSession(sessionId: string) : unit =
        this.ClearAttemptPlansFor sessionId

        let toRemove =
            manualChatInterventions
            |> Seq.choose (fun (KeyValue(key, (_, sid))) -> if sid = sessionId then Some key else None)
            |> Seq.toArray

        for key in toRemove do
            manualChatInterventions.Remove key |> ignore

    /// 清除所有以 keyPrefix + "\u001F" 开头的 attemptPlans 与 pendingAttemptPlans 条目。
    member _.ClearAttemptPlansFor(keyPrefix: string) : unit =
        let prefix = keyPrefix + separator

        let provKeys =
            attemptPlans.Keys
            |> Seq.filter (fun k -> k.StartsWith(prefix, StringComparison.Ordinal))
            |> Seq.toArray

        for k in provKeys do
            attemptPlans.Remove k |> ignore

        let pendKeys =
            pendingAttemptPlans.Keys
            |> Seq.filter (fun k -> k.StartsWith(prefix, StringComparison.Ordinal))
            |> Seq.toArray

        for k in pendKeys do
            pendingAttemptPlans.Remove k |> ignore

    /// 诊断快照（不暴露内部字典，供测试/度量用）
    member _.Snapshot() =
        createObj
            [ "pendingCount" ==> pendingAttemptPlans.Count
              "boundCount" ==> attemptPlans.Count
              "interventionCount" ==> manualChatInterventions.Count ]

let recoveryAttemptPlanStore = RecoveryAttemptPlanStore()
