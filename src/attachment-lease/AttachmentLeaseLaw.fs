module Wanxiangli.AttachmentLease.AttachmentLeaseLaw

open Fable.Core
open Fable.Core.JsInterop
open System.Threading.Tasks
open Wanxiangli.AttachmentLease.AttachmentLeaseRegistry

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/attachment-lease: malformed %s" what))

let private text (what: string) (value: obj) : string =
    if isString value then unbox<string> value else malformed what

let private optionalText (what: string) (value: obj) : string option =
    if isAbsent value then None else Some(text what value)

type private Child =
    { Id: string
      Agent: string option
      Title: string option }

let private childOf (index: int) (value: obj) : Child =
    let what = sprintf "children[%d]" index

    if not (isObject value) then
        malformed what
    else
        { Id = text (what + ".sessionId") (field value "sessionId")
          Agent = optionalText (what + ".agent") (field value "agent")
          Title = optionalText (what + ".title") (field value "title") }

let private originOf (value: obj) : string =
    match value with
    | v when isString v && (unbox<string> v = "Created" || unbox<string> v = "Reused" || unbox<string> v = "Replacement") ->
        unbox<string> v
    | _ -> malformed "origin"

let private create (origin: string) (closeReplaced: bool) : obj =
    freeze (
        createObj
            [ "verdict" ==> "create"
              "origin" ==> origin
              "closeReplacedBeforeLink" ==> closeReplaced ]
    )

let private reject (rejection: string) (child: string) : obj =
    freeze (
        createObj
            [ "verdict" ==> "reject"
              "rejection" ==> rejection
              "child" ==> child ]
    )

/// managed-session-lifecycle [001]/[003]: which child one Attached kind's lease
/// uses, and what a fresh child owes the caller when its association fails. Pure:
/// the caller lists the owner's children, performs create/close/link/abort and
/// holds the registry.
[<AttachMembers>]
type AttachmentLeaseLaw() =
    member _.contractVersion: int = 1

    /// Judge the lease of one kind. `restoreHint` is the child the kind's durable
    /// association names (null when none); `agent`/`title` are the kind's
    /// parameters; `children` is what the Host reports for the owner.
    member _.resolve(input: obj) : obj =
        if not (isObject input) then malformed "input"
        let hint = optionalText "restoreHint" (field input "restoreHint")
        let agent = text "agent" (field input "agent")
        let title = text "title" (field input "title")
        let children = field input "children"
        if not (isArray children) then malformed "children"

        let children =
            unbox<obj array> children |> Array.mapi childOf |> Array.toList

        match hint with
        // No durable association: never adopt a look-alike child ([003] 不收养无关联会话).
        | None -> create "Created" false
        | Some hint ->
            match children |> List.filter (fun child -> child.Id = hint) with
            | [ child ] when child.Agent = Some agent && child.Title = Some title ->
                freeze (createObj [ "verdict" ==> "reuse"; "child" ==> child.Id ])
            | [ _ ] -> reject "Conflicting" hint
            // The association names a child the Host no longer has: a real
            // transition, so the vanished association is closed before the new link.
            | [] -> create "Replacement" true
            | _ -> reject "Ambiguous" hint

    /// A created or replacement child that fails to be closed-over or linked is
    /// aborted; a reused child was already real and is never aborted.
    member _.abortOnFailure(origin: obj) : bool = originOf origin <> "Reused"

type private SessionRequest =
    abstract owner: string
    abstract kind: string
    abstract agent: string
    abstract directory: obj
    abstract title: string
    abstract restoreHint: obj

type private AssociatedEffects =
    abstract list: obj -> Task<obj>
    abstract create: obj -> Task<obj>
    abstract abort: obj -> Task<obj>
    abstract link: obj -> Task<obj>
    abstract close: obj -> Task<obj>
    abstract rejection: obj -> string

type private AttachedEffects =
    abstract isUsable: string -> bool
    abstract observe: obj -> Task<obj>
    abstract create: obj -> Task<obj>
    abstract link: obj -> Task<obj>

type private RetireEffects =
    abstract abort: obj -> Task<obj>
    abstract close: obj -> Task<obj>

