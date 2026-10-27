module Wanxiangli.FissionGroup.FissionAdmissionRegistry

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("$0 === null || $0 === undefined || typeof $0 !== 'string' || $0.trim().length === 0")>]
let private isBlank (s: string) : bool = jsNative

/// Fission 进程内 single-flight owner 准入自治注册表。
/// 独占并维护私有集合 activeOwners: HashSet<string>，
/// 严格保证：
/// 1. 每个 ownerSessionId 同时最多仅允许一次活跃 Fission 准入；
/// 2. 首次 reserve 成功返回 true，重复 reserve 返回 false；
/// 3. release 释放后允许再次 reserve；
/// 4. 空白（null/undefined/whitespace）ownerSessionId 防御性拒绝；
/// 5. snapshot 提供排序快照数组防外部篡改；
/// 6. clear 清空全部准入状态。
[<AttachMembers>]
type FissionAdmissionRegistry() =
    let gate = obj ()
    let activeOwners = HashSet<string>()

    /// 尝试独占预留指定 owner 的 Fission 准入。
    /// 首次预留成功返回 true；若已被占用或 ownerSessionId 为空白则返回 false。
    member _.reserve(ownerSessionId: string) : bool =
        if isBlank ownerSessionId then
            false
        else
            lock gate (fun () -> activeOwners.Add ownerSessionId)

    /// 查询指定 owner 当前是否处于活跃 Fission 准入状态。
    member _.isActive(ownerSessionId: string) : bool =
        if isBlank ownerSessionId then
            false
        else
            lock gate (fun () -> activeOwners.Contains ownerSessionId)

    /// 释放指定 owner 的 Fission 准入状态。
    member _.release(ownerSessionId: string) : unit =
        if not (isBlank ownerSessionId) then
            lock gate (fun () -> activeOwners.Remove ownerSessionId |> ignore)

    /// 清空所有活跃 owner 状态。
    member _.clear() : unit =
        lock gate (fun () -> activeOwners.Clear())

    /// 返回当前所有活跃 ownerSessionId 的只读排序快照数组。
    member _.snapshot() : string array =
        lock gate (fun () ->
            let arr = Seq.toArray activeOwners
            Array.sortInPlace arr
            arr)

/// 全局默认 Fission 准入注册表单例。
let fissionAdmissionRegistry = FissionAdmissionRegistry()
