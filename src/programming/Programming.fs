
module Wanxiangli.Programming.Programming

open Fable.Core
open Fable.Core.JsInterop

module internal Wire =
    [<Emit("typeof $0 === 'string'")>]
    let isString (_: obj) : bool = jsNative

    [<Emit("Array.isArray($0) ? $0.filter(function (x) { return typeof x === 'string'; }) : []")>]
    let stringArray (_: obj) : string array = jsNative

module internal Projection =
    let ofOfficePermission (label: string) : string option =
        match label with
        | "Read" -> Some "Read"
        | "Write" -> Some "Write"
        | "Glob" -> Some "Glob"
        | "Grep" -> Some "Grep"
        | "Move" -> Some "Move"
        | "Remove" -> Some "Remove"
        | "Exec" -> Some "Exec"
        | "Fork" -> Some "Fork"
        | "Resume" -> Some "Resume"
        | "DevOpsConsultation" -> Some "DevOps"
        | "Join" -> Some "Join"
        | "Fission" -> Some "Fission"
        | "Horizon" -> Some "Horizon"
        | "Advisor" -> Some "Advisor"
        | "Ask" -> Some "Ask"
        | "ReviewAssessment"
        | "Review" -> Some "Review"
        | _ -> None

    let expand (labels: string array) : Set<string> =
        let mutable acc = Set.empty
        for label in labels do
            if label = "JsPlan" then
                acc <- acc |> Set.add "Read" |> Set.add "Write" |> Set.add "Ask"
            else
                match ofOfficePermission label with
                | Some js -> acc <- Set.add js acc
                | None -> ()
        acc

    let fragments: (string * string * string list) list =
        [ "Write", "write", []
          "Remove", "rm", []
          "Move", "mv", []
          "Read", "cat", []
          "Glob", "ls", []
          "Grep", "rg", []
          "Read", "stat", []
          "Write", "mkdir", []
          "Read", "whereAll", []
          "Read", "where", []
          "Exec", "call", []
          "Fork", "fork", []
          "Resume", "resume", []
          "Commission", "commission", []
          "DevOps", "devops", []
          "Fork", "dag", [ "Join" ]
          "Join", "join", []
          "Fission", "fission", []
          "Horizon", "horizon", []
          "Advisor", "advisor", []
          "Ask", "ask", []
          "Review", "review", [] ]

    let isProjected (capabilities: Set<string>) (capability: string) (extra: string list) : bool =
        Set.contains capability capabilities
        && List.forall (fun c -> Set.contains c capabilities) extra

    let membersFor (capabilities: Set<string>) (roleName: string) : string array =
        let manager = roleName.Trim().ToLowerInvariant() = "manager"
        fragments
        |> List.choose (fun (cap, name, extra) ->
            if isProjected capabilities cap extra then
                let memberName =
                    if manager && List.contains name [ "cat"; "stat"; "ls"; "rg" ] then
                        "reviewOnly." + name
                    else
                        name
                Some memberName
            else
                None)
        |> List.toArray

    let forOrchestrator (capabilities: Set<string>) : Set<string> =
        if Set.contains "Fork" capabilities then
            capabilities |> Set.remove "Fork" |> Set.add "Commission"
        else
            capabilities

type ProgrammingMessages =
    abstract projectPermission: label: obj -> obj
    abstract projectPermissions: labels: obj -> string array
    abstract admitsSurface: labels: obj -> bool
    abstract toolNameFor: role: obj -> string
    abstract membersFor: jsCapabilities: obj * roleName: obj -> string array
    abstract projectRole: role: obj * officePermissions: obj -> obj

let Programming () : ProgrammingMessages =
    { new ProgrammingMessages with
        member _.projectPermission(label) =
            if Wire.isString label then
                match Projection.ofOfficePermission (unbox<string> label) with
                | Some v -> box v
                | None -> null
            else
                null

        member _.projectPermissions(labels) =
            Projection.expand (Wire.stringArray labels) |> Set.toList |> List.sort |> List.toArray

        member this.admitsSurface(labels) =
            this.projectPermissions(labels).Length > 0

        member _.toolNameFor(role) =
            let name = if Wire.isString role then unbox<string> role else ""
            "todowrite-for-" + name.ToLowerInvariant()

        member _.membersFor(jsCapabilities, roleName) =
            let caps = Wire.stringArray jsCapabilities |> Set.ofArray
            let role = if Wire.isString roleName then unbox<string> roleName else ""
            Projection.membersFor caps role

        member this.projectRole(role, officePermissions) =
            let roleName = if Wire.isString role then unbox<string> role else ""
            let projected = this.projectPermissions(officePermissions) |> Set.ofArray
            let caps =
                if roleName.Trim().ToLowerInvariant() = "orchestrator" then
                    Projection.forOrchestrator projected
                else
                    projected
            if Set.isEmpty caps then
                null
            else
                createObj
                    [ "toolName" ==> ("todowrite-for-" + roleName.ToLowerInvariant())
                      "capabilities" ==> (caps |> Set.toList |> List.sort |> List.toArray)
                      "members" ==> Projection.membersFor caps roleName ] }
