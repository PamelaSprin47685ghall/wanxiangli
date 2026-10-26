module Wanxiangli.Casebook.BookkeeperLedger

open System.Collections.Generic
open Fable.Core

[<AttachMembers>]
type BookkeeperAttachment =
    { txId: string
      ownerSessionId: string
      attachment: string }

type private StoredAuthorization =
    { Agent: string
      Text: string
      TxId: string }

/// 进程内 Bookkeeper 会话附着与提示词单次授权自治对象。
/// 追踪 Bookkeeper 叶子会话与暂存事务 txId 的强绑定关系，以及提示词单次消费门禁。
/// 不泄露内部可变状态别名，解绑时同步撤销授权，不同会话彼此隔离。
[<AttachMembers>]
type BookkeeperLedger() =
    let gate = obj ()
    let live = Dictionary<string, BookkeeperAttachment>()
    let pendingPromptAuthorizations = Dictionary<string, StoredAuthorization>()

    /// 绑定 Bookkeeper 子会话到特定事务与所有者会话。
    /// 若同一会话已存在绑定，新绑定覆盖旧绑定并原子清空关联的待办提示词授权（防跨事务代际泄露）。
    member _.bind(sessionId: string, txId: string, ownerSessionId: string) : unit =
        if isNull sessionId || isNull txId || isNull ownerSessionId then
            ()
        else
            lock gate (fun () ->
                live.[sessionId] <-
                    { txId = txId
                      ownerSessionId = ownerSessionId
                      attachment = "bookkeeper:" + txId }
                pendingPromptAuthorizations.Remove(sessionId) |> ignore)

    /// 解除会话附着，并原子撤销关联的提示词待办授权。
    member _.unbind(sessionId: string) : unit =
        if isNull sessionId then
            ()
        else
            lock gate (fun () ->
                live.Remove(sessionId) |> ignore
                pendingPromptAuthorizations.Remove(sessionId) |> ignore)

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

    /// 清空所有附着与提示词授权状态。
    member _.clear() : unit =
        lock gate (fun () ->
            live.Clear()
            pendingPromptAuthorizations.Clear())

/// 全局唯一单例
let bookkeeperLedger = BookkeeperLedger()
