namespace Wanxiangli.Authority

open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBoolean (_value: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isAbsent (_value: obj) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    let malformed (what: string) : 'T = raise (System.ArgumentException(sprintf "wanxiangli/authority: malformed %s" what))

    let text (what: string) (value: obj) : string =
        if isString value then unbox<string> value else malformed what

    let rootKind (value: obj) : RootKind =
        match (if isString value then unbox<string> value else "") with
        | "HumanRoot" -> RootKind.HumanRoot
        | "AgentOwnerRoot" -> RootKind.AgentOwnerRoot
        | _ -> malformed "root kind"

    let rootKindLabel (kind: RootKind) : string =
        match kind with
        | RootKind.HumanRoot -> "HumanRoot"
        | RootKind.AgentOwnerRoot -> "AgentOwnerRoot"

    let root (value: obj) : RunRoot =
        if not (isObject value) then malformed "root"
        else
            { SessionId = text "root.sessionId" (field value "sessionId")
              LogicalRunId = text "root.logicalRunId" (field value "logicalRunId")
              RootId = text "root.rootId" (field value "rootId")
              Kind = rootKind (field value "kind")
              Seed = text "root.seed" (field value "seed") }

    let optionalRoot (value: obj) : RunRoot option =
        if isAbsent value then None else Some(root value)

    let flag (what: string) (value: obj) : bool =
        if isBoolean value then unbox<bool> value else malformed what

    let origin (value: obj) : Origin =
        if not (isObject value) then malformed "origin"
        else
            match (if isString (field value "kind") then unbox<string> (field value "kind") else "") with
            | "AuthorityRoot" -> Origin.AuthorityRoot(rootKind (field value "root"))
            | "Continuation" -> Origin.Continuation(text "origin.continuation" (field value "continuation"))
            | "HostInternal" -> Origin.HostInternal
            | "UnknownOrigin" -> Origin.UnknownOrigin
            | _ -> malformed "origin kind"

    let originView (origin: Origin) : obj =
        match origin with
        | Origin.AuthorityRoot kind -> createObj [ "kind" ==> "AuthorityRoot"; "root" ==> rootKindLabel kind ]
        | Origin.Continuation continuation ->
            createObj [ "kind" ==> "Continuation"; "continuation" ==> continuation ]
        | Origin.HostInternal -> createObj [ "kind" ==> "HostInternal" ]
        | Origin.UnknownOrigin -> createObj [ "kind" ==> "UnknownOrigin" ]

/// wanxiangli/authority 公开入口：逻辑根注册、精确关闭与来源解析优先级的纯决议。
/// 无状态；投影记录、事实编解码与 durable 写入归宿主。JS 边界只收发 plain data，
/// 畸形输入是调用方缺陷，直接抛 ArgumentException，不猜测。
[<AttachMembers>]
type Authority() =

    /// 注册一个根：'admit' | 'replay' | 'conflict'。active 可为 null。
    member _.register(active: obj, requested: obj) : string =
        match RunLaw.register (Wire.optionalRoot active) (Wire.root requested) with
        | Registration.Admit -> "admit"
        | Registration.Replay -> "replay"
        | Registration.Conflict -> "conflict"

    /// 精确关闭：'close' | 'already-closed' | 'mismatch' | 'no-authority'。
    member _.close(active: obj, last: obj, logicalRunId: obj, rootId: obj) : string =
        RunLaw.close
            (Wire.optionalRoot active)
            (Wire.optionalRoot last)
            (Wire.text "logicalRunId" logicalRunId)
            (Wire.text "rootId" rootId)
        |> Authority.closureLabel

    /// 已完成子工作的关闭；活跃根不是非 Manager 的 AgentOwnerRoot 时为 'not-child-work'。
    member _.closeChildWork(active: obj, activeIsManager: obj, last: obj, logicalRunId: obj, rootId: obj) : string =
        RunLaw.closeChildWork
            (Wire.optionalRoot active)
            (Wire.flag "activeIsManager" activeIsManager)
            (Wire.optionalRoot last)
            (Wire.text "logicalRunId" logicalRunId)
            (Wire.text "rootId" rootId)
        |> Authority.closureLabel

    /// 来源解析。input = { acceptedContinuation?: string, claimOrigin?: Origin, hasPromptKey: boolean,
    /// hostCompaction: boolean, activeKind?: RootKind }。
    member _.resolveOrigin(input: obj) : obj =
        if not (Wire.isObject input) then Wire.malformed "origin input"
        else
            RunLaw.resolveOrigin
                (if Wire.isAbsent (Wire.field input "acceptedContinuation") then None
                 else Some(Wire.text "acceptedContinuation" (Wire.field input "acceptedContinuation")))
                (if Wire.isAbsent (Wire.field input "claimOrigin") then None else Some(Wire.origin (Wire.field input "claimOrigin")))
                (Wire.flag "hasPromptKey" (Wire.field input "hasPromptKey"))
                (Wire.flag "hostCompaction" (Wire.field input "hostCompaction"))
                (if Wire.isAbsent (Wire.field input "activeKind") then None else Some(Wire.rootKind (Wire.field input "activeKind")))
            |> Wire.originView

    static member private closureLabel(closure: Closure) : string =
        match closure with
        | Closure.Close -> "close"
        | Closure.AlreadyClosed -> "already-closed"
        | Closure.Mismatch -> "mismatch"
        | Closure.NoAuthority -> "no-authority"
        | Closure.NotChildWork -> "not-child-work"
