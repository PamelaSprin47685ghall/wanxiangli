module Wanxiangli.GitPorcelain.RuntimePathStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 != null && typeof $0.then === 'function'")>]
let private isThenable (_value: obj) : bool = jsNative

[<Emit("$0.then(null, $1)")>]
let private catchThenable (_promise: obj) (_handler: obj -> unit) : unit = jsNative

/// 物理只读运行时根目录缓存自治管理。
/// 独占拥有 roots 字典与 gate 锁，提供规范化的键值比对、CAS 精确驱逐与 Promise/Task 失败自清理。
[<AttachMembers>]
type RuntimePathStore() =
    let gate = obj ()
    let roots = Dictionary<string, obj>()

    member _.normalizeKey(workspace: string) : string =
        if isNull (box workspace) || not (isString (box workspace)) || workspace.Length = 0 then
            if isNull (box workspace) then "" else workspace
        else
            let trimmed = workspace.TrimEnd([| '/'; '\\' |])
            if trimmed.Length = 0 then
                string workspace.[0]
            elif trimmed.Length = 2 && Char.IsLetter trimmed.[0] && trimmed.[1] = ':' && workspace.Length > 2 then
                trimmed + string workspace.[2]
            else
                trimmed

    member this.has(workspace: string) : bool =
        let key = this.normalizeKey workspace
        lock gate (fun () -> roots.ContainsKey key)

    member this.invalidate(workspace: string, ?expected: obj) : bool =
        let key = this.normalizeKey workspace
        lock gate (fun () ->
            match roots.TryGetValue key with
            | true, current ->
                match expected with
                | Some exp when not (isNull exp) ->
                    if obj.ReferenceEquals(current, exp) then
                        roots.Remove key
                    else
                        false
                | _ ->
                    roots.Remove key
            | false, _ -> false)

    member _.clear() : unit =
        lock gate (fun () -> roots.Clear())

    member this.getOrCompute(workspace: string, compute: string -> obj) : obj =
        let key = this.normalizeKey workspace
        let item =
            lock gate (fun () ->
                match roots.TryGetValue key with
                | true, v -> v
                | false, _ ->
                    let v = compute key
                    roots.[key] <- v
                    v)
        if isThenable item then
            catchThenable item (fun _ex ->
                this.invalidate(key, item) |> ignore)
        item

let runtimePathStore = RuntimePathStore()
