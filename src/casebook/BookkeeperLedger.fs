module Wanxiangli.Casebook.BookkeeperLedger

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type BookkeeperAttachment =
    { txId: string
      ownerSessionId: string
      attachment: string }

type private StoredAuthorization =
    { Agent: string
      Text: string
      TxId: string }

type private PendingCompletion =
    { TxId: string
      Completion: obj }

/// 进程内 Bookkeeper 会话附着、在途完成句柄与提示词单次授权自治对象。
/// 追踪 Bookkeeper 叶子会话与暂存事务 txId 的强绑定关系，以及提示词单次消费门禁。
/// 不泄露内部可变状态别名；解绑、重绑或清空时内部原子触发对未完成句柄的 Error 结算。
[<AttachMembers>]
type BookkeeperLedger() =
    let gate = obj ()
    let live = Dictionary<string, BookkeeperAttachment>()
    let pendingPromptAuthorizations = Dictionary<string, StoredAuthorization>()
    let pendingCompletions = Dictionary<string, PendingCompletion>()

    let cancelCompletionIfPending (completion: obj) (reason: string) =
        if not (isNull completion) then
            try
                let errResult = Error reason
                if not (isNull completion?SetResult) then
                    completion?SetResult(errResult) |> ignore
                elif not (isNull completion?setResult) then
                    completion?setResult(errResult) |> ignore
                elif not (isNull completion?complete) then
                    completion?complete(errResult) |> ignore
                elif not (isNull completion?resolve) then
                    completion?resolve(errResult) |> ignore
                elif emitJsExpr (completion) "typeof $0 === 'function'" then
                    emitJsStatement (completion, errResult) "$0($1);"
            with _ -> ()

    let completePhysicalWith (completion: obj) (outcome: obj) =
        if not (isNull completion) then
            try
                if not (isNull completion?SetResult) then
                    completion?SetResult(outcome) |> ignore
                elif not (isNull completion?setResult) then
                    completion?setResult(outcome) |> ignore
                elif not (isNull completion?complete) then
                    completion?complete(outcome) |> ignore
                elif not (isNull completion?resolve) then
                    completion?resolve(outcome) |> ignore
                elif emitJsExpr (completion) "typeof $0 === 'function'" then
                    emitJsStatement (completion, outcome) "$0($1);"
            with _ -> ()

    /// 绑定 Bookkeeper 子会话到特定事务与所有者会话。
    /// 若同一会话已存在绑定，新绑定覆盖旧绑定并原子清空关联的待办提示词授权（防跨事务代际泄露）；
    /// 若存在未完成的 pending completion，原子触发 Error 结算 ("bookkeeper session re-bound to new transaction")。
    member _.bind(sessionId: string, txId: string, ownerSessionId: string) : unit =
        if isNull sessionId || isNull txId || isNull ownerSessionId then
            ()
        else
            lock gate (fun () ->
                match pendingCompletions.TryGetValue(sessionId) with
                | true, pending ->
                    pendingCompletions.Remove(sessionId) |> ignore
                    cancelCompletionIfPending pending.Completion "bookkeeper session re-bound to new transaction"
                | false, _ -> ()
                live.[sessionId] <-
                    { txId = txId
                      ownerSessionId = ownerSessionId
                      attachment = "bookkeeper:" + txId }
                pendingPromptAuthorizations.Remove(sessionId) |> ignore)

    /// 解除会话附着，原子撤销关联的提示词待办授权；
    /// 若存在未完成的 pending completion，原子触发 Error 结算 ("bookkeeper session retired before completion")。
    member _.unbind(sessionId: string) : unit =
        if isNull sessionId then
            ()
        else
            lock gate (fun () ->
                live.Remove(sessionId) |> ignore
                pendingPromptAuthorizations.Remove(sessionId) |> ignore
                match pendingCompletions.TryGetValue(sessionId) with
                | true, pending ->
                    pendingCompletions.Remove(sessionId) |> ignore
                    cancelCompletionIfPending pending.Completion "bookkeeper session retired before completion"
                | false, _ -> ())

    /// 登记会话与当前事务绑定的在途完成等待句柄。
    member _.registerCompletion(sessionId: string, txId: string, completion: obj) : unit =
        if isNull sessionId || isNull txId || isNull completion then
            ()
        else
            lock gate (fun () ->
                pendingCompletions.[sessionId] <-
                    { TxId = txId
                      Completion = completion })

    /// 物理完成通知：
    /// 1. 首验 isAttached：若未附着，直接安全忽略并返回 false；
    /// 2. 校验 live.txId == pending.txId：匹配则完成结算并原子移除句柄，返回 true；
    /// 3. 若 txId 不匹配判定为陈旧代际，直接忽略不结算，返回 false。
    member _.completePhysical(sessionId: string, outcome: obj) : bool =
        if isNull sessionId then
            false
        else
            lock gate (fun () ->
                match live.TryGetValue(sessionId) with
                | true, att ->
                    match pendingCompletions.TryGetValue(sessionId) with
                    | true, pending when pending.TxId = att.txId ->
                        pendingCompletions.Remove(sessionId) |> ignore
                        completePhysicalWith pending.Completion outcome
                        true
                    | _ ->
                        // txId 不匹配（陈旧代际）或无句柄：直接忽略
                        false
                | false, _ ->
                    // 未附着：直接忽略
                    false)

    /// 移除在途句柄（若存在）。
    member _.removeCompletion(sessionId: string) : unit =
        if isNull sessionId then
            ()
        else
            lock gate (fun () -> pendingCompletions.Remove(sessionId) |> ignore)

    /// 查询会话关联的事务 ID。
    member _.tryTxId(sessionId: string) : string option =
        if isNull sessionId then
            None
        else
            lock gate (fun () ->
                match live.TryGetValue(sessionId) with
                | true, att -> Some att.txId
                | false, _ -> None)

    /// 获取会话关联的事务 ID，未附着返回空字符串。
    member this.txIdFor(sessionId: string) : string =
        match this.tryTxId(sessionId) with
        | Some id -> id
        | None -> ""

    /// 判定会话是否属于活跃的 Bookkeeper 附着会话。
    member _.isAttached(sessionId: string) : bool =
        if isNull sessionId then
            false
        else
            lock gate (fun () -> live.ContainsKey(sessionId))

    /// 获取只读附着快照（防御性浅拷贝原生对象，不泄露内部别名）。
    member _.getAttachment(sessionId: string) : obj =
        if isNull sessionId then
            null
        else
            lock gate (fun () ->
                match live.TryGetValue(sessionId) with
                | true, att -> box { txId = att.txId; ownerSessionId = att.ownerSessionId; attachment = att.attachment }
                | false, _ -> null)

    /// 登记当前附着会话预期的提示词单次授权。
    /// 仅在会话处于活跃附着状态时有效并返回 true，强绑定当前 txId；未附着会话直接拒绝并返回 false。
    member _.authorize(sessionId: string, agent: string, text: string) : bool =
        if isNull sessionId || isNull agent || isNull text then
            false
        else
            lock gate (fun () ->
                match live.TryGetValue(sessionId) with
                | true, att ->
                    pendingPromptAuthorizations.[sessionId] <-
                        { Agent = agent
                          Text = text
                          TxId = att.txId }
                    true
                | false, _ ->
                    false)

    /// 单次消费提示词授权。
    /// 仅当该会话存在未消费授权、所属附着仍存在且 txId 一致、agent 与 text 均严格逐字节匹配时才消费成功（原子删除并返回 true）；
    /// 任何参数不匹配、txId 不一致或未授权均返回 false，且不删除已有授权（防误消费与防篡改）。
    member _.tryConsume(sessionId: string, agent: string, text: string) : bool =
        if isNull sessionId || isNull agent || isNull text then
            false
        else
            lock gate (fun () ->
                match pendingPromptAuthorizations.TryGetValue(sessionId) with
                | true, auth when auth.Agent = agent && auth.Text = text ->
                    match live.TryGetValue(sessionId) with
                    | true, att when att.txId = auth.TxId ->
                        pendingPromptAuthorizations.Remove(sessionId) |> ignore
                        true
                    | _ ->
                        pendingPromptAuthorizations.Remove(sessionId) |> ignore
                        false
                | _ -> false)

    /// 清空所有附着、提示词授权与在途等待句柄。
    /// 所有未完成的 pending completions 原子触发 Error 结算 ("bookkeeper runtime reset")。
    member _.clear() : unit =
        lock gate (fun () ->
            for KeyValue(_, pending) in pendingCompletions do
                cancelCompletionIfPending pending.Completion "bookkeeper runtime reset"
            pendingCompletions.Clear()
            live.Clear()
            pendingPromptAuthorizations.Clear())

/// 全局唯一单例
let bookkeeperLedger = BookkeeperLedger()
