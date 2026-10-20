module Wanxiangli.AttachmentLease.AttachmentLeaseLaw

open Fable.Core
open Fable.Core.JsInterop

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
