module Wanxiangli.Ownership.Ownership

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Ownership
open Wire

[<AllowNullLiteral>]
type OwnershipMessages =
    abstract execute: requestId: string * message: obj -> obj
    abstract inspect: unit -> obj
    abstract scope: scopeId: string -> obj
    abstract resource: lease: obj -> obj
    abstract blockers: scopeId: string -> obj array
    abstract records: unit -> string array
    abstract head: unit -> obj

type private Scope(id: string, parent: string option) =
    let children = ResizeArray<Scope>()
    let resources = ResizeArray<string>()
    member _.Id = id
    member _.Parent = parent
    member _.Children = children
    member _.Resources = resources
    member val Draining = false with get, set
    member val Closed = false with get, set

[<RequireQualifiedAccess>]
type private Terminal = Ended of string | NotStarted of string

type private Resource(reference: Lease, scope: Scope, kind: string, order: int) =
    member _.Lease = reference
    member _.Scope = scope
    member _.Kind = kind
    member _.Order = order
    member val Binding: Binding option = None with get, set
    member val Terminal: Terminal option = None with get, set
    member val CancelRequested = false with get, set

type private Entry =
    { Message: string; Result: string; Record: string; Digest: string }

let Ownership (registryId: string) (initialRecords: obj): OwnershipMessages =
    let registryId = identifier (box registryId)
    let genesis = sha256 (tupleKey [ "ownership-origin-v1"; registryId ])
    let entries = ResizeArray<Entry>()
    let requests = Dictionary<string, int>()
    let scopes = Dictionary<string, Scope>()
    let resources = Dictionary<string, Resource>()
    let activeBindings = Dictionary<string, string>()
    let instances = Dictionary<string, string>()
    let mutable busy = false

    let guard action =
        require (not busy) "Ownership does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let findScope id =
        match scopes.TryGetValue id with
        | true, scope -> scope
        | _ -> invalidOp "Scope does not exist"

    let findResource reference =
        require (reference.Registry = registryId) "Foreign registry lease"
        match resources.TryGetValue reference.Resource with
        | true, resource ->
            require (resource.Lease = reference) "Lease does not match this resource"
            resource
        | _ -> invalidOp "Resource does not exist"

    let openAdmission (scope: Scope) =
        require (not scope.Closed && not scope.Draining) "Scope admission is closed"

    let subtree scope =
        let pending = Stack<Scope>()
        let result = ResizeArray<Scope>()
        pending.Push scope
        while pending.Count > 0 do
            let current = pending.Pop()
            result.Add current
            for child in current.Children do pending.Push child
        result.ToArray()

    let unsettled scope =
        subtree scope
        |> Array.collect (fun node -> node.Resources.ToArray())
        |> Array.map (fun id -> resources[id])
        |> Array.filter (fun resource -> resource.Terminal.IsNone)
        |> Array.sortBy (fun resource -> resource.Order)

    let externalKey (resource: Resource) (target: Binding) = tupleKey [ resource.Kind; target.External ]
    let instanceKey (resource: Resource) (target: Binding) = tupleKey [ resource.Kind; target.External; target.Incarnation ]

    let checkInstance (resource: Resource) target =
        match instances.TryGetValue(instanceKey resource target) with
        | true, owner -> require (owner = resource.Lease.Resource) "Physical incarnation already belongs to another resource"
        | _ -> ()

    let rememberInstance (resource: Resource) target =
        instances[instanceKey resource target] <- resource.Lease.Resource

    let resourceResult kind (reference: Lease) = make [ "kind", box kind; "lease", Message.lease reference ]
    let scopeResult kind id = make [ "kind", box kind; "scopeId", box id ]

    // 所有检查都先完成；返回的私有动作只提交本对象的状态，不调用参与者。
    let prepare message: (unit -> unit) option * obj =
        match message with
        | Message.OpenScope(id, parent) ->
            match scopes.TryGetValue id with
            | true, existing ->
                require (existing.Parent = parent) "Scope identity or parent conflict"
                None, scopeResult "ScopeOpened" id
            | _ ->
                require (parent <> Some id) "Scope cannot own itself"
                let owner = parent |> Option.map findScope
                owner |> Option.iter openAdmission
                let scope = Scope(id, parent)
                Some(fun () ->
                    scopes.Add(id, scope)
                    owner |> Option.iter (fun node -> node.Children.Add scope)), scopeResult "ScopeOpened" id
        | Message.Reserve(id, scopeId, kind) ->
            match resources.TryGetValue id with
            | true, existing ->
                require (existing.Scope.Id = scopeId && existing.Kind = kind) "Resource identity or owner conflict"
                None, resourceResult "Reserved" existing.Lease
            | _ ->
                let scope = findScope scopeId
                openAdmission scope
                let reference =
                    { Registry = registryId; Resource = id
                      Token = sha256 (tupleKey [ "ownership-lease-v1"; registryId; id; scopeId; kind ]) }
                let resource = Resource(reference, scope, kind, entries.Count + 1)
                Some(fun () ->
                    resources.Add(id, resource)
                    scope.Resources.Add id), resourceResult "Reserved" reference
        | Message.Started(reference, target) ->
            let resource = findResource reference
            match resource.Binding with
            | Some existing ->
                require (existing = target) "Physical binding conflict"
                None, resourceResult "Started" reference
            | None ->
                require resource.Terminal.IsNone "Resource was already confirmed not started"
                checkInstance resource target
                require (not (activeBindings.ContainsKey(externalKey resource target))) "Physical container is already active"
                Some(fun () ->
                    resource.Binding <- Some target
                    rememberInstance resource target
                    activeBindings.Add(externalKey resource target, reference.Resource)), resourceResult "Started" reference
        | Message.Ended(reference, target, outcome) ->
            let resource = findResource reference
            match resource.Terminal with
            | Some terminal ->
                require (terminal = Terminal.Ended outcome && resource.Binding = Some target) "Terminal observation conflict"
                None, resourceResult "Ended" reference
            | None ->
                require (resource.Binding.IsNone || resource.Binding = Some target) "Physical binding conflict"
                checkInstance resource target
                Some(fun () ->
                    resource.Binding <- Some target
                    resource.Terminal <- Some(Terminal.Ended outcome)
                    rememberInstance resource target
                    match activeBindings.TryGetValue(externalKey resource target) with
                    | true, owner when owner = reference.Resource -> activeBindings.Remove(externalKey resource target) |> ignore
                    | _ -> ()), resourceResult "Ended" reference
        | Message.NotStarted(reference, reason) ->
            let resource = findResource reference
            match resource.Terminal with
            | Some terminal ->
                require (terminal = Terminal.NotStarted reason) "Terminal observation conflict"
                None, resourceResult "NotStarted" reference
            | None ->
                require resource.Binding.IsNone "A started resource cannot be declared not started"
                Some(fun () -> resource.Terminal <- Some(Terminal.NotStarted reason)), resourceResult "NotStarted" reference
        | Message.Unknown reference ->
            findResource reference |> ignore
            None, resourceResult "Unknown" reference
        | Message.Cancel reference ->
            let resource = findResource reference
            if resource.Terminal.IsSome then None, resourceResult "Settled" reference
            else
                let change = if resource.CancelRequested then None else Some(fun () -> resource.CancelRequested <- true)
                change, resourceResult "CancellationRequested" reference
        | Message.Drain id ->
            let scope = findScope id
            let nodes = subtree scope |> Array.filter (fun node -> not node.Draining && not node.Closed)
            let change = if nodes.Length = 0 then None else Some(fun () -> for scope in nodes do scope.Draining <- true)
            change, scopeResult (if scope.Closed then "Closed" else "Draining") id
        | Message.Close id ->
            let scope = findScope id
            require ((unsettled scope).Length = 0) "Scope still owns unsettled resources"
            let nodes = subtree scope |> Array.filter (fun node -> not node.Closed)
            let change = if nodes.Length = 0 then None else Some(fun () -> for node in nodes do node.Closed <- true)
            change, scopeResult "Closed" id

    let digest () = if entries.Count = 0 then genesis else entries[entries.Count - 1].Digest
    let unsigned request message =
        make [ "registryId", box registryId; "revision", box (entries.Count + 1)
               "previous", box (digest ()); "requestId", box request; "message", Message.encode message ]

    let record (frame: obj) checksum =
        make [ "registryId", field frame "registryId"; "revision", field frame "revision"
               "previous", field frame "previous"; "requestId", field frame "requestId"
               "message", field frame "message"; "digest", box checksum ] |> canonical

    let accept request encoded result body checksum apply =
        let result = canonical result
        apply ()
        entries.Add { Message = encoded; Result = result; Record = body; Digest = checksum }
        requests.Add(request, entries.Count)

    let restore input =
        let body = text input
        require (byteLength body <= 65536) "Ownership record exceeds 64 KiB"
        let frame = parse body
        exact [ "registryId"; "revision"; "previous"; "requestId"; "message"; "digest" ] frame
        require (canonical frame = body) "Noncanonical ownership record"
        require (identifier (field frame "registryId") = registryId) "Foreign registry record"
        require (number (field frame "revision") = float (entries.Count + 1)) "Ownership revision gap"
        require (text (field frame "previous") = digest ()) "Ownership chain mismatch"
        let request = field frame "requestId" |> identifier
        require (not (requests.ContainsKey request)) "Duplicate request in ownership history"
        let message = field frame "message" |> Message.decode
        let proposal = unsigned request message
        let checksum = sha256 (canonical proposal)
        require (text (field frame "digest") = checksum && record proposal checksum = body) "Ownership digest mismatch"
        let change, result = prepare message
        let apply = change |> Option.defaultWith (fun () -> invalidOp "History contains a non-changing observation")
        accept request (canonical (Message.encode message)) result body checksum apply

    do
        if not (Fable.Core.JsInterop.isNullOrUndefined initialRecords) then
            initialRecords |> array |> Array.iter restore

    let response status revision result body =
        make [ "status", box status; "revision", box revision; "result", result; "record", body ]

    let execute request input =
        guard (fun () ->
            let request = identifier (box request)
            let message = Message.decode input
            let encoded = canonical (Message.encode message)
            match requests.TryGetValue request with
            | true, revision ->
                let entry = entries[revision - 1]
                require (entry.Message = encoded) "Request identity conflict"
                response "Replayed" revision (parse entry.Result) (box entry.Record)
            | _ ->
                let change, result = prepare message
                match change with
                | None -> response "Observed" entries.Count result (null: obj)
                | Some apply ->
                    require (entries.Count < 2147483646) "Ownership revision capacity exceeded"
                    let proposal = unsigned request message
                    let checksum = sha256 (canonical proposal)
                    let body = record proposal checksum
                    require (byteLength body <= 65536) "Ownership record exceeds 64 KiB"
                    accept request encoded result body checksum apply
                    response "Applied" entries.Count result (box body))

    let view (resource: Resource) =
        let phase, outcome, reason =
            match resource.Terminal with
            | Some(Terminal.Ended outcome) -> "Ended", box outcome, null
            | Some(Terminal.NotStarted reason) -> "NotStarted", null, box reason
            | None -> (if resource.Binding.IsSome then "Running" else "Reserved"), null, null
        make [ "lease", Message.lease resource.Lease; "scopeId", box resource.Scope.Id; "kind", box resource.Kind
               "phase", box phase; "binding", resource.Binding |> Option.map Message.binding |> Option.defaultValue null
               "outcome", outcome; "reason", reason
               "cancellationRequested", box (resource.CancelRequested || resource.Scope.Draining) ]

    { new OwnershipMessages with
        member _.execute(request, input) = execute request input
        member _.inspect() =
            guard (fun () ->
                make [ "registryId", box registryId; "revision", box entries.Count
                       "scopes", box scopes.Count; "resources", box resources.Count
                       "unsettled", box (resources.Values |> Seq.filter (fun resource -> resource.Terminal.IsNone) |> Seq.length)
                       "roots", box (scopes.Values |> Seq.filter (fun scope -> scope.Parent.IsNone) |> Seq.map (fun scope -> scope.Id) |> Seq.sort |> Seq.toArray) ])
        member _.scope(id) =
            guard (fun () ->
                let scope = findScope (identifier (box id))
                make [ "scopeId", box scope.Id; "parentId", scope.Parent |> Option.map box |> Option.defaultValue null
                       "phase", box (if scope.Closed then "Closed" elif scope.Draining then "Draining" else "Open")
                       "children", box (scope.Children |> Seq.map (fun child -> child.Id) |> Seq.toArray)
                       "unsettled", box (unsettled scope).Length ])
        member _.resource(reference) = guard (fun () -> Message.readLease reference |> findResource |> view)
        member _.blockers(id) = guard (fun () -> findScope (identifier (box id)) |> unsettled |> Array.map view)
        member _.records() = guard (fun () -> entries |> Seq.map (fun entry -> entry.Record) |> Seq.toArray)
        member _.head() = guard (fun () -> make [ "registryId", box registryId; "revision", box entries.Count; "digest", box (digest ()) ]) }


