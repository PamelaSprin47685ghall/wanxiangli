namespace Wanxiangli.AdmissionQueue

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("$0 === undefined")>]
    let isUndefined (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number' && Number.isSafeInteger($0) && $0 > 0")>]
    let isPositiveInteger (_value: obj) : bool = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    [<Emit("Object.freeze($0)")>]
    let freezeArray (_value: obj array) : obj array = jsNative

    [<Emit("$0 === $1")>]
    let same (_left: obj) (_right: obj) : bool = jsNative

/// 一个排队中的执行准入需求：会话、物理用户消息、到达序号与本队列签发的 node 身份。
type internal Entry =
    { Handle: obj
      SessionId: string
      PhysicalUserMessageId: string
      Sequence: float }

/// 入队证据：同一逻辑操作（同会话同物理消息）、同会话更新的物理世代、全新会话。
[<RequireQualifiedAccess>]
type internal EnqueueEvidence =
    | SameLogicalOperation of Entry
    | NewerPhysicalGeneration of Entry
    | NewLogicalOperation

/// 撤回证据：没有当前需求、物理消息不符（迟到的取消）、精确命中。
[<RequireQualifiedAccess>]
type internal WithdrawEvidence =
    | Absent
    | WrongPhysical
    | Exact of Entry

module internal Law =

    let enqueue (current: Entry option) (physicalUserMessageId: string) =
        match current with
        | Some entry when entry.PhysicalUserMessageId = physicalUserMessageId -> EnqueueEvidence.SameLogicalOperation entry
        | Some entry -> EnqueueEvidence.NewerPhysicalGeneration entry
        | None -> EnqueueEvidence.NewLogicalOperation

    let hasRoom (bound: float) (pending: int) = float pending < bound

    let withdraw (current: Entry option) (physicalUserMessageId: string option) =
        match current, physicalUserMessageId with
        | None, _ -> WithdrawEvidence.Absent
        | Some entry, Some physical when entry.PhysicalUserMessageId <> physical -> WithdrawEvidence.WrongPhysical
        | Some entry, _ -> WithdrawEvidence.Exact entry

    /// 结果分类与宿主计数口径一致：成功、重复（没有可撤回的需求）、过期（迟到的物理消息）。
    let withdrawOutcome =
        function
        | WithdrawEvidence.Exact _ -> "Applied"
        | WithdrawEvidence.Absent -> "AlreadyApplied"
        | WithdrawEvidence.WrongPhysical -> "StaleFence"

/// wanxiangli/admission-queue 公开入口：执行准入等待队列的 owner（CUT-10）。
/// 每个会话至多一个等待需求；FIFO 序号、有界容量、同一逻辑操作复用、更新物理世代替代旧需求、
/// 精确 node 认领与撤回都由这里裁决。不选模型、不签发许可、不持有容量账本、不完成调用方的等待者。
[<AttachMembers>]
type AdmissionQueue(requestedBound: obj) =
    let fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    let limit =
        if Wire.isUndefined requestedBound then 32.0
        elif Wire.isPositiveInteger requestedBound then unbox<float> requestedBound
        else fail "admission queue bound must be a positive integer"

    let order = ResizeArray<Entry>()
    let bySession = Dictionary<string, Entry>()
    // DSL-MUTABLE: resource — monotonic arrival sequence, node identity and fence
    let mutable nextSequence = 0.0
    let mutable nextNodeId = 0.0
    let mutable nextFence = 0.0

    let text (owner: string) (name: string) (value: obj) =
        if Wire.isString value then
            unbox<string> value
        else
            fail (sprintf "%s requires string %s" owner name)

    let currentOf sessionId =
        match bySession.TryGetValue sessionId with
        | true, entry -> Some entry
        | false, _ -> None

    let remove (entry: Entry) =
        order.Remove entry |> ignore
        bySession.Remove entry.SessionId |> ignore

    let add sessionId physicalUserMessageId (payload: obj) =
        nextSequence <- nextSequence + 1.0
        nextNodeId <- nextNodeId + 1.0
        nextFence <- nextFence + 1.0

        let handle =
            Wire.freeze (
                createObj
                    [ "nodeId" ==> nextNodeId
                      "fence" ==> nextFence
                      "sequence" ==> nextSequence
                      "sessionId" ==> sessionId
                      "physicalUserMessageId" ==> physicalUserMessageId
                      "payload" ==> payload ]
            )

        let entry =
            { Handle = handle
              SessionId = sessionId
              PhysicalUserMessageId = physicalUserMessageId
              Sequence = nextSequence }

        order.Add entry
        bySession[sessionId] <- entry
        handle

    let enqueued (kind: string) (node: obj) (superseded: obj) =
        Wire.freeze (createObj [ "kind" ==> kind; "node" ==> node; "superseded" ==> superseded ])

    let withdrawn (outcome: string) (node: obj) =
        Wire.freeze (createObj [ "outcome" ==> outcome; "node" ==> node ])

    member _.contractVersion = 1
    member _.bound = limit

    /// 入队。同会话同物理消息：Reused，交还原 node（payload 不变）。同会话新物理消息：旧需求被移出并作为
    /// superseded 交还，新需求排到队尾。新会话：队列已满时 Full，否则 Queued。
    member _.enqueue(sessionId: obj, physicalUserMessageId: obj, payload: obj) : obj =
        let sessionId = text "admission enqueue" "sessionId" sessionId
        let physical = text "admission enqueue" "physicalUserMessageId" physicalUserMessageId

        match Law.enqueue (currentOf sessionId) physical with
        | EnqueueEvidence.SameLogicalOperation entry -> enqueued "Reused" entry.Handle (null: obj)
        | EnqueueEvidence.NewerPhysicalGeneration entry ->
            remove entry

            if Law.hasRoom limit order.Count then
                enqueued "Queued" (add sessionId physical payload) entry.Handle
            else
                enqueued "Full" (null: obj) entry.Handle
        | EnqueueEvidence.NewLogicalOperation ->
            if Law.hasRoom limit order.Count then
                enqueued "Queued" (add sessionId physical payload) (null: obj)
            else
                enqueued "Full" (null: obj) (null: obj)

    /// 只读：该会话当前等待需求的 node，否则 null。
    member _.current(sessionId: obj) : obj =
        if not (Wire.isString sessionId) then
            null
        else
            match currentOf (unbox<string> sessionId) with
            | Some entry -> entry.Handle
            | None -> null

    /// 认领：只有本队列签发、仍为该会话当前需求的那个 node 被移出并交还 true；其余一律 false 且不改状态。
    member _.take(node: obj) : bool =
        if isNull node then
            false
        else
            let sessionId: obj = node?sessionId

            if not (Wire.isString sessionId) then
                false
            else
                match currentOf (unbox<string> sessionId) with
                | Some entry when Wire.same entry.Handle node ->
                    remove entry
                    true
                | _ -> false

    /// 撤回该会话的等待需求（取消或被替代）。给了物理消息时只撤回与之一致的需求。
    /// 交还 {outcome: Applied | AlreadyApplied | StaleFence, node}。
    member _.withdraw(sessionId: obj, physicalUserMessageId: obj) : obj =
        let sessionId = text "admission withdraw" "sessionId" sessionId

        let physical =
            if isNull physicalUserMessageId || Wire.isUndefined physicalUserMessageId then
                None
            else
                Some(text "admission withdraw" "physicalUserMessageId" physicalUserMessageId)

        let evidence = Law.withdraw (currentOf sessionId) physical

        match evidence with
        | WithdrawEvidence.Exact entry ->
            remove entry
            withdrawn (Law.withdrawOutcome evidence) entry.Handle
        | _ -> withdrawn (Law.withdrawOutcome evidence) (null: obj)

    /// 只读：全部等待需求，按到达序号。
    member _.snapshot() : obj array =
        order |> Seq.sortBy _.Sequence |> Seq.map _.Handle |> Seq.toArray |> Wire.freezeArray

    /// 清空队列并按到达序号交还被移出的全部 node（调用方据此让各自的等待者失败）。
    member this.drain() : obj array =
        let pending = this.snapshot ()
        order.Clear()
        bySession.Clear()
        pending

    member _.count() : int = order.Count
