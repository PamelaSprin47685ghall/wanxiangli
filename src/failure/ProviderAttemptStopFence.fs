module Wanxiangli.Failure.ProviderAttemptStopFence

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<RequireQualifiedAccess>]
module RegisterResult =
    [<Literal>]
    let Admitted = "Admitted"
    [<Literal>]
    let AlreadyStopped = "AlreadyStopped"

[<RequireQualifiedAccess>]
module WaitForStopResult =
    [<Literal>]
    let Stopped = "Stopped"
    [<Literal>]
    let TimedOut = "TimedOut"
    [<Literal>]
    let Denied = "Denied"

[<Emit("setTimeout($0, $1)")>]
let private jsSetTimeout (_fn: unit -> unit) (_ms: int) : obj = jsNative

[<Emit("clearTimeout($0)")>]
let private jsClearTimeout (_handle: obj) : unit = jsNative

[<Emit("Promise.race([$0, $1])")>]
let private jsPromiseRace (_p1: obj) (_p2: obj) : Task<string> = jsNative

/// provider-attempt-recovery-022：宿主「已停止自动重试」的进程内发送栅栏。
///
/// 精确 key = sessionId + "" + providerRun。
/// 恢复重投的许可只属于确切的失败 attempt；同 session 的其它 run、迟到的 idle 都不能满足它。
/// 自治管理 stopped、waiters、denied 三份私有集合，内部提供并发保护。
[<AttachMembers>]
type ProviderAttemptStopFence() =
    let gate = obj ()

    [<Literal>]
    let separator = ""

    let stopped = HashSet<string>()
    let waiters = Dictionary<string, TaskCompletionSource<string>>()
    let denied = HashSet<string>()

    let attemptKey (sessionId: string) (providerRun: string) =
        sessionId + separator + providerRun

    let sessionPrefix (sessionId: string) =
        sessionId + separator

    let triggerWaiter (waiter: TaskCompletionSource<string>) (result: string) =
        try
            waiter.SetResult(result)
        with _ ->
            ()

    let releaseWaiter (key: string) (result: string) =
        match waiters.TryGetValue key with
        | true, waiter ->
            waiters.Remove key |> ignore
            triggerWaiter waiter result
        | false, _ -> ()

    let getOrCreateWaiter (key: string) =
        match waiters.TryGetValue key with
        | true, existing -> existing
        | false, _ ->
            let c = TaskCompletionSource<string>()
            waiters[key] <- c
            c

    /// 登记 attempt；若此前已被 SignalStop 观察，必须返回 AlreadyStopped 且不登记。
    member _.Register(sessionId: string, providerRun: string) : string =
        lock gate (fun () ->
            let key = attemptKey sessionId providerRun
            if stopped.Contains key then
                RegisterResult.AlreadyStopped
            else
                getOrCreateWaiter key |> ignore
                RegisterResult.Admitted)

    /// 宿主观察到终态投影停止时调用（幂等）。标记 stopped 并唤醒等待者。
    member _.SignalStop(sessionId: string, providerRun: string) : unit =
        lock gate (fun () ->
            let key = attemptKey sessionId providerRun
            if stopped.Add key then
                releaseWaiter key WaitForStopResult.Stopped)

    /// 等待确切 attempt 的宿主停止证据。
    /// 超时预算由调用方传入（timeoutMs <= 0 表示无超时限制）。
    /// 返回 "Stopped"、"TimedOut" 或 "Denied"。
    member _.WaitForStop(sessionId: string, providerRun: string, ?timeoutMs: int) : Task<string> =
        let key = attemptKey sessionId providerRun
        let timeout = defaultArg timeoutMs 0

        let immediate, waiter =
            lock gate (fun () ->
                if denied.Contains key then
                    Some WaitForStopResult.Denied, null
                elif stopped.Contains key then
                    Some WaitForStopResult.Stopped, null
                else
                    None, getOrCreateWaiter key)

        match immediate with
        | Some outcome -> Task.FromResult outcome
        | None when timeout <= 0 -> waiter.Task
        | None ->
            let timeoutTcs = TaskCompletionSource<string>()
            let timerHandle: obj ref = ref (null: obj)

            let onTimeout () =
                lock gate (fun () ->
                    if stopped.Contains key then
                        triggerWaiter timeoutTcs WaitForStopResult.Stopped
                    elif denied.Contains key then
                        triggerWaiter timeoutTcs WaitForStopResult.Denied
                    else
                        match waiters.TryGetValue key with
                        | true, w when obj.ReferenceEquals(w, waiter) ->
                            waiters.Remove key |> ignore
                        | _ -> ()
                        triggerWaiter timeoutTcs WaitForStopResult.TimedOut)

            timerHandle.Value <- jsSetTimeout onTimeout timeout

            task {
                let! outcome = jsPromiseRace waiter.Task timeoutTcs.Task
                if not (isNull timerHandle.Value) then
                    jsClearTimeout timerHandle.Value
                return outcome
            }

    /// 会话中止/替换/删除：将该 session 上当前等待中的精确 attempt 标记为 denied 并以 Denied 释放。
    /// 只拒绝这些等待中的 attempt，不污染该 session 的后续 attempt，幂等。
    member _.Revoke(sessionId: string) : unit =
        lock gate (fun () ->
            let prefix = sessionPrefix sessionId

            let pending =
                waiters
                |> Seq.choose (fun (KeyValue(key, _)) ->
                    if key.StartsWith(prefix, StringComparison.Ordinal) then
                        Some key
                    else
                        None)
                |> Seq.toArray

            for key in pending do
                denied.Add key |> ignore
                releaseWaiter key WaitForStopResult.Denied)

    /// 清除指定 session 的所有记录（stopped、waiters、denied）。
    /// 重复调用幂等，且不误伤此后新登记的同名 attempt。
    member _.Clear(sessionId: string) : unit =
        lock gate (fun () ->
            let prefix = sessionPrefix sessionId

            for entries in [ stopped; denied ] do
                let matching =
                    entries
                    |> Seq.filter (fun key -> key.StartsWith(prefix, StringComparison.Ordinal))
                    |> Seq.toArray

                for key in matching do
                    entries.Remove key |> ignore

            let pending =
                waiters
                |> Seq.choose (fun (KeyValue(key, _)) ->
                    if key.StartsWith(prefix, StringComparison.Ordinal) then
                        Some key
                    else
                        None)
                |> Seq.toArray

            for key in pending do
                releaseWaiter key WaitForStopResult.Denied)

    /// 清空所有状态。
    member _.ClearAll() : unit =
        lock gate (fun () ->
            stopped.Clear()
            denied.Clear()
            let pending = waiters |> Seq.map (fun (KeyValue(k, _)) -> k) |> Seq.toArray
            for key in pending do
                releaseWaiter key WaitForStopResult.Denied)

    /// 只读诊断快照，不暴露内部集合。
    member _.Snapshot() =
        lock gate (fun () ->
            {| stopped = stopped.Count
               waiting = waiters.Count
               denied = denied.Count |})

let providerAttemptStopFence = ProviderAttemptStopFence()
