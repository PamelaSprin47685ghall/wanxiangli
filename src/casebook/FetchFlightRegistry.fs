module Wanxiangli.Casebook.FetchFlightRegistry

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

type private FlightEntry =
    { StoreToken: obj
      FlightPromise: obj }

[<Emit("$0 === $1")>]
let private strictEquals (a: obj) (b: obj) : bool = jsNative

[<Emit("""
(function() {
    var res;
    var token = new Promise(function(resolve, reject) {
        res = resolve;
    }).finally($1);
    $2(token);
    try {
        var raw = $0();
        res(raw);
    } catch (err) {
        try { $1(); } catch (_) {}
        throw err;
    }
    return token;
})()
""")>]
let private executeFlightWithPlaceholder (factory: unit -> obj) (cleanup: unit -> unit) (register: obj -> unit) : obj = jsNative

/// 进程内 Casebook Fetch 单飞注册表。
/// 追踪同一 (workspaceRoot, shelfmark) 在执行期间的 in-flight 请求，
/// 确保并发调用共享同一个 Promise/Task、校验 storeToken 引用一致性，并在完成（成功或失败）后自动移除。
[<AttachMembers>]
type FetchFlightRegistry() =
    let flights = Dictionary<string, FlightEntry>()

    let makeKey (workspaceRoot: string) (shelfmark: string) =
        let root = if isNull workspaceRoot then "" else workspaceRoot
        let mark = if isNull shelfmark then "" else shelfmark
        sprintf "%d:%s\u0000%s" root.Length root mark

    member this.getOrCreate(workspaceRoot: string, shelfmark: string, storeToken: obj, factory: unit -> obj) : obj =
        let k = makeKey workspaceRoot shelfmark
        match flights.TryGetValue(k) with
        | true, entry when strictEquals entry.StoreToken storeToken ->
            entry.FlightPromise
        | true, _ ->
            invalidOp "Casebook fetch flight store binding mismatch"
        | false, _ ->
            let mutable capturedToken: obj = null
            let cleanup () =
                match flights.TryGetValue(k) with
                | true, current when strictEquals current.FlightPromise capturedToken ->
                    flights.Remove(k) |> ignore
                | _ -> ()

            let register (tok: obj) =
                capturedToken <- tok
                flights.[k] <- { StoreToken = storeToken; FlightPromise = tok }

            executeFlightWithPlaceholder factory cleanup register

    member _.remove(workspaceRoot: string, shelfmark: string) : bool =
        let k = makeKey workspaceRoot shelfmark
        flights.Remove(k)

    member _.activeCount() : int =
        flights.Count

    member _.clear() : unit =
        flights.Clear()

/// 全局唯一单例
let fetchFlightRegistry = FetchFlightRegistry()
