namespace Wanxiangli.Ownership

open Wire

type internal Lease = { Registry: string; Resource: string; Token: string }
type internal Binding = { External: string; Incarnation: string }

[<RequireQualifiedAccess>]
type internal Message =
    | OpenScope of id: string * parent: string option
    | Reserve of id: string * scope: string * kind: string
    | Started of Lease * Binding
    | Ended of Lease * Binding * outcome: string
    | NotStarted of Lease * reason: string
    | Unknown of Lease
    | Cancel of Lease
    | Drain of scope: string
    | Close of scope: string

module internal Message =
    let private choice allowed value =
        let value = text value
        require (List.contains value allowed) "Unknown protocol choice"
        value

    let readLease value =
        exact [ "registryId"; "resourceId"; "token" ] value
        { Registry = field value "registryId" |> identifier
          Resource = field value "resourceId" |> identifier
          Token = field value "token" |> identifier }

    let private readBinding value =
        exact [ "externalId"; "incarnationId" ] value
        { External = field value "externalId" |> identifier
          Incarnation = field value "incarnationId" |> identifier }

    let lease value = make [ "registryId", box value.Registry; "resourceId", box value.Resource; "token", box value.Token ]
    let binding value = make [ "externalId", box value.External; "incarnationId", box value.Incarnation ]

    let decode value =
        let read key = field value key
        let check names = exact ("type" :: names) value
        let scope () = read "scopeId" |> identifier
        let reference () = read "lease" |> readLease
        let physical () = read "binding" |> readBinding
        match read "type" |> text with
        | "OpenScope" ->
            check [ "scopeId"; "parentId" ]
            let parent = if isNull (read "parentId") then None else Some(read "parentId" |> identifier)
            Message.OpenScope(scope (), parent)
        | "Reserve" ->
            check [ "resourceId"; "scopeId"; "kind" ]
            Message.Reserve(read "resourceId" |> identifier, scope (), read "kind" |> choice [ "session"; "process"; "tool"; "job"; "provider"; "effect" ])
        | "Started" ->
            check [ "lease"; "binding" ]
            Message.Started(reference (), physical ())
        | "Ended" ->
            check [ "lease"; "binding"; "outcome" ]
            Message.Ended(reference (), physical (), read "outcome" |> choice [ "Completed"; "Failed"; "Cancelled" ])
        | "NotStarted" ->
            check [ "lease"; "reason" ]
            Message.NotStarted(reference (), read "reason" |> reason)
        | "Unknown" ->
            check [ "lease" ]
            Message.Unknown(reference ())
        | "Cancel" ->
            check [ "lease" ]
            Message.Cancel(reference ())
        | "Drain" ->
            check [ "scopeId" ]
            Message.Drain(scope ())
        | "Close" ->
            check [ "scopeId" ]
            Message.Close(scope ())
        | _ -> invalidOp "Unknown ownership message"

    let encode message =
        let tagged name fields = make (("type", box name) :: fields)
        let physical reference target = [ "lease", lease reference; "binding", binding target ]
        match message with
        | Message.OpenScope(id, parent) -> tagged "OpenScope" [ "scopeId", box id; "parentId", parent |> Option.map box |> Option.defaultValue null ]
        | Message.Reserve(id, scope, kind) -> tagged "Reserve" [ "resourceId", box id; "scopeId", box scope; "kind", box kind ]
        | Message.Started(reference, target) -> tagged "Started" (physical reference target)
        | Message.Ended(reference, target, outcome) -> tagged "Ended" (("outcome", box outcome) :: physical reference target)
        | Message.NotStarted(reference, reason) -> tagged "NotStarted" [ "lease", lease reference; "reason", box reason ]
        | Message.Unknown reference -> tagged "Unknown" [ "lease", lease reference ]
        | Message.Cancel reference -> tagged "Cancel" [ "lease", lease reference ]
        | Message.Drain scope -> tagged "Drain" [ "scopeId", box scope ]
        | Message.Close scope -> tagged "Close" [ "scopeId", box scope ]
