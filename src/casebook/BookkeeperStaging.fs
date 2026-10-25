module Wanxiangli.Casebook.BookkeeperStaging

open System.Collections.Generic
open Fable.Core

type private Slot =
    { mutable Question: string
      mutable Answer: string
      // LC-029：初始 Q/A 永远不能冒充本次交付，所以槽位记录
      // provider 的程序是否真正通过这个槽写入过。
      mutable Touched: bool }

/// 一笔 Bookkeeper 事务的进程内暂存 Case。
/// provider 通过 todowrite-for-bookkeeper 只看到一个原子 question/answer 对象；
/// 这里不存在文件系统形状的 Q.md/A.md 表面。
[<AttachMembers>]
type BookkeeperStaging() =
    // DSL-MUTABLE: resource — 暂存事务槽注册表。所有操作同步完成，
    // 不在状态变换中等待外部操作；进程内对象，不承诺跨线程或跨进程共享。
    let slots = Dictionary<string, Slot>()
    let missingTransaction = "todowrite-for-bookkeeper: no staged transaction"

    /// 以给定 question/answer 开始一笔暂存事务；同一 txId 重开直接覆盖，Touched 归 false。
    member _.beginTransaction(txId: string, question: string, answer: string) : unit =
        slots[txId] <- { Question = question; Answer = answer; Touched = false }

    /// 读取一笔事务的 question/answer，不删除。
    member _.snapshot(txId: string) : Result<string * string, string> =
        match slots.TryGetValue txId with
        | false, _ -> Error missingTransaction
        | true, slot -> Ok(slot.Question, slot.Answer)

    /// 应用可选的 question/answer 补丁；None 保留旧值。只要进入有效槽位就记为 touched。
    member _.apply(txId: string, question: string option, answer: string option) : Result<unit, string> =
        match slots.TryGetValue txId with
        | false, _ -> Error missingTransaction
        | true, slot ->
            slot.Question <- Option.defaultValue slot.Question question
            slot.Answer <- Option.defaultValue slot.Answer answer
            slot.Touched <- true
            Ok()

    /// 需要本 completion 写入过才能取出并删除；未写过的取出不删除事务。
    member _.take(txId: string) : Result<string * string, string> =
        match slots.TryGetValue txId with
        | false, _ -> Error missingTransaction
        | true, slot when not slot.Touched -> Error "the staged transaction was not written by this completion"
        | true, slot ->
            slots.Remove txId |> ignore
            Ok(slot.Question, slot.Answer)

    /// LC-029：provider 的程序是否真正通过这笔暂存事务写入过。
    /// 终态没有暂存写入即尚未交付。缺失事务为 false。
    member _.touched(txId: string) : bool =
        match slots.TryGetValue txId with
        | true, slot -> slot.Touched
        | false, _ -> false

    /// 不返回内容地移除事务；缺失也成功，幂等。
    member _.abort(txId: string) : unit =
        slots.Remove txId |> ignore

/// 进程内唯一的暂存注册表；宿主全部消费者经由同一实例，不构造第二份 slots。
let bookkeeperStaging = BookkeeperStaging()