module private Sessions =
    let resultOf (value: obj) : Result<obj, string> =
        if unbox<bool> (field value "ok") then Ok(field value "value")
        else Error(unbox<string> (field value "error"))

    let resultToJs (result: Result<obj, string>) : obj =
        match result with
        | Ok value -> createObj [ "ok" ==> true; "value" ==> value ]
        | Error reason -> createObj [ "ok" ==> false; "error" ==> reason ]

    let unitResult () = resultToJs (Ok(box ()))
    let ownerRequest (owner: string) = createObj [ "owner" ==> owner ]
    let childRequest (child: obj) = createObj [ "sessionId" ==> child ]
    let lease (child: string) (origin: string) (agent: string) =
        createObj [ "sessionId" ==> child; "origin" ==> origin; "agent" ==> agent ]

    let leaseOf (stored: obj) =
        lease (unbox<string> (field stored "sessionId"))
            (unbox<string> (field stored "origin")) (unbox<string> (field stored "agent"))

    let createRequest (request: SessionRequest) =
        createObj [ "owner" ==> request.owner; "agent" ==> request.agent; "directory" ==> request.directory ]

    let linkRequest (request: SessionRequest) established =
        createObj [ "owner" ==> request.owner; "sessionId" ==> field established "sessionId"; "agent" ==> request.agent ]

    let keepFresh (law: AttachmentLeaseLaw) (effects: AssociatedEffects) established operation =
        task {
            let! result = operation
            match resultOf result with
            | Ok _ -> return Ok()
            | Error reason ->
                if law.abortOnFailure(field established "origin") then
                    let! _ = effects.abort (childRequest (field established "sessionId"))
                    ()
                return Error reason
        }

    let resolve (law: AttachmentLeaseLaw) (request: SessionRequest) (effects: AssociatedEffects) children =
        task {
            let verdict = law.resolve (createObj [
                "restoreHint" ==> request.restoreHint; "agent" ==> request.agent
                "title" ==> request.title; "children" ==> children ])
            match unbox<string> (field verdict "verdict") with
            | "reuse" -> return Ok(lease (unbox<string> (field verdict "child")) "Reused" request.agent, false)
            | "create" ->
                let! created = effects.create (createRequest request)
                return resultOf created |> Result.map (fun child ->
                    lease (unbox<string> child) (unbox<string> (field verdict "origin")) request.agent,
                    unbox<bool> (field verdict "closeReplacedBeforeLink"))
            | _ ->
                let rejection = createObj [
                    "owner" ==> request.owner; "kind" ==> request.kind
                    "child" ==> field verdict "child"; "rejection" ==> field verdict "rejection" ]
                return Error(effects.rejection rejection)
        }

    let finish (law: AttachmentLeaseLaw) (request: SessionRequest) (effects: AssociatedEffects) established closeFirst =
        task {
            let! closed =
                if closeFirst then effects.close (ownerRequest request.owner) |> keepFresh law effects established
                else Task.FromResult(Ok())
            match closed with
            | Error reason -> return Error reason
            | Ok () ->
                let! linked = effects.link (linkRequest request established) |> keepFresh law effects established
                return linked |> Result.map (fun () -> established)
        }

    let establish law (request: SessionRequest) (effects: AssociatedEffects) =
        task {
            let! listed = effects.list (ownerRequest request.owner)
            match resultOf listed with
            | Error reason -> return Error reason
            | Ok children ->
                let! resolved = resolve law request effects children
                match resolved with
                | Error reason -> return Error reason
                | Ok(established, closeFirst) -> return! finish law request effects established closeFirst
        }

    let attachedRequest (request: SessionRequest) hint : SessionRequest =
        unbox (createObj [
            "owner" ==> request.owner; "kind" ==> request.kind; "agent" ==> request.agent
            "title" ==> ""; "directory" ==> request.directory; "restoreHint" ==> hint ])

    let attachedOperations (request: SessionRequest) (effects: AttachedEffects) hint : AssociatedEffects =
        let children =
            if isAbsent hint then [||]
            else [| createObj [ "sessionId" ==> hint; "agent" ==> request.agent; "title" ==> "" ] |]
        unbox (createObj [
            "list" ==> (fun (_: obj) -> Task.FromResult(resultToJs (Ok(box children))))
            "create" ==> (fun (value: obj) -> effects.create value)
            "abort" ==> (fun (_: obj) -> Task.FromResult(unitResult ()))
            "link" ==> (fun (value: obj) -> effects.link value)
            "close" ==> (fun (_: obj) -> Task.FromResult(unitResult ()))
            "rejection" ==> (fun (_: obj) -> (invalidOp "attachment observation projection was rejected": string)) ])

