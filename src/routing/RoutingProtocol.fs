namespace Wanxiangli.Routing

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'function'")>]
    let isFunction (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number'")>]
    let isNumber (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBoolean (_value: obj) : bool = jsNative

    [<Emit("$0 != null && (typeof $0 === 'object' || typeof $0 === 'function') && typeof $0.then === 'function'")>]
    let isThenable (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("$0 == null")>]
    let isNullish (_value: obj) : bool = jsNative

    [<Emit("$0($1, $2, $3)")>]
    let call3 (_fn: obj) (_a: obj) (_b: obj) (_c: obj) : obj = jsNative

    [<Emit("$0($1)")>]
    let call1 (_fn: obj) (_a: obj) : obj = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    [<Emit("String($0)")>]
    let show (_value: obj) : string = jsNative

/// A target the runtime can hold: full `provider/model` and a non-empty reasoning, both trimmed.
type internal Target = { Model: string; Reasoning: string }

module internal Target =

    let private fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    let private text (name: string) (value: obj) =
        if Wire.isString value && not (String.IsNullOrWhiteSpace(unbox<string> value)) then
            (unbox<string> value).Trim()
        else
            fail (sprintf "scheduler target requires non-empty %s" name)

    let private fullSelector (model: string) =
        let slash = model.IndexOf '/'

        if slash <= 0 || slash >= model.Length - 1 then
            fail "scheduler target model must be full provider/model"

        model

    /// 严格解码：null 不是 target；字段必须是非空字符串；model 必须是 provider/model。
    let decode (value: obj) : Target =
        if Wire.isNullish value then
            fail "null is not a target"

        let model = text "model" (value?model: obj) |> fullSelector
        let reasoning = text "reasoning" (value?reasoning: obj)
        { Model = model; Reasoning = reasoning }

    let encode (target: Target) : obj =
        Wire.freeze (createObj [ "model" ==> target.Model; "reasoning" ==> target.Reasoning ])

    let provider (target: Target) =
        target.Model.Substring(0, target.Model.IndexOf '/')

module internal Protocol =

    [<Literal>]
    let Version = 2.0

    let private migrate =
        "Migrate the existing configuration manually (the recommended template in resources/wanxiangshu.mjs shows the new shape); an existing user file is never overwritten."

    let private fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    /// 协议版本是 ABI 的格式版本，不是启用开关：缺失、非数字、其它数字都拒绝。
    let requireVersion (declared: obj) =
        if Wire.isNullish declared then
            fail (
                "wanxiangshu.mjs must export `routingProtocol = 2`; the scheduler ABI is route(role, running, previous). "
                + migrate
            )
        elif not (Wire.isNumber declared) then
            fail (
                "wanxiangshu.mjs routingProtocol must be the number 2; the scheduler ABI is route(role, running, previous). "
                + migrate
            )
        elif unbox<float> declared <> Version then
            fail (
                sprintf
                    "wanxiangshu.mjs declares routingProtocol = %s but this runtime requires 2 (route(role, running, previous)). %s"
                    (Wire.show declared)
                    migrate
            )

/// wanxiangli/routing 公开入口：模型调度器的协议 owner（CUT-10）。
/// 只做 ABI：模块导出形状、版本、同步调用、target 解码与理论容量查询的结果类型。
/// 不读文件、不加载模块、不持有容量；选择策略全部属于用户 MJS。
[<AttachMembers>]
type RoutingProtocol() =

    let fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    let requireRole (role: obj) =
        if Wire.isString role && not (String.IsNullOrWhiteSpace(unbox<string> role)) then
            (unbox<string> role).Trim()
        else
            fail "scheduler role must be non-empty"

    /// 调度协议版本。
    member _.version: float = Protocol.Version

    /// 校验一个 MJS 模块命名空间，交还冻结的策略对象 { route, hasTheoreticalCapacity, markProviderFailed }。
    /// default 必须是函数，routingProtocol 必须是数字 2，hasTheoreticalCapacity 必须是函数；
    /// markProviderFailed 可省略（交还 null），出现时必须是函数。任何不符都抛出可操作的错误。
    member _.admit(moduleNamespace: obj) : obj =
        let route: obj = if Wire.isNullish moduleNamespace then null else moduleNamespace?``default``

        if not (Wire.isFunction route) then
            fail "scheduler default export must be a function"

        Protocol.requireVersion(moduleNamespace?routingProtocol: obj)

        let capacity: obj = moduleNamespace?hasTheoreticalCapacity

        if not (Wire.isFunction capacity) then
            fail (
                "wanxiangshu.mjs must export `hasTheoreticalCapacity(role)`; protocol 2 answers theoretical capacity per role. "
                + "Migrate the existing configuration manually (the recommended template in resources/wanxiangshu.mjs shows the new shape); an existing user file is never overwritten."
            )

        let markFailed: obj = moduleNamespace?markProviderFailed

        if not (Wire.isNullish markFailed) && not (Wire.isFunction markFailed) then
            fail "wanxiangshu.mjs markProviderFailed must be a function when exported"

        Wire.freeze (
            createObj
                [ "route" ==> route
                  "hasTheoreticalCapacity" ==> capacity
                  "markProviderFailed" ==> (if Wire.isNullish markFailed then null else markFailed: obj) ]
        )

    /// 调用 route(role, running, previous)，恰好三个参数。running 与 previous 以新冻结副本交出，
    /// 调度器改不到调用方的账本。返回 Promise 或非法结构抛错；null / undefined 是“等待”，交还 null。
    member _.route(route: obj, role: obj, running: obj, previous: obj) : obj =
        if not (Wire.isFunction route) then
            fail "scheduler default export must be a function"

        let role = requireRole role

        if not (Wire.isArray running) then
            fail "running must be an array of targets"

        let running =
            Wire.freeze (unbox<obj array> running |> Array.map (Target.decode >> Target.encode) |> box)

        let previous =
            if Wire.isNullish previous then null else Target.encode (Target.decode previous)

        let result = Wire.call3 route role running previous

        if Wire.isThenable result then
            fail "scheduler must be synchronous and must not return a Promise"

        if Wire.isNullish result then null else Target.encode (Target.decode result)

    /// 理论容量查询 hasTheoreticalCapacity(role)，恰好一个参数。只认布尔结果：
    /// Promise 或其它值不是“有容量”，抛错交调用方按配置错误处理。
    member _.hasTheoreticalCapacity(query: obj, role: obj) : bool =
        if not (Wire.isFunction query) then
            fail "hasTheoreticalCapacity must be a function"

        let result = Wire.call1 query (requireRole role)

        if Wire.isThenable result then
            fail "hasTheoreticalCapacity must be synchronous and must not return a Promise"

        if not (Wire.isBoolean result) then
            fail (sprintf "hasTheoreticalCapacity must return a boolean (got %s)" (Wire.show result))

        unbox<bool> result

    /// 严格解码一个 target：{ model: 'provider/model', reasoning }，交还修剪后的冻结副本。
    member _.decodeTarget(value: obj) : obj = Target.encode (Target.decode value)

    /// 解码持久道路记录的 'provider/model:reasoning'；与 decodeTarget 同一字段规则，坏值抛错。
    /// 分隔符是最后一个 ':'：模型名本身可以含 ':'（如 ollama 的 gemma4:31b），reasoning 不含。
    member _.decodeDurableTarget(value: obj) : obj =
        if not (Wire.isString value) || String.IsNullOrWhiteSpace(unbox<string> value) then
            fail "durable DevOps model target is empty"

        let text = (unbox<string> value).Trim()
        let separator = text.LastIndexOf ':'

        if separator <= 0 || separator >= text.Length - 1 then
            fail (sprintf "durable DevOps model target must be 'provider/model:reasoning' (got '%s')" text)

        Target.encode (
            Target.decode (
                createObj
                    [ "model" ==> text.Substring(0, separator)
                      "reasoning" ==> text.Substring(separator + 1) ]
            )
        )

    /// target 的 provider（model 中第一个 '/' 之前）。target 先按 decodeTarget 校验。
    member _.providerOf(target: obj) : string = Target.provider (Target.decode target)

module private Execution =
    [<Import("ExecutionPermits", "wanxiangli/permit")>]
    let permitsClass: obj = jsNative
    [<Import("CapacityTransitionCounters", "wanxiangli/permit")>]
    let countersClass: obj = jsNative
    [<Import("AdmissionQueue", "wanxiangli/admission-queue")>]
    let queueClass: obj = jsNative
    [<Import("CapacityBorrowing", "wanxiangli/borrowing")>]
    let borrowingClass: obj = jsNative
    [<Import("ProviderRunWitness", "wanxiangli/run-witness")>]
    let runsClass: obj = jsNative
    [<Emit("new $0()")>]
    let construct (_cls: obj) : 'a = jsNative
    [<Emit("new $0($1)")>]
    let constructWith (_cls: obj) (_options: obj) : 'a = jsNative
    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    let text value name = unbox<string> (field value name)
    let number value name = unbox<float> (field value name)
    let array value name = unbox<obj array> (field value name)
    let optional value = if Wire.isNullish value then None else Some value
    let nullable value = Option.defaultValue null value
    let sameTarget left right = text left "model" = text right "model" && text left "reasoning" = text right "reasoning"
    let provider target =
        let model = text target "model"
        model.Substring(0, model.IndexOf '/')
    let outcome (kind: string) = createObj [ "kind" ==> kind ]
    let admitted (lease: obj) = createObj [ "kind" ==> "Admitted"; "lease" ==> lease ]
    let queued (node: obj) = createObj [ "kind" ==> "Queued"; "node" ==> node ]
    let identity lease = field lease "identity"
    let exact value = text value "sessionId", text value "physicalUserMessageId"
    let fence lease = if Wire.isNullish lease then box 0 else field lease "fence"
    let failedTask<'a> (error: exn) =
        let completion = TaskCompletionSource<'a>(TaskCreationOptions.RunContinuationsAsynchronously)
        completion.SetException error
        completion.Task
    let settle (completion: TaskCompletionSource<obj>) result =
        try completion.SetResult result with _ -> ()
    let reject (completion: TaskCompletionSource<obj>) (error: exn) =
        try completion.SetException error with _ -> ()
    let normalizeText value = if String.IsNullOrWhiteSpace value then None else Some(value.Trim())
    let normalizeExact sessionId physical =
        match normalizeText sessionId, normalizeText physical with
        | Some sessionId, Some physical -> Some(sessionId, physical)
        | _ -> None

    type Permits =
        abstract issue: obj * obj -> obj
        abstract target: obj * obj -> obj
        abstract commit: obj * obj * obj -> string
        abstract releaseBeforeProvider: obj * obj * obj -> string
        abstract releasePhysical: string * string -> string
        abstract releasePendingPhysical: string * string -> string
        abstract lifecycle: obj * obj -> obj
        abstract committed: string * string -> obj
    type Counters =
        abstract record: string -> string
        abstract snapshot: unit -> obj
    type Queue =
        abstract enqueue: string * string * obj -> obj
        abstract current: string -> obj
        abstract take: obj -> bool
        abstract withdraw: string * obj -> obj
        abstract snapshot: unit -> obj array
        abstract drain: unit -> obj array
        abstract count: unit -> int
    type Borrowing =
        abstract routeFresh: string * obj * string * obj * obj * bool -> obj
        abstract reserveFresh: string * obj * obj -> obj
        abstract adoptReservation: string * string * obj -> unit
        abstract continueExecution: string * string * string * obj -> obj
        abstract releaseSession: string -> string
        abstract releasePhysical: string * string -> string
        abstract enterStep: string * string * obj * string array * obj * obj -> Task
        abstract endStep: string * string * string -> unit
        abstract suppressStep: string * string -> unit
        abstract exactCredit: string * string -> float
        abstract invariantSnapshot: unit -> obj
        abstract snapshot: unit -> obj array
        abstract fail: exn -> unit
    type Runs =
        abstract remember: string * string * obj -> unit
        abstract take: string -> obj
        abstract rememberStep: string * string * string -> unit
        abstract stepOf: string -> obj
        abstract forgetSession: string -> unit
        abstract forgetPhysical: string * string -> unit
    type Binding =
        abstract applies: string -> bool
        abstract read: string -> obj
        abstract error: obj -> exn

    type Request =
        { Session: string
          Physical: string
          Role: string
          Participant: string
          Purpose: string
          Lender: string option
          HostTarget: obj option }
    type Active =
        { Physical: string option
          Participant: string option
          Role: string
          Target: obj
          Purpose: string }
    type Demand =
        { Request: Request
          Previous: obj option
          Sequence: float
          Raw: obj
          Node: obj
          Completion: TaskCompletionSource<obj> }

    let request physicalRequired input =
        let session = text input "sessionId"
        let physical = text input "physicalUserMessageId"
        let participant = text input "participant"
        if String.IsNullOrWhiteSpace session then raise (ArgumentException("sessionId must be non-empty"))
        if physicalRequired && String.IsNullOrWhiteSpace physical then raise (ArgumentException("physicalUserMessageId must be non-empty"))
        if physicalRequired && String.IsNullOrWhiteSpace participant then raise (ArgumentException("participant must be non-empty"))
        { Session = session.Trim()
          Physical = if physicalRequired then physical.Trim() else ""
          Participant = if physicalRequired then participant.Trim() else ""
          Role = text input "role"
          Purpose = if Wire.isNullish (field input "purpose") then "normal" else text input "purpose"
          Lender = normalizeText (text input "lenderSessionId")
          HostTarget = optional (field input "hostTarget") }

    type Pending(counters: Counters) =
        let queue: Queue = constructWith queueClass (box 32)
        let demand node : Demand = unbox (field (field node "payload") "demand")
        let settleNode value node = if not (Wire.isNullish node) then settle (demand node).Completion value
        let withdraw kind session physical =
            let result = queue.withdraw(session, physical)
            settleNode (outcome kind) (field result "node")
            counters.record (text result "outcome")
        member _.Current(session) = queue.current session |> optional |> Option.map demand
        member _.Contains(session) = not (Wire.isNullish (queue.current session))
        member _.Count = queue.count()
        member _.Snapshot() = queue.snapshot() |> Array.map demand
        member _.Enqueue(request: Request, previous: obj option) =
            let holder = createObj [ "demand" ==> (null: obj) ]
            let result = queue.enqueue(request.Session, request.Physical, holder)
            settleNode (outcome "Superseded") (field result "superseded")
            let raw = field result "node"
            match text result "kind" with
            | "Reused" -> queued (demand raw).Node
            | "Full" -> outcome "QueueFull"
            | "Queued" ->
                let completion = TaskCompletionSource<obj>(TaskCreationOptions.RunContinuationsAsynchronously)
                let node = Wire.freeze (createObj [
                    "nodeId" ==> field raw "nodeId"; "fence" ==> field raw "fence"
                    "sequence" ==> field raw "sequence"; "sessionId" ==> request.Session
                    "physicalUserMessageId" ==> request.Physical; "completion" ==> completion.Task ])
                holder?demand <- { Request = request; Previous = previous; Sequence = number raw "sequence"; Raw = raw; Node = node; Completion = completion }
                queued node
            | other -> invalidOp (sprintf "execution-model-routing: unknown admission queue kind '%s'" other)
        member _.Admit(pending: Demand, lease: obj) =
            if queue.take pending.Raw then
                settle pending.Completion (admitted lease)
                counters.record "Applied"
            else counters.record "StaleFence"
        member _.RejectFull(pending: Demand) =
            if queue.take pending.Raw then
                settle pending.Completion (outcome "QueueFull")
                true
            else false
        member _.Cancel(session: string) = withdraw "Cancelled" session (null: obj)
        member _.CancelPhysical(session: string, physical: string) = withdraw "Cancelled" session (box physical)
        member _.Supersede(session: string) = withdraw "Superseded" session (null: obj)
        member _.Fail(error) = queue.drain() |> Array.iter (fun node -> reject (demand node).Completion error)

[<AttachMembers>]
type ExecutionRouting(options: obj) =
    let protocol = RoutingProtocol()
    let scheduler = Execution.field options "scheduler"
    let binding = Execution.field options "binding" |> Execution.optional |> Option.map unbox<Execution.Binding>
    let mutable boundReader = binding |> Option.map (fun policy -> policy.read)
    let counters: Execution.Counters = Execution.construct Execution.countersClass
    let permits: Execution.Permits = Execution.construct Execution.permitsClass
    let pending = Execution.Pending(counters)
    let capacity: Execution.Borrowing =
        Execution.constructWith Execution.borrowingClass (createObj [
            "providerOf" ==> Func<obj, string>(Execution.provider)
            "sameTarget" ==> Func<obj, obj, bool>(Execution.sameTarget) ])
    let runs: Execution.Runs = Execution.construct Execution.runsClass
    let active = Dictionary<string, Execution.Active>()
    let stepTasks = Dictionary<string, Task>()
    let retained = Dictionary<string * string, obj>()
    let held = HashSet<string * string>()
    let bound = Dictionary<string, obj>()
    let superseded = HashSet<string * string>()
    let stopped = HashSet<string * string>()
    let mutable fatal: exn option = None
    let capacityQuery = if Wire.isNullish scheduler then null else Execution.field scheduler "hasTheoreticalCapacity"

    let ensureHealthy () = fatal |> Option.iter raise
    let poison error =
        fatal <- Some error
        capacity.fail error
        pending.Fail error
    let theoretical role =
        if Wire.isNullish capacityQuery then true
        else
            try protocol.hasTheoreticalCapacity(capacityQuery, box role)
            with error -> poison error; raise error
    let schedule role running previous =
        try protocol.route(scheduler, box role, box running, Execution.nullable previous) |> Execution.optional
        with error -> poison error; raise error
    let cachedBoundTarget session =
        match bound.TryGetValue session with
        | true, target -> Some target
        | _ ->
            boundReader
            |> Option.bind (fun read -> read session |> Execution.optional)
            |> Option.map (fun value ->
                let target = protocol.decodeDurableTarget value
                bound[session] <- target
                target)
    let boundFor session role =
        if binding |> Option.exists (fun policy -> policy.applies role) then cachedBoundTarget session else None
    let bindingError kind previous target =
        let detail = createObj [ "kind" ==> kind; "bound" ==> previous; "target" ==> target ]
        match binding with
        | Some policy -> raise (policy.error detail)
        | None -> invalidOp "execution-model-routing: model binding is immutable"
    let enforce session role target =
        if not (Wire.isNullish scheduler) then
            match boundFor session role with
            | Some previous when not (Execution.sameTarget previous target) -> bindingError "immutable" previous target
            | _ -> ()
    let activeTarget purpose session =
        match active.TryGetValue session with
        | true, lease when lease.Physical.IsSome && lease.Purpose = purpose -> Some lease.Target
        | _ -> None
    let previousFor (request: Execution.Request) =
        activeTarget "normal" request.Session |> Option.orElseWith (fun () -> boundFor request.Session request.Role)
    let routeFor (request: Execution.Request) previous running =
        if Wire.isNullish scheduler then previous
        else
            match boundFor request.Session request.Role with
            | None -> schedule request.Role running previous
            | Some fixedTarget ->
                match schedule request.Role running (Some fixedTarget) with
                | Some candidate when Execution.sameTarget candidate fixedTarget -> Some fixedTarget
                | _ -> None
    let routeFresh retireOld (request: Execution.Request) (oldPhysical: string option) (previous: obj option) =
        try
            capacity.routeFresh(
                request.Session, oldPhysical |> Option.map box |> Execution.nullable, request.Physical,
                request.Lender |> Option.map box |> Execution.nullable,
                box (Func<obj array, obj>(fun running -> routeFor request previous running |> Execution.nullable)), retireOld)
            |> Execution.optional
        with error -> poison error; raise error
    let reserveFresh (request: Execution.Request) previous =
        try
            capacity.reserveFresh(request.Session, request.Lender |> Option.map box |> Execution.nullable,
                box (Func<obj array, obj>(fun running -> routeFor request previous running |> Execution.nullable)))
            |> Execution.optional
        with error -> poison error; raise error
    let remember (request: Execution.Request) (target: obj) =
        active[request.Session] <- { Physical = Some request.Physical; Participant = Some request.Participant; Role = request.Role; Target = target; Purpose = request.Purpose }
    let issue (request: Execution.Request) (target: obj) =
        let identity = createObj [ "sessionId" ==> request.Session; "physicalUserMessageId" ==> request.Physical
                                   "role" ==> request.Role; "participant" ==> request.Participant; "target" ==> target ]
        permits.issue(identity, box (capacity.exactCredit(request.Session, request.Physical)))
    let issueAdmission request target = issue request target |> Execution.admitted
    let schedulePending (demand: Execution.Demand) =
        if theoretical demand.Request.Role then
            match routeFresh true demand.Request None demand.Previous with
            | None -> false
            | Some target ->
                enforce demand.Request.Session demand.Request.Role target
                remember demand.Request target
                pending.Admit(demand, issue demand.Request target) |> ignore
                true
        else pending.RejectFull demand
    let rec drain () =
        ensureHealthy()
        let progressed = pending.Snapshot() |> Array.map schedulePending |> Array.exists id
        if progressed && pending.Count > 0 then drain()
    let drainHealthy () = if fatal.IsNone then drain()
    let retirePhysical session physical =
        let changed =
            match active.TryGetValue session with
            | true, lease when lease.Physical = Some physical ->
                let removed = active.Remove session
                capacity.releasePhysical(session, physical) |> ignore
                removed
            | _ -> false
        if changed then drainHealthy()
    let retireSession session =
        let changed = active.Remove session
        retained.Keys |> Seq.filter (fun (owner, _) -> owner = session) |> Seq.toArray
        |> Array.iter (fun key -> retained.Remove key |> ignore)
        held |> Seq.filter (fun (owner, _) -> owner = session) |> Seq.toArray
        |> Array.iter (fun key -> held.Remove key |> ignore)
        runs.forgetSession session
        capacity.releaseSession session |> ignore
        if pending.Contains session then pending.Cancel session |> ignore
        if changed then drainHealthy()
    let sameIdentity (request: Execution.Request) role participant purpose =
        let changed label before after =
            invalidOp (sprintf "execution-model-routing: physical execution %s/%s changed %s (%s -> %s)" request.Session request.Physical label before after)
        if role <> request.Role then changed "role" role request.Role
        participant |> Option.iter (fun expected -> if expected <> request.Participant then changed "participant" expected request.Participant)
        if purpose <> request.Purpose then changed "execution purpose" purpose request.Purpose
    let currentOutcome (request: Execution.Request) =
        match active.TryGetValue request.Session with
        | true, lease ->
            match lease.Physical with
            | Some physical when physical = request.Physical ->
                sameIdentity request lease.Role lease.Participant lease.Purpose
                Some(issueAdmission request lease.Target)
            | None ->
                sameIdentity request lease.Role lease.Participant lease.Purpose
                capacity.adoptReservation(request.Session, request.Physical, lease.Target)
                active[request.Session] <- { lease with Physical = Some request.Physical; Participant = Some request.Participant }
                Some(issueAdmission request lease.Target)
            | _ -> None
        | _ ->
            match pending.Current request.Session with
            | Some demand when demand.Request.Physical = request.Physical ->
                sameIdentity request demand.Request.Role (Some demand.Request.Participant) demand.Request.Purpose
                Some(Execution.queued demand.Node)
            | _ -> None
    let supersedePending session = if pending.Contains session then pending.Supersede session |> ignore
    let currentPhysical session = match active.TryGetValue session with true, lease -> lease.Physical | _ -> None
    let acquireRequest (request: Execution.Request) =
        ensureHealthy()
        match currentOutcome request with
        | Some result -> result
        | None when not (theoretical request.Role) -> Execution.outcome "QueueFull"
        | None ->
            let oldPhysical = currentPhysical request.Session
            let previous = if Wire.isNullish scheduler then request.HostTarget else previousFor request
            let replacePrevious () =
                oldPhysical |> Option.orElseWith (fun () -> pending.Current request.Session |> Option.map (fun demand -> demand.Request.Physical))
                |> Option.iter (fun physical -> superseded.Add(request.Session, physical) |> ignore)
                active.Remove request.Session |> ignore
                supersedePending request.Session
            match routeFresh (pending.Contains request.Session || pending.Count < 32) request oldPhysical previous with
            | Some target ->
                replacePrevious()
                remember request target
                drain()
                issueAdmission request target
            | None when not (pending.Contains request.Session) && pending.Count >= 32 -> Execution.outcome "QueueFull"
            | None ->
                replacePrevious()
                let result = pending.Enqueue(request, previous)
                drain()
                result
    let tryReserve (request: Execution.Request) =
        ensureHealthy()
        match active.TryGetValue request.Session, pending.Contains request.Session with
        | (true, lease), _ when lease.Physical.IsNone && lease.Role = request.Role && lease.Purpose = request.Purpose -> Some lease.Target
        | (true, _), _ | _, true -> None
        | _ ->
            reserveFresh request (previousFor request)
            |> Option.map (fun target ->
                enforce request.Session request.Role target
                active[request.Session] <- { Physical = None; Participant = None; Role = request.Role; Target = target; Purpose = request.Purpose }
                drain()
                enforce request.Session request.Role target
                target)
    let tryLeaseRequest (request: Execution.Request) =
        match superseded.Contains(request.Session, request.Physical), active.TryGetValue request.Session with
        | true, _ -> None
        | false, (true, lease) when
            lease.Physical = Some request.Physical && lease.Role = request.Role && lease.Purpose = request.Purpose
            && (lease.Participant = Some request.Participant || lease.Participant.IsNone) -> Some lease.Target
        | false, (true, lease) when
            lease.Physical.IsNone && lease.Role = request.Role && lease.Purpose = request.Purpose
            && (lease.Participant = Some request.Participant || lease.Participant.IsNone) ->
            capacity.adoptReservation(request.Session, request.Physical, lease.Target)
            active[request.Session] <- { lease with Physical = Some request.Physical; Participant = Some request.Participant }
            Some lease.Target
        | false, (true, lease) when lease.Physical <> Some request.Physical ->
            lease.Physical |> Option.iter (fun physical -> superseded.Add(request.Session, physical) |> ignore)
            active.Remove request.Session |> ignore
            routeFresh true request lease.Physical (Some lease.Target)
            |> Option.map (fun target ->
                remember request target
                drain()
                enforce request.Session request.Role target
                target)
        | false, (true, _) -> None
        | false, (false, _) when pending.Contains request.Session -> None
        | _ ->
            routeFresh true request None (previousFor request)
            |> Option.map (fun target ->
                remember request target
                drain()
                enforce request.Session request.Role target
                target)

    let completePhysical session physical outcome =
        if outcome = "Applied" then
            retirePhysical session physical
            drainHealthy()
        outcome
    let releaseExact (session, physical) =
        permits.releasePhysical(session, physical) |> counters.record |> completePhysical session physical
    let releasePhysicalKey (session, physical) =
        (match pending.Current session with
         | Some _ -> pending.CancelPhysical(session, physical)
         | None -> permits.releasePhysical(session, physical) |> counters.record)
        |> completePhysical session physical
    let hasInput key = retained.Values |> Seq.exists (Execution.identity >> Execution.exact >> (=) key)
    let releaseUnretained key =
        if not (hasInput key) && held.Contains key then
            // A retained input's permit may still be Pending when the input is
            // cancelled, and physical completion is only legal after a commit. Fall
            // back to the before-provider release so the credit still comes back;
            // both paths settle the same exact physical material.
            let outcome =
                match releaseExact key with
                | "Conflict" ->
                    permits.releasePendingPhysical(fst key, snd key)
                    |> counters.record
                    |> completePhysical (fst key) (snd key)
                | other -> other

            match outcome with
            | "Conflict" ->
                invalidOp (sprintf "managed-session-lifecycle-027: retained continuation input release was rejected (%s/%s)" (fst key) (snd key))
            | _ -> held.Remove key |> ignore
    let cancelInputKey key =
        match retained.TryGetValue key with
        | true, previous ->
            retained.Remove key |> ignore
            releaseUnretained (Execution.identity previous |> Execution.exact)
        | _ -> ()
    let targetOf lease = permits.target(lease, Execution.fence lease)
    let requireCurrent lease failure =
        let identity = Execution.identity lease
        let session, physical = Execution.exact identity
        let result = targetOf lease
        match active.TryGetValue session with
        | true, current when unbox<bool> (Execution.field result "ok")
                             && current.Physical = Some physical
                             && current.Participant = Some(Execution.text identity "participant")
                             && Execution.sameTarget current.Target (Execution.field result "value") ->
            identity, current, Execution.field result "value"
        | _ -> invalidOp failure
    let continueExecution previous physical selectedTarget =
        ensureHealthy()
        let identity, current, target = requireCurrent previous "continuation no longer owns its previous model lease"
        let session, oldPhysical = Execution.exact identity
        let nextTarget = selectedTarget |> Option.defaultValue target
        let replacement = capacity.continueExecution(session, oldPhysical, physical, nextTarget)
        superseded.Add(session, oldPhysical) |> ignore
        supersedePending session
        active[session] <- { current with Physical = Some physical; Target = nextTarget }
        drain()
        let request: Execution.Request =
            { Session = session; Physical = physical; Role = current.Role
              Participant = Execution.text identity "participant"; Purpose = current.Purpose
              Lender = None; HostTarget = None }
        let lease = issue request replacement
        retained.Remove((session, physical)) |> ignore
        held.Remove(session, oldPhysical) |> ignore
        retained.Keys
        |> Seq.filter (fun key -> Execution.exact (Execution.identity retained[key]) = (session, oldPhysical))
        |> Seq.toArray
        |> Array.iter (fun key -> retained[key] <- lease)
        Execution.admitted lease
    let clearStepTasks session physical =
        let prefix = sprintf "%s:%s:" session physical
        stepTasks.Keys |> Seq.filter (fun key -> key.StartsWith prefix) |> Seq.toArray
        |> Array.iter (fun key -> stepTasks.Remove key |> ignore)
    let exactAvailable (lease: Execution.Active) running =
        if Wire.isNullish scheduler then true
        else schedule lease.Role running (Some lease.Target) |> Option.exists (Execution.sameTarget lease.Target)
    let enterStepRequest session physical visible requestKey =
        let cacheKey = requestKey |> Option.filter (String.IsNullOrWhiteSpace >> not)
                       |> Option.map (fun key -> sprintf "%s:%s:%s" session physical key)
        let cached = cacheKey |> Option.bind (fun key -> match stepTasks.TryGetValue key with true, task -> Some task | _ -> None)
        match cached with
        | Some pending -> pending
        | None ->
            ensureHealthy()
            let admission =
                match active.TryGetValue session with
                | true, lease when lease.Physical = Some physical ->
                    capacity.enterStep(session, physical, lease.Target, visible,
                        box (Func<obj array, bool>(exactAvailable lease)), requestKey |> Option.map box |> Execution.nullable)
                | _ ->
                    Execution.failedTask<unit>(InvalidOperationException(sprintf "execution-model-routing: provider step %s/%s has no active execution binding" session physical)) :> Task
            let pending =
                task {
                    do! admission
                    drainHealthy()
                } :> Task
            cacheKey |> Option.iter (fun key -> stepTasks[key] <- pending)
            pending
    let capacitySnapshot () =
        let physical = capacity.invariantSnapshot()
        let owner (session: string) (physical: string) (role: obj) (participant: obj) =
            createObj [ "sessionId" ==> session; "physicalUserMessageId" ==> physical
                        "role" ==> role; "participant" ==> participant ]
        let executions =
            active |> Seq.choose (fun (KeyValue(session, lease)) ->
                lease.Physical |> Option.map (fun physical -> owner session physical (box lease.Role) (lease.Participant |> Option.map box |> Execution.nullable)))
            |> Seq.sortBy Execution.exact |> Seq.toArray
        let byExecution = executions |> Array.map (fun value -> Execution.exact value, value) |> Map.ofArray
        let enrich value =
            let session, physical = Execution.exact value
            match Map.tryFind (session, physical) byExecution with
            | Some known -> owner session physical (Execution.field known "role") (Execution.field known "participant")
            | None -> owner session physical (null: obj) (null: obj)
        let tokens = Execution.array physical "tokens" |> Array.map (fun token ->
            createObj [ "credit" ==> Execution.field token "credit"; "state" ==> Execution.field token "state"
                        "owner" ==> enrich (Execution.field token "owner"); "target" ==> Execution.field token "target" ])
        let custodies = Execution.array physical "custodies" |> Array.map (fun custody ->
            createObj [ "credit" ==> Execution.field custody "credit"; "owner" ==> enrich (Execution.field custody "owner") ])
        let providerWaiters = Execution.array physical "waiters" |> Array.map (fun waiter ->
            createObj [ "owner" ==> enrich (Execution.field waiter "owner"); "sequence" ==> Execution.field waiter "sequence"
                        "kind" ==> Execution.field waiter "kind" ])
        let admissionWaiters = pending.Snapshot() |> Array.map (fun demand ->
            createObj [ "owner" ==> owner demand.Request.Session demand.Request.Physical (box demand.Request.Role) (box demand.Request.Participant)
                        "sequence" ==> demand.Sequence; "kind" ==> "Admission" ])
        let waiters = Array.append providerWaiters admissionWaiters
                      |> Array.sortBy (fun waiter -> Execution.number waiter "sequence", Execution.text (Execution.field waiter "owner") "sessionId")
        let owners = Array.concat [ executions; tokens |> Array.map (fun value -> Execution.field value "owner"); waiters |> Array.map (fun value -> Execution.field value "owner") ]
                     |> Array.distinctBy Execution.exact |> Array.sortBy Execution.exact
        createObj [ "ledgerEntries" ==> Execution.field physical "ledgerEntries"; "tokens" ==> tokens
                    "custodies" ==> custodies; "executions" ==> executions; "waiters" ==> waiters; "owners" ==> owners
                    "lineage" ==> Array.empty<obj>; "idleCount" ==> Execution.field physical "idleCount"
                    "inFlightCount" ==> Execution.field physical "inFlightCount"; "retiringCount" ==> Execution.field physical "retiringCount"
                    "activeCount" ==> (Execution.number physical "inFlightCount" + Execution.number physical "retiringCount")
                    "counters" ==> counters.snapshot() ]

    member _.acquire(input: obj) : Task<obj> =
        try Execution.request true input |> acquireRequest |> Task.FromResult
        with error -> Execution.failedTask<obj> error
    member _.reserve(input: obj) : obj =
        let request = try Some(Execution.request false input) with _ -> None
        request |> Option.bind tryReserve |> Execution.nullable
    member _.tryLease(input: obj) : obj =
        let request = try Some(Execution.request true input) with _ -> None
        request |> Option.bind tryLeaseRequest |> Execution.nullable
    member _.target(lease: obj) = targetOf lease
    member _.lifecycle(lease: obj) = permits.lifecycle(lease, Execution.fence lease)
    member _.commit(lease: obj, observed: obj) =
        enforce (Execution.text observed "sessionId") (Execution.text observed "role") (Execution.field observed "target")
        permits.commit(lease, Execution.fence lease, observed) |> counters.record
    member _.releaseBeforeProvider(lease: obj, observed: obj) =
        let outcome = permits.releaseBeforeProvider(lease, Execution.fence lease, observed) |> counters.record
        if outcome = "Applied" then
            let session, physical = Execution.identity lease |> Execution.exact
            retirePhysical session physical
        outcome
    member _.tryRead(session: string, physical: string) =
        match Execution.normalizeExact session physical with
        | Some(session, physical) ->
            match active.TryGetValue session with
            | true, lease when lease.Physical = Some physical && not (superseded.Contains(session, physical)) -> permits.committed(session, physical)
            | _ -> null
        | None -> null
    member _.retainInput(lease: obj, physical: string) =
        let identity, _, target = requireCurrent lease "input no longer owns its previous model lease"
        retained[(Execution.text identity "sessionId", physical)] <- lease
        target
    member _.tryInput(session: string, physical: string) =
        match retained.TryGetValue((session, physical)) with true, lease -> lease | _ -> null
    member _.cancelInput(session: string, physical: string) = cancelInputKey (session, physical)
    member _.cancelSessionInputs(session: string) =
        Execution.normalizeText session |> Option.iter (fun session ->
            retained.Keys |> Seq.filter (fun (owner, _) -> owner = session) |> Seq.toArray |> Array.iter cancelInputKey)
    member _.``continue``(lease: obj, physical: string, ?selectedTarget: obj) : Task<obj> =
        try continueExecution lease physical (selectedTarget |> Option.bind Execution.optional) |> Task.FromResult
        with error -> Execution.failedTask<obj> error
    member _.wasSuperseded(session: string, physical: string) =
        Execution.normalizeExact session physical |> Option.exists superseded.Contains
    member _.wasStoppedSuperseded(session: string, physical: string) =
        Execution.normalizeExact session physical |> Option.exists (fun key -> superseded.Contains key && stopped.Contains key)
    member _.owns(session: string, physical: string) =
        Execution.normalizeExact session physical |> Option.exists (fun (session, physical) ->
            not (superseded.Contains(session, physical))
            && ((currentPhysical session = Some physical)
                || (pending.Current session |> Option.exists (fun demand -> demand.Request.Physical = physical))))
    member _.rememberStep(session: string, physical: string, providerRun: string) =
        match Execution.normalizeExact session physical, Execution.normalizeText providerRun with
        | Some(session, physical), Some providerRun -> runs.rememberStep(session, physical, providerRun)
        | _ -> ()
    member _.stepOf(providerRun: string) =
        Execution.normalizeText providerRun |> Option.map runs.stepOf |> Execution.nullable
    member _.activePhysical(session: string) = currentPhysical session |> Option.map box |> Execution.nullable
    member _.dropSession(session: string) = bound.Remove session |> ignore
    member _.setBoundReader(reader: string -> obj) = boundReader <- Some reader
    member _.seedBoundTarget(session: string, value: string) =
        let target = protocol.decodeDurableTarget(box value)
        match bound.TryGetValue session with
        | true, previous when not (Execution.sameTarget previous target) -> bindingError "durable" previous target
        | _ -> bound[session] <- target
    member _.boundTarget(session: string) = match bound.TryGetValue session with true, target -> target | _ -> null
    member _.releaseSession(session: string) =
        match Execution.normalizeText session with
        | None -> "Conflict"
        | Some session ->
            let outcome = currentPhysical session |> Option.map (fun physical -> permits.releasePhysical(session, physical) |> counters.record)
                          |> Option.defaultWith (fun () -> pending.Cancel session)
            if outcome = "Applied" then retireSession session
            outcome
    member _.releasePhysical(session: string, physical: string) =
        let released result = createObj [ "kind" ==> "Released"; "outcome" ==> result ]
        match Execution.normalizeExact session physical with
        | None -> released "Conflict"
        | Some(session, physical) ->
            let key = session, physical
            runs.forgetPhysical(session, physical)
            cancelInputKey key
            if hasInput key then
                held.Add key |> ignore
                Execution.outcome "HeldForInput"
            else releasePhysicalKey key |> released
    member _.cancelPending(session: string) =
        Execution.normalizeText session |> Option.map pending.Cancel |> Option.defaultValue "Conflict"
    member _.cancelPendingPhysical(session: string, physical: string) =
        match Execution.normalizeExact session physical with
        | None -> "Conflict"
        | Some(session, physical) ->
            cancelInputKey (session, physical)
            match pending.Current session with
            | Some demand when demand.Request.Physical = physical -> pending.Cancel session
            | Some _ -> "StaleFence"
            | None -> releasePhysicalKey (session, physical)
    member _.releasePendingPhysical(session: string, physical: string) =
        match Execution.normalizeExact session physical with
        | None -> "Conflict"
        | Some(session, physical) ->
            permits.releasePendingPhysical(session, physical)
            |> counters.record
            |> completePhysical session physical
    member _.snapshot() = capacitySnapshot()
    member _.holdsPhysical(session: string, physical: string) =
        let value = capacitySnapshot()
        let exact owner = Execution.exact owner = (session, physical)
        Execution.array value "owners" |> Array.exists exact
        || (Execution.array value "custodies" |> Array.exists (fun custody -> exact (Execution.field custody "owner")))
        || retained.ContainsKey((session, physical))
    member _.enterStep(input: obj) : Task =
        match Execution.normalizeExact (Execution.text input "sessionId") (Execution.text input "physicalUserMessageId") with
        | None -> Execution.failedTask<unit>(ArgumentException("provider step identity must be non-empty")) :> Task
        | Some(session, physical) ->
            let visible = unbox<string array> (Execution.field input "visibleProviderRuns") |> Array.distinct |> Array.sort
            let requestKey = Execution.field input "requestKey" |> Execution.optional |> Option.map unbox<string>
            enterStepRequest session physical visible requestKey
    member _.endStep(session: string, physical: string, providerRun: string) =
        match Execution.normalizeExact session physical, Execution.normalizeText providerRun with
        | Some(session, physical), Some providerRun ->
            match active.TryGetValue session with
            | true, lease when lease.Physical = Some physical -> runs.remember(session, providerRun, lease.Target)
            | _ -> ()
            runs.rememberStep(session, physical, providerRun)
            capacity.endStep(session, physical, providerRun)
            clearStepTasks session physical
            drainHealthy()
        | _ -> ()
    member _.suppressStep(session: string, physical: string) =
        match Execution.normalizeExact session physical with
        | None -> ()
        | Some(session, physical) ->
            stopped.Add(session, physical) |> ignore
            capacity.suppressStep(session, physical)
            clearStepTasks session physical
            drainHealthy()
    member _.occupied() = capacity.snapshot()
    member _.pendingCount = pending.Count
    member _.pendingBound = 32
    member _.pendingContractVersion = 1
    member _.takeRunTarget(providerRun: string) =
        runs.take providerRun |> Execution.optional |> Option.map (fun value -> Execution.field value "target") |> Execution.nullable
    member _.hasTheoreticalCapacity(role: string, ?purpose: string) =
        ignore purpose
        theoretical role
