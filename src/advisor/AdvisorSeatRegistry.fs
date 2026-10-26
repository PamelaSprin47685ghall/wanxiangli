module Wanxiangli.Advisor.AdvisorSeatRegistry

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core

[<AttachMembers>]
type SeatEntry =
    { CallerSessionId: string
      Gate: obj
      mutable ChildSessionId: string option
      mutable ChildTask: Task<Result<string, string>> option
      mutable CreateFailed: bool }

/// 顾问专席注册表（seats 字典 + ChildTask 单飞记忆化 + CreateFailed 失败锁存与重置 + ChildSessionId 映射）。
/// 以调用方会话 ID（callerSessionId）为键，保证同一调用方并发咨询共享同一单飞任务，
/// 且创建失败后不会永久中毒，下一次咨询可自动重试。
[<AttachMembers>]
type AdvisorSeatRegistry() =
    let registryGate = obj ()
    let seats = Dictionary<string, SeatEntry>()

    let getOrCreateSeat (callerSessionId: string) : SeatEntry =
        lock registryGate (fun () ->
            match seats.TryGetValue callerSessionId with
            | true, seat -> seat
            | false, _ ->
                let seat =
                    { CallerSessionId = callerSessionId
                      Gate = obj ()
                      ChildSessionId = None
                      ChildTask = None
                      CreateFailed = false }
                seats.[callerSessionId] <- seat
                seat)

    /// 显式重置失败标志（若上次创建失败，清空单飞任务并重置标志）
    member _.resetCreateFailure(callerSessionId: string) : unit =
        if not (isNull callerSessionId) then
            lock registryGate (fun () ->
                match seats.TryGetValue callerSessionId with
                | true, seat ->
                    lock seat.Gate (fun () ->
                        if seat.CreateFailed then
                            seat.ChildTask <- None
                            seat.CreateFailed <- false)
                | false, _ -> ())

    /// 保证顾问子会话单飞创建或复用已有任务
    member _.ensureSeatChild(callerSessionId: string, startChild: unit -> Task<Result<string, string>>) : Task<Result<string, string>> =
        if isNull callerSessionId then
            Task.FromResult(Error "callerSessionId cannot be null")
        else
            let seat = getOrCreateSeat callerSessionId
            lock seat.Gate (fun () ->
                // 失败锁存仅保留到下一次咨询进入前；进入后清空旧失败任务以尝试重新创建
                if seat.CreateFailed then
                    seat.ChildTask <- None
                    seat.CreateFailed <- false

                match seat.ChildTask with
                | Some pending -> pending
                | None ->
                    let runner () =
                        task {
                            try
                                let! created = startChild ()
                                match created with
                                | Ok childId ->
                                    lock seat.Gate (fun () -> seat.ChildSessionId <- Some childId)
                                | Error _ ->
                                    lock seat.Gate (fun () -> seat.CreateFailed <- true)
                                return created
                            with ex ->
                                lock seat.Gate (fun () -> seat.CreateFailed <- true)
                                return Error(sprintf "advisor seat creation faulted: %s" ex.Message)
                        }
                    let pending = runner ()
                    seat.ChildTask <- Some pending
                    pending)

    /// 查询调用方席位已绑定的顾问子会话 ID
    member _.tryChildId(callerSessionId: string) : string option =
        if isNull callerSessionId then
            None
        else
            lock registryGate (fun () ->
                match seats.TryGetValue callerSessionId with
                | true, seat ->
                    lock seat.Gate (fun () -> seat.ChildSessionId)
                | false, _ -> None)

    /// 判断调用方席位是否已被注册
    member _.isSeatKnown(callerSessionId: string) : bool =
        if isNull callerSessionId then
            false
        else
            lock registryGate (fun () -> seats.ContainsKey callerSessionId)

    /// 判断调用方席位当前是否持有活跃或已缓存的 ChildTask
    member _.hasChildTask(callerSessionId: string) : bool =
        if isNull callerSessionId then
            false
        else
            lock registryGate (fun () ->
                match seats.TryGetValue callerSessionId with
                | true, seat ->
                    lock seat.Gate (fun () -> seat.ChildTask.IsSome)
                | false, _ -> false)

    /// 判断调用方席位是否处于创建失败锁存态
    member _.hasCreateFailed(callerSessionId: string) : bool =
        if isNull callerSessionId then
            false
        else
            lock registryGate (fun () ->
                match seats.TryGetValue callerSessionId with
                | true, seat ->
                    lock seat.Gate (fun () -> seat.CreateFailed)
                | false, _ -> false)

    /// 清除指定调用方的席位（幂等），并返回被移除席位所绑定的子会话 ID（若有）
    member _.clear(callerSessionId: string) : string option =
        if isNull callerSessionId then
            None
        else
            lock registryGate (fun () ->
                match seats.TryGetValue callerSessionId with
                | true, seat ->
                    seats.Remove callerSessionId |> ignore
                    lock seat.Gate (fun () -> seat.ChildSessionId)
                | false, _ -> None)

    /// 清空所有调用方的席位（幂等）
    member _.clearAll() : unit =
        lock registryGate (fun () -> seats.Clear())

    /// 诊断快照
    member _.snapshot() : obj =
        lock registryGate (fun () -> box {| seatsCount = seats.Count |})

/// 全局单例
let advisorSeatRegistry = AdvisorSeatRegistry()
