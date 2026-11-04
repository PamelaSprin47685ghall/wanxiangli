module Wanxiangli.AttachmentLease.AttachmentLeaseRegistry

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("$0()")>]
let private invokeStart (_fn: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (ArgumentException(sprintf "wanxiangli/attachment-lease: malformed %s" what))

let private text (what: string) (value: obj) : string =
    match isString value with
    | true -> unbox<string> value
    | false -> malformed what

[<AttachMembers>]
type LeaseEntry =
    { owner: string
      kind: string
      sessionId: string
      origin: string
      agent: string }

module private RegistryInternal =

    [<Literal>]
    let separator = ""

    let makeKey (owner: string) (kind: string) : string =
        owner + separator + kind

    let toOwnerPairObj (owner: string) (kind: string) : obj =
        freeze (
            createObj
                [ "owner" ==> box owner
                  "kind" ==> box kind ]
        )

    let toLeaseRecordObj (entry: LeaseEntry) : obj =
        freeze (
            createObj
                [ "sessionId" ==> box entry.sessionId
                  "SessionId" ==> box entry.sessionId
                  "origin" ==> box entry.origin
                  "Origin" ==> box entry.origin
                  "agent" ==> box entry.agent
                  "Agent" ==> box entry.agent
                  "owner" ==> box entry.owner
                  "kind" ==> box entry.kind ]
        )

    let fieldString (target: obj) (name: string) : string option =
        let value = field target name
        match isString value with
        | true -> Some(unbox<string> value)
        | false -> None

    let tryExtractField (leaseObj: obj) (lowerName: string) (upperName: string) : string option =
        let lower = fieldString leaseObj lowerName
        let upper = fieldString leaseObj upperName
        match lower, upper with
        | Some str, _ -> Some str
        | None, Some str -> Some str
        | None, None -> None

    let extractLeaseField (leaseObj: obj) (lowerName: string) (upperName: string) : string =
        match tryExtractField leaseObj lowerName upperName with
        | Some str -> str
        | None -> malformed (sprintf "lease.%s" lowerName)

    let requireObject (name: string) (value: obj) : unit =
        match isObject value with
        | true -> ()
        | false -> malformed name

open RegistryInternal

/// Package-21: 租约注册表与单飞状态自治对象。
/// 独占拥有 bindings 与 flights 两份进程内可变集合：
/// - bind: 登记或覆写 (owner, kind) 租约
/// - tryFind: 查找 (owner, kind) 对应租约
/// - remove: 移除 (owner, kind) 对应租约
/// - tryFindByChild: 按 childSessionId 反向查找所有绑定的 (owner, kind)
/// - removeByChild: 按 childSessionId 级联注销全部对应租约并返回
/// - snapshot: 获取当前全部已绑定的 (owner, kind) 列表浅拷贝
/// - ensure: 单飞并发合并，直接持有正在执行的在途对象（obj/Promise），非阻塞去重
/// - finishEnsure: 移除单飞占位
/// - clear: 清空全部绑定与单飞
[<AttachMembers>]
type AttachmentLeaseRegistry() =
    let bindings = Dictionary<string, LeaseEntry>()
    let flights = Dictionary<string, obj>()

    member _.bind(ownerInput: obj, kindInput: obj, leaseInput: obj) : unit =
        let owner = text "owner" ownerInput
        let kind = text "kind" kindInput
        requireObject "lease" leaseInput

        let sessionId = extractLeaseField leaseInput "sessionId" "SessionId"
        let origin = extractLeaseField leaseInput "origin" "Origin"
        let agent = extractLeaseField leaseInput "agent" "Agent"

        let key = makeKey owner kind
        bindings[key] <-
            { owner = owner
              kind = kind
              sessionId = sessionId
              origin = origin
              agent = agent }

    member _.tryFind(ownerInput: obj, kindInput: obj) : obj option =
        let owner = text "owner" ownerInput
        let kind = text "kind" kindInput
        let key = makeKey owner kind

        match bindings.TryGetValue key with
        | true, entry -> Some(toLeaseRecordObj entry)
        | false, _ -> None

    member _.remove(ownerInput: obj, kindInput: obj) : bool =
        let owner = text "owner" ownerInput
        let kind = text "kind" kindInput
        bindings.Remove(makeKey owner kind)

    member _.tryFindByChild(childSessionIdInput: obj) : obj array =
        let childId = text "childSessionId" childSessionIdInput

        bindings.Values
        |> Seq.filter (fun entry -> entry.sessionId = childId)
        |> Seq.map (fun entry -> toOwnerPairObj entry.owner entry.kind)
        |> Seq.toArray

    member _.removeByChild(childSessionIdInput: obj) : obj array =
        let childId = text "childSessionId" childSessionIdInput

        let doomed =
            bindings.Values
            |> Seq.filter (fun entry -> entry.sessionId = childId)
            |> Seq.toArray

        doomed
        |> Array.iter (fun entry -> bindings.Remove(makeKey entry.owner entry.kind) |> ignore)

        doomed
        |> Array.map (fun entry -> toOwnerPairObj entry.owner entry.kind)

    member _.snapshot() : obj array =
        bindings.Values
        |> Seq.map (fun entry -> toOwnerPairObj entry.owner entry.kind)
        |> Seq.toArray

    member _.ensure(ownerInput: obj, kindInput: obj, start: obj) : obj =
        let owner = text "owner" ownerInput
        let kind = text "kind" kindInput
        let key = makeKey owner kind

        match flights.TryGetValue key with
        | true, inFlight -> inFlight
        | false, _ ->
            let inFlight = invokeStart start
            flights[key] <- inFlight
            inFlight

    member _.finishEnsure(ownerInput: obj, kindInput: obj) : unit =
        let owner = text "owner" ownerInput
        let kind = text "kind" kindInput
        flights.Remove(makeKey owner kind) |> ignore

    member _.hasInFlight(ownerInput: obj, kindInput: obj) : bool =
        let owner = text "owner" ownerInput
        let kind = text "kind" kindInput
        flights.ContainsKey(makeKey owner kind)

    member _.inFlightCount() : int =
        flights.Count

    member _.clear() : unit =
        bindings.Clear()
        flights.Clear()

let attachmentLeaseRegistry = AttachmentLeaseRegistry()
