module Wanxiangli.HandleLifecycle.PendingRunStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'object' && $0 !== null")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArrayValue (_value: obj) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Object.is($0, $1) || $0 === $1")>]
let private tokenMatches (_t1: obj) (_t2: obj) : bool = jsNative

let private malformed (what: string) : 'T =
    raise (ArgumentException(sprintf "wanxiangli/handle-lifecycle: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then
        unbox<string> value
    else
        malformed what

let private optVal (v: obj option) (def: obj) : obj =
    match v with
    | Some x -> x
    | None -> def

let private optStr (v: obj option) : string =
    match v with
    | Some x when not (isAbsent x) -> string x
    | _ -> ""

let private optStrOpt (v: obj option) : string option =
    match v with
    | Some x when not (isAbsent x) -> Some (string x)
    | _ -> None

let private optObj (v: obj option) : obj option =
    match v with
    | Some x when not (isAbsent x) -> Some x
    | _ -> None

let private addCancelledItem (set: HashSet<string>) (item: obj) : unit =
    match isAbsent item with
    | false -> set.Add (string item) |> ignore
    | true -> ()

let private extractCancelledSet (agentIdsInput: obj) : HashSet<string> =
    let set = HashSet<string>()
    match isArrayValue agentIdsInput with
    | false -> set
    | true ->
        let arr = unbox<obj array> agentIdsInput
        arr |> Array.iter (addCancelledItem set)
        set

let private appendCancelled (list: ResizeArray<obj>) (sub: obj option) : unit =
    match sub with
    | Some s -> list.Add s
    | None -> ()

let private parseOptionsObj (opt: obj) =
    let aid = text "agentId" opt?agentId
    let tok = opt?token
    let cid = if not (isAbsent opt?childId) then string opt?childId else ""
    let rol = if not (isAbsent opt?role) then Some (string opt?role) else None
    let pay = if not (isAbsent opt?payload) then opt?payload else null
    let sub = if not (isAbsent opt?subscription) then Some opt?subscription else None
    aid, tok, cid, rol, pay, sub

let private parsePositional (aidInput: obj) (token: obj option) (childId: obj option) (role: obj option) (payload: obj option) (sub: obj option) =
    let aid = text "agentId" aidInput
    let tok = optVal token null
    let cid = optStr childId
    let rol = optStrOpt role
    let pay = optVal payload null
    let s = optObj sub
    aid, tok, cid, rol, pay, s

type private PendingRunRecord =
    { AgentId: string
      Token: obj
      ChildId: string
      Role: string option
      Payload: obj
      mutable Subscription: obj option
      mutable Finished: bool
      mutable Phase: string }

let private collectCancelled (set: HashSet<string>) (list: ResizeArray<obj>) (agentId: string) (run: PendingRunRecord) : unit =
    match set.Contains agentId with
    | false -> ()
    | true ->
        appendCancelled list run.Subscription
        run.Subscription <- None

/// 在途运行状态机自治存储（Wave-3 Package-28）。
/// 独占拥有运行记录字典 records 与对外同步视图 payloadView；
/// 严格保持纯状态自治与领域事实判定：
/// - register: 登记在途运行及句柄槽位，finished <- false
/// - attachSubscription: 原子绑定 subscription，若已 finished 则返回 false 供调用方立即 Dispose
/// - claim: 原子认领运行，防并发重入，置 finished <- true
/// - removeClaimed: 移除已认领运行
/// - settleParentCancelled: 父级取消原子结算并从容器物理移除
/// - removeByAgentId: 按 agentId 移除记录并返回被移除项
/// - drainAll: 原子清空所有未完成运行为 finished <- true 并返回待释放句柄
/// 宿主仅作为薄代理，严禁维护第二份独立状态容器。
[<AttachMembers>]
type PendingRunStore() as this =
    let records = Dictionary<string, PendingRunRecord>()
    let payloads = Dictionary<string, obj>()
    do
        emitJsExpr (payloads, this) "$0.__store = $1" |> ignore

    member _.payloadView: obj = payloads
    member _.rawView() : Dictionary<string, obj> = payloads

    member _.register(agentIdOrOptions: obj, ?token: obj, ?childId: obj, ?role: obj, ?payload: obj, ?subscription: obj) : obj =
        let isOpt = isObject agentIdOrOptions && (token |> Option.forall isAbsent)
        let aid, tok, cid, rol, pay, sub =
            match isOpt with
            | true -> parseOptionsObj agentIdOrOptions
            | false -> parsePositional agentIdOrOptions token childId role payload subscription

        if String.IsNullOrWhiteSpace aid then malformed "agentId"
        if isAbsent tok then malformed "token"

        let previousReplaced = records.ContainsKey aid
        let record =
            { AgentId = aid
              Token = tok
              ChildId = cid
              Role = rol
              Payload = pay
              Subscription = sub
              Finished = false
              Phase = "Pending" }

        records.[aid] <- record
        payloads.[aid] <- pay

        freeze (createObj [
            "registered" ==> true
            "agentId" ==> aid
            "token" ==> tok
            "childId" ==> cid
            "previousReplaced" ==> previousReplaced
        ])

    member _.attachSubscription(agentIdInput: obj, tokenInput: obj, subscriptionInput: obj) : bool =
        let aid = text "agentId" agentIdInput
        if isAbsent tokenInput then malformed "token"
        if isAbsent subscriptionInput then malformed "subscription"

        match records.TryGetValue aid with
        | true, current when tokenMatches current.Token tokenInput && not current.Finished ->
            current.Subscription <- Some subscriptionInput
            true
        | _ ->
            false

    member _.claim(agentIdInput: obj, tokenInput: obj) : obj =
        let aid = text "agentId" agentIdInput
        if isAbsent tokenInput then malformed "token"

        match records.TryGetValue aid with
        | false, _ ->
            freeze (createObj [
                "claimed" ==> false
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> null
                "payload" ==> null
                "reason" ==> "NotFound"
            ])
        | true, current when not (tokenMatches current.Token tokenInput) ->
            freeze (createObj [
                "claimed" ==> false
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> null
                "payload" ==> null
                "reason" ==> "TokenMismatch"
            ])
        | true, current when current.Finished ->
            freeze (createObj [
                "claimed" ==> false
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> null
                "payload" ==> null
                "reason" ==> "AlreadyFinished"
            ])
        | true, current ->
            current.Finished <- true
            current.Phase <- "Claimed"
            let s = match current.Subscription with Some sub -> sub | None -> null
            freeze (createObj [
                "claimed" ==> true
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> s
                "payload" ==> current.Payload
                "reason" ==> null
            ])

    member _.removeClaimed(agentIdInput: obj, tokenInput: obj) : bool =
        let aid = text "agentId" agentIdInput
        if isAbsent tokenInput then malformed "token"

        match records.TryGetValue aid with
        | true, current when tokenMatches current.Token tokenInput ->
            records.Remove aid |> ignore
            payloads.Remove aid |> ignore
            true
        | _ ->
            false

    member _.settleParentCancelled(agentIdInput: obj, tokenInput: obj) : obj =
        let aid = text "agentId" agentIdInput
        if isAbsent tokenInput then malformed "token"

        match records.TryGetValue aid with
        | false, _ ->
            freeze (createObj [
                "claimed" ==> false
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> null
                "payload" ==> null
                "reason" ==> "NotFound"
            ])
        | true, current when not (tokenMatches current.Token tokenInput) ->
            freeze (createObj [
                "claimed" ==> false
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> null
                "payload" ==> null
                "reason" ==> "TokenMismatch"
            ])
        | true, current when current.Finished ->
            freeze (createObj [
                "claimed" ==> false
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> null
                "payload" ==> null
                "reason" ==> "AlreadyFinished"
            ])
        | true, current ->
            current.Finished <- true
            current.Phase <- "Cancelled"
            let s = match current.Subscription with Some sub -> sub | None -> null
            let p = current.Payload
            records.Remove aid |> ignore
            payloads.Remove aid |> ignore
            freeze (createObj [
                "claimed" ==> true
                "agentId" ==> aid
                "token" ==> tokenInput
                "subscription" ==> s
                "payload" ==> p
                "reason" ==> null
            ])

    member _.removeByAgentId(agentIdInput: obj) : obj =
        let aid = text "agentId" agentIdInput
        match records.TryGetValue aid with
        | true, current ->
            let s = match current.Subscription with Some sub -> sub | None -> null
            let p = current.Payload
            records.Remove aid |> ignore
            payloads.Remove aid |> ignore
            freeze (createObj [
                "removed" ==> true
                "agentId" ==> aid
                "token" ==> current.Token
                "subscription" ==> s
                "payload" ==> p
            ])
        | false, _ ->
            freeze (createObj [
                "removed" ==> false
                "agentId" ==> aid
                "token" ==> null
                "subscription" ==> null
                "payload" ==> null
            ])

    member _.drainAll() : obj array =
        let list = ResizeArray<obj>()
        for KeyValue(agentId, run) in records do
            run.Finished <- true
            run.Phase <- "Drained"
            let s = match run.Subscription with Some sub -> sub | None -> null
            list.Add(freeze (createObj [
                "agentId" ==> agentId
                "token" ==> run.Token
                "subscription" ==> s
                "payload" ==> run.Payload
            ]))
        records.Clear()
        payloads.Clear()
        list.ToArray()

    member _.drainCancelled(agentIdsInput: obj) : obj array =
        let set = extractCancelledSet agentIdsInput
        let list = ResizeArray<obj>()
        for KeyValue(agentId, run) in records do
            collectCancelled set list agentId run
        list.ToArray()

    member _.isFinished(agentIdInput: obj, ?tokenInput: obj) : bool =
        let aid = text "agentId" agentIdInput
        match records.TryGetValue aid with
        | true, current ->
            let tok = defaultArg tokenInput current.Token
            tokenMatches current.Token tok && current.Finished
        | false, _ ->
            false

    member _.containsAgent(agentIdInput: obj) : bool =
        let aid = text "agentId" agentIdInput
        records.ContainsKey aid

    member _.tryGetPayload(agentIdInput: obj) : obj =
        let aid = text "agentId" agentIdInput
        match records.TryGetValue aid with
        | true, current -> current.Payload
        | false, _ -> null

    member _.count : int = records.Count

    member _.activePayloads() : obj array =
        records.Values
        |> Seq.filter (fun r -> not r.Finished)
        |> Seq.map (fun r -> r.Payload)
        |> Seq.toArray

    member _.allPayloads() : obj array =
        records.Values
        |> Seq.map (fun r -> r.Payload)
        |> Seq.toArray

    member _.snapshotOutstanding() : obj array =
        records.Values
        |> Seq.filter (fun r -> not r.Finished)
        |> Seq.map (fun r ->
            freeze (createObj [
                "agentId" ==> r.AgentId
                "childId" ==> r.ChildId
                "token" ==> r.Token
                "role" ==> (match r.Role with Some rol -> box rol | None -> null)
                "finished" ==> r.Finished
                "payload" ==> r.Payload
            ]))
        |> Seq.toArray

    member _.clear() : unit =
        records.Clear()
        payloads.Clear()

let pendingRunStore = PendingRunStore()
