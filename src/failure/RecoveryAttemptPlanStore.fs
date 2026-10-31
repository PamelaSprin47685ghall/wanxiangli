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

let private removeKeysWithPrefix (dictionary: Dictionary<string, 'T>) (prefix: string) : unit =
    let keys =
        dictionary.Keys
        |> Seq.filter (fun key -> key.StartsWith(prefix, StringComparison.Ordinal))
        |> Seq.toArray

    for key in keys do
        dictionary.Remove key |> ignore

/// 进程内 attempt 计划与恢复干预自治存储（RecoveryAttemptPlanStore）。
/// 独占拥有 pendingAttemptPlans、attemptPlans、manualChatInterventions 三个私有字典。
/// 封装:
/// - key 拼接 sessionId + "\u001F" + id
/// - 准入幂等重放与冲突检测（FreezePending）
/// - providerRun 绑定（TryBindAttemptPlan 只读已有 pending；BindAttemptPlan 在启动边界总能给出 plan）
/// - ConsumeAttemptPlan 原子移除 attemptPlans 与对应 pendingAttemptPlans
/// - ManualIntervention 增删查
/// - ClearSession 与 ClearAttemptPlansFor 前缀清理
[<AttachMembers>]
type RecoveryAttemptPlanStore() =
    let pendingAttemptPlans = Dictionary<string, obj>()
    let attemptPlans = Dictionary<string, BoundPlanEntry>()
    let manualChatInterventions = Dictionary<string, obj>()

    [<Literal>]
    let separator = "\u001F"

    let physicalPlanKey (sessionId: string) (physicalUserMessageId: string) =
        sessionId + separator + physicalUserMessageId

    let providerPlanKey (sessionId: string) (providerRun: string) =
        sessionId + separator + providerRun

    let interventionKey (sessionId: string) (physicalUserMessageId: string) =
        sessionId + separator + physicalUserMessageId

    let bind (provKey: string) (physicalUserMessageId: string) (bound: obj) : obj =
        attemptPlans.[provKey] <-
            { Plan = bound
              PhysicalUserMessageId = physicalUserMessageId }

        bound

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
    ///    - 若有 pending 则通过 bindFn(pending) 生成 boundPlan 并存入。
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
            | true, pending -> bind provKey physicalUserMessageId (bindFn pending)

    /// provider 启动边界的绑定：总给出这次 run 的 plan，不拒收。
    /// 已有同 physical 的绑定则重放；否则取该 physical 的 pending，没有 pending
    /// 就用调用方从 durable 受理事实重建的 ordinary 计划。进程内缓存只是缓存，
    /// 缺了不等于这次 run 不存在。Host 亲口说出的 run→physical 关系优先于
    /// 旧绑定，所以 run 已绑到别的 physical 时改绑到本次观察。
    member this.BindAttemptPlan
        (
            sessionId: string,
            physicalUserMessageId: string,
            providerRun: string,
            bindFn: obj -> obj,
            ordinary: obj
        ) : obj =
        let provKey = providerPlanKey sessionId providerRun
        match attemptPlans.TryGetValue provKey with
        | true, established when established.PhysicalUserMessageId = physicalUserMessageId -> established.Plan
        | _ ->
            let pending =
                match pendingAttemptPlans.TryGetValue(physicalPlanKey sessionId physicalUserMessageId) with
                | true, pending -> pending
                | false, _ -> ordinary

            bind provKey physicalUserMessageId (bindFn pending)

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
        manualChatInterventions.[key] <- request

    member _.ManualInterventions() : obj array =
        manualChatInterventions.Values |> Seq.toArray

    member _.RevokeManualIntervention(sessionId: string, physicalUserMessageId: string) : unit =
        let key = interventionKey sessionId physicalUserMessageId
        manualChatInterventions.Remove key |> ignore

    /// 会话前缀清理：清除该 session 的所有 attemptPlans 与 pendingAttemptPlans，
    /// 并清除 manualChatInterventions 中属于该 sessionId 的所有条目。
    member this.ClearSession(sessionId: string) : unit =
        this.ClearAttemptPlansFor sessionId
        removeKeysWithPrefix manualChatInterventions (sessionId + separator)

    /// 清除所有以 keyPrefix + "\u001F" 开头的 attemptPlans 与 pendingAttemptPlans 条目。
    member _.ClearAttemptPlansFor(keyPrefix: string) : unit =
        let prefix = keyPrefix + separator
        removeKeysWithPrefix attemptPlans prefix
        removeKeysWithPrefix pendingAttemptPlans prefix

    /// 诊断快照（不暴露内部字典，供测试/度量用）
    member _.Snapshot() =
        createObj
            [ "pendingCount" ==> pendingAttemptPlans.Count
              "boundCount" ==> attemptPlans.Count
              "interventionCount" ==> manualChatInterventions.Count ]

let recoveryAttemptPlanStore = RecoveryAttemptPlanStore()