[<AttachMembers>]
type SessionTopologyStore() =
    let parents = System.Collections.Generic.Dictionary<string, string>()
    let directories = System.Collections.Generic.Dictionary<string, string>()

    member _.parentsMap = parents
    member _.directoriesMap = directories

    member _.putParent(childId: string, parentId: string) : unit =
        parents.[childId] <- parentId

    member _.getParent(childId: string) : string =
        match parents.TryGetValue(childId) with
        | true, v -> v
        | false, _ -> null

    member _.tryGetParent(childId: string) : string option =
        match parents.TryGetValue(childId) with
        | true, v -> Some v
        | false, _ -> None

    member _.removeParent(childId: string) : bool =
        parents.Remove(childId)

    member _.clearParents() : unit =
        parents.Clear()

    member _.putDirectory(sessionId: string, directory: string) : unit =
        directories.[sessionId] <- directory

    member _.getDirectory(sessionId: string) : string =
        match directories.TryGetValue(sessionId) with
        | true, v -> v
        | false, _ -> null

    member _.tryGetDirectory(sessionId: string) : string option =
        match directories.TryGetValue(sessionId) with
        | true, v -> Some v
        | false, _ -> None

    member _.removeDirectory(sessionId: string) : bool =
        directories.Remove(sessionId)

    member _.clearDirectories() : unit =
        directories.Clear()

    member _.clearSession(sessionId: string) : unit =
        parents.Remove(sessionId) |> ignore
        directories.Remove(sessionId) |> ignore

    member _.clearAll() : unit =
        parents.Clear()
        directories.Clear()

let sessionTopologyStore = SessionTopologyStore()

[<AttachMembers>]
type SignalBroadcaster() =
    let listeners = ResizeArray<obj -> obj>()

    member _.subscribe(listener: obj -> obj) : obj =
        listeners.Add(listener)
        createObj [ "dispose" ==> (fun () -> listeners.Remove(listener) |> ignore) ]

    member _.snapshot() : (obj -> obj) array =
        listeners.ToArray()
