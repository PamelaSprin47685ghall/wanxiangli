module Wanxiangli.HandleLifecycle.JoinAttemptRegistry

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (ArgumentException(sprintf "wanxiangli/handle-lifecycle: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

type private JoinLeaseRecord =
    { TargetSessionId: string
      AttemptId: string
      mutable Woken: bool
      mutable WokenReason: string option
      mutable WokenMessageId: string option }

/// 进程内 Join 租约与唤醒自治注册表（Package-08）。
/// 独占拥有租约字典 active 与可见消息去重集合 visibleMessages；
/// 严格保持纯状态自治与领域事实判定：
/// - acquire: 独占租约判定，已占用返回 AlreadyAcquired 冲突事实
/// - release: 幂等注销租约
/// - signalVisibleUserMessage: 消息去重，无租约只记去重不入唤醒，有租约立即产生唤醒事实
/// - clearSession: 按目标会话隔离排空租约与消息
/// 严禁引入 Task/TaskCompletionSource/取消令牌等宿主异步运行时设施。
[<AttachMembers>]
type JoinAttemptRegistry() =
    let active = Dictionary<string, JoinLeaseRecord>()
    let visibleMessages = Dictionary<string, HashSet<string>>()

    let getVisibleSet (targetSessionId: string) =
        match visibleMessages.TryGetValue targetSessionId with
        | true, s -> s
        | false, _ ->
            let s = HashSet<string>()
            visibleMessages[targetSessionId] <- s
            s

    member _.acquire(targetSessionId: obj, attemptId: obj) : obj =
        let sid = text "targetSessionId" targetSessionId
        let aid = text "attemptId" attemptId
        if String.IsNullOrWhiteSpace sid then malformed "targetSessionId"
        if String.IsNullOrWhiteSpace aid then malformed "attemptId"

        match active.TryGetValue sid with
        | true, existing ->
            freeze (createObj [
                "acquired" ==> box false
                "targetSessionId" ==> box sid
                "attemptId" ==> box aid
                "reason" ==> box "AlreadyAcquired"
                "existingAttemptId" ==> box existing.AttemptId
            ])
        | false, _ ->
            let record =
                { TargetSessionId = sid
                  AttemptId = aid
                  Woken = false
                  WokenReason = None
                  WokenMessageId = None }
            active[sid] <- record
            freeze (createObj [
                "acquired" ==> box true
                "targetSessionId" ==> box sid
                "attemptId" ==> box aid
                "reason" ==> (null: obj)
            ])

    member _.release(targetSessionId: obj, attemptId: obj) : obj =
        let sid = text "targetSessionId" targetSessionId
        let aid = text "attemptId" attemptId
        if String.IsNullOrWhiteSpace sid then malformed "targetSessionId"
        if String.IsNullOrWhiteSpace aid then malformed "attemptId"

        match active.TryGetValue sid with
        | true, existing when existing.AttemptId = aid ->
            active.Remove sid |> ignore
            freeze (createObj [
                "released" ==> box true
                "targetSessionId" ==> box sid
                "attemptId" ==> box aid
            ])
        | _ ->
            // 幂等注销：若已被移除或不匹配，仍返回 released=true
            freeze (createObj [
                "released" ==> box true
                "targetSessionId" ==> box sid
                "attemptId" ==> box aid
            ])

    member _.signalVisibleUserMessage(targetSessionId: obj, messageId: obj) : obj =
        let sid = text "targetSessionId" targetSessionId
        let mid = text "messageId" messageId
        if String.IsNullOrWhiteSpace sid then malformed "targetSessionId"
        if String.IsNullOrWhiteSpace mid then malformed "messageId"

        let seenSet = getVisibleSet sid
        if seenSet.Contains mid then
            // 重复物理消息：不产生重复唤醒
            freeze (createObj [
                "woken" ==> box false
                "targetSessionId" ==> box sid
                "attemptId" ==> (null: obj)
                "reason" ==> box "DuplicateMessage"
                "messageId" ==> box mid
            ])
        else
            seenSet.Add mid |> ignore
            match active.TryGetValue sid with
            | true, lease ->
                lease.Woken <- true
                lease.WokenReason <- Some "UserMessageArrived"
                lease.WokenMessageId <- Some mid
                freeze (createObj [
                    "woken" ==> box true
                    "targetSessionId" ==> box sid
                    "attemptId" ==> box lease.AttemptId
                    "reason" ==> box "UserMessageArrived"
                    "messageId" ==> box mid
                ])
            | false, _ ->
                // 既有契约：无活跃租约时只去重防重放，丢弃唤醒事实，不入队列
                freeze (createObj [
                    "woken" ==> box false
                    "targetSessionId" ==> box sid
                    "attemptId" ==> (null: obj)
                    "reason" ==> box "NoActiveLease"
                    "messageId" ==> box mid
                ])

    member _.clearSession(targetSessionId: obj) : obj =
        let sid = text "targetSessionId" targetSessionId
        if String.IsNullOrWhiteSpace sid then malformed "targetSessionId"

        let hadLease = active.Remove sid
        let msgCount =
            match visibleMessages.TryGetValue sid with
            | true, s ->
                visibleMessages.Remove sid |> ignore
                s.Count
            | false, _ -> 0

        freeze (createObj [
            "cleared" ==> true
            "targetSessionId" ==> sid
            "droppedLease" ==> hadLease
            "droppedMessagesCount" ==> msgCount
        ])

    member _.isAcquired(targetSessionId: obj) : bool =
        let sid = text "targetSessionId" targetSessionId
        active.ContainsKey sid

    member _.hasSeenMessage(targetSessionId: obj, messageId: obj) : bool =
        let sid = text "targetSessionId" targetSessionId
        let mid = text "messageId" messageId
        match visibleMessages.TryGetValue sid with
        | true, s -> s.Contains mid
        | false, _ -> false

    member _.snapshot(targetSessionId: obj) : obj =
        let sid = text "targetSessionId" targetSessionId
        let hasActive, lease = active.TryGetValue sid
        let seen =
            match visibleMessages.TryGetValue sid with
            | true, s -> Array.ofSeq s
            | false, _ -> Array.empty
        freeze (createObj [
            "targetSessionId" ==> sid
            "isAcquired" ==> hasActive
            "attemptId" ==> (if hasActive then box lease.AttemptId else null)
            "woken" ==> (if hasActive then box lease.Woken else box false)
            "seenMessages" ==> seen
        ])

let joinAttemptRegistry = JoinAttemptRegistry()