[<AttachMembers>]
type AttachmentSessions(registry: AttachmentLeaseRegistry) =
    let law = AttachmentLeaseLaw()

    let bound (owner: string) (kind: string) (isUsable: string -> bool) =
        registry.tryFind(owner, kind)
        |> Option.filter (fun stored -> isUsable (unbox<string> (field stored "sessionId")))
        |> Option.map Sessions.leaseOf

    let bindResult (request: SessionRequest) pending =
        task {
            let! result = pending
            match Sessions.resultOf result with
            | Error _ -> ()
            | Ok established -> registry.bind(request.owner, request.kind, established)
            return result
        }

    member _.getOrCreate(input: obj, operations: obj) : Task<obj> =
        let request: SessionRequest = unbox input
        let effects: AttachedEffects = unbox operations
        match bound request.owner request.kind effects.isUsable with
        | Some established -> Task.FromResult(Sessions.resultToJs (Ok established))
        | None ->
            let start () =
                task {
                    let! observed = effects.observe (createObj [
                        "owner" ==> request.owner; "kind" ==> request.kind; "agent" ==> request.agent ])
                    match Sessions.resultOf observed with
                    | Error reason -> return Sessions.resultToJs (Error reason)
                    | Ok hint ->
                        try
                            let! result = Sessions.establish law (Sessions.attachedRequest request hint)
                                                (Sessions.attachedOperations request effects hint)
                            return Sessions.resultToJs result
                        finally
                            registry.finishEnsure(request.owner, request.kind)
                }
            registry.ensure(request.owner, request.kind, box start)
            |> unbox<Task<obj>>
            |> bindResult request

    member _.ensureAssociated(input: obj, operations: obj) : Task<obj> =
        let request: SessionRequest = unbox input
        let effects: AssociatedEffects = unbox operations
        let start () =
            task {
                try
                    let! result = Sessions.establish law request effects
                    return Sessions.resultToJs result
                finally
                    registry.finishEnsure(request.owner, request.kind)
            }
        registry.ensure(request.owner, request.kind, box start)
        |> unbox<Task<obj>>
        |> bindResult request

    member _.retireAssociated(owner: string, kind: string, operations: obj) : Task<obj> =
        let effects: RetireEffects = unbox operations
        task {
            match registry.tryFind(owner, kind) with
            | None ->
                registry.finishEnsure(owner, kind)
                return! effects.close (Sessions.ownerRequest owner)
            | Some established ->
                let! aborted = effects.abort (Sessions.childRequest (field established "sessionId"))
                let! closed = effects.close (Sessions.ownerRequest owner)
                registry.remove(owner, kind) |> ignore
                registry.finishEnsure(owner, kind)
                match Sessions.resultOf aborted, Sessions.resultOf closed with
                | Error reason, _ | _, Error reason -> return Sessions.resultToJs (Error reason)
                | Ok _, Ok _ -> return Sessions.unitResult ()
        }

    member _.tryFind(owner: string, kind: string, isUsable: string -> bool) : obj =
        bound owner kind isUsable |> Option.defaultValue null

    member _.tryFindOwner(child: string, kind: string) : obj =
        registry.tryFindByChild child
        |> Array.tryFind (fun entry -> unbox<string> (field entry "kind") = kind)
        |> Option.map (fun entry -> field entry "owner")
        |> Option.defaultValue null

    member _.remove(owner: string, kind: string) = registry.remove(owner, kind)
    member _.removeByChild(child: string) = registry.removeByChild child |> Array.isEmpty |> not
    member _.clearKinds(kinds: string array) =
        for entry in registry.snapshot() do
            let kind = unbox<string> (field entry "kind")
            if Array.contains kind kinds then registry.remove(field entry "owner", kind) |> ignore
