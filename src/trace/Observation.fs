namespace Wanxiangli.Trace

open Wire

type internal MessageInfo =
    { Id: string; Role: string; Origin: string; Run: string option }

type internal PartInfo =
    { Message: string; Id: string; Index: float; Kind: string; Base64: string }

[<RequireQualifiedAccess>]
type internal Observation =
    | Opening of string
    | RunStarted of string
    | MessageObserved of MessageInfo
    | PartConfirmed of PartInfo
    | MessageFinished of message: string * count: float
    | RunFinished of run: string * outcome: string

module internal Observation =
    let private choice options value =
        let selected = text value
        require (List.contains selected options) "Unknown protocol choice"
        selected

    let decode fromRecord value =
        let read key = field value key
        // 通过属性描述读取 type，不执行访问器；各分支再核对完整形状。
        let tag = field value "type" |> text
        let check names = exact ("type" :: names) value
        let payloadName = if fromRecord then "base64" else "bytes"
        let payload () = read payloadName |> (if fromRecord then base64 else captureBytes)
        match tag with
        | "Opening" ->
            check [ payloadName ]
            Observation.Opening(payload ())
        | "RunStarted" ->
            check [ "runId" ]
            Observation.RunStarted(identifier (read "runId"))
        | "MessageObserved" ->
            check [ "messageId"; "role"; "origin"; "runId" ]
            let role = choice [ "user"; "assistant"; "tool"; "system" ] (read "role")
            let origin = choice [ "human"; "plugin"; "host-internal"; "provider" ] (read "origin")
            let run = if isNull (read "runId") then None else Some(identifier (read "runId"))
            if role = "assistant" || role = "tool" then
                require (origin = "provider" && run.IsSome) "Provider messages require an observed run"
            else
                require (origin <> "provider" && run.IsNone) "Non-provider messages have no run"
                require (origin <> "human" || role = "user") "Human messages use the user role"
            Observation.MessageObserved { Id = identifier (read "messageId"); Role = role; Origin = origin; Run = run }
        | "PartConfirmed" ->
            check [ "messageId"; "partId"; "index"; "kind"; payloadName ]
            Observation.PartConfirmed
                { Message = identifier (read "messageId"); Id = identifier (read "partId")
                  Index = index (read "index"); Kind = choice [ "text"; "tool-call"; "tool-result"; "binary" ] (read "kind")
                  Base64 = payload () }
        | "MessageFinished" ->
            check [ "messageId"; "partCount" ]
            Observation.MessageFinished(identifier (read "messageId"), index (read "partCount"))
        | "RunFinished" ->
            check [ "runId"; "outcome" ]
            Observation.RunFinished(identifier (read "runId"), choice [ "Completed"; "Failed"; "Cancelled" ] (read "outcome"))
        | _ -> invalidOp "Unknown trace observation"

    let private render payload fact =
        let tagged tag fields = make (("type", box tag) :: fields)
        match fact with
        | Observation.Opening data -> tagged "Opening" [ payload data ]
        | Observation.RunStarted run -> tagged "RunStarted" [ "runId", box run ]
        | Observation.MessageObserved message ->
            tagged "MessageObserved"
                [ "messageId", box message.Id; "role", box message.Role; "origin", box message.Origin
                  "runId", message.Run |> Option.map box |> Option.defaultValue null ]
        | Observation.PartConfirmed part ->
            tagged "PartConfirmed"
                [ "messageId", box part.Message; "partId", box part.Id; "index", box part.Index; "kind", box part.Kind; payload part.Base64 ]
        | Observation.MessageFinished(message, count) -> tagged "MessageFinished" [ "messageId", box message; "partCount", box count ]
        | Observation.RunFinished(run, outcome) -> tagged "RunFinished" [ "runId", box run; "outcome", box outcome ]

    let encode fact = render (fun value -> "base64", box value) fact
    let view fact = render (fun value -> "content", content value) fact

    let key fact =
        let fields =
            match fact with
            | Observation.Opening _ -> [ "Opening" ]
            | Observation.RunStarted run -> [ "RunStarted"; run ]
            | Observation.MessageObserved message -> [ "MessageObserved"; message.Id ]
            | Observation.PartConfirmed part -> [ "PartConfirmed"; part.Message; part.Id ]
            | Observation.MessageFinished(message, _) -> [ "MessageFinished"; message ]
            | Observation.RunFinished(run, _) -> [ "RunFinished"; run ]
        fields |> List.toArray |> box |> stringify
