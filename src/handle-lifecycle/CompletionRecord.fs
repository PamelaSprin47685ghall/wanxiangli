module Wanxiangli.HandleLifecycle.CompletionRecord

open System
open Fable.Core
open Fable.Core.JsInterop

[<Import("CanonicalEventCodec", "wanxiangli/events")>]
let private CanonicalEventCodec: obj = jsNative

[<Import("validationError", "wanxiangli/returned-material")>]
let private validationError (_body: string) : string = jsNative

[<Emit("Promise.resolve($0)")>]
let private resolved (_value: obj) : JS.Promise<obj> = jsNative

[<Emit("Promise.reject($0)")>]
let private rejected (_error: exn) : JS.Promise<obj> = jsNative

[<Emit("$0.then($1)")>]
let private mapPromise (_promise: JS.Promise<obj>) (_map: obj -> obj) : JS.Promise<obj> = jsNative

let private field (raw: obj) (key: string) : string =
    let hasKey: bool =
        emitJsExpr (raw, key) "$0 != null && Object.prototype.hasOwnProperty.call($0, $1)"
    let value: obj = if hasKey then raw?(key) else null

    if isNull value then
        ""
    elif emitJsExpr value "typeof $0 === 'string'" then
        unbox<string> value
    else
        string value

let private fieldOpt (raw: obj) (key: string) =
    let hasKey: bool =
        emitJsExpr (raw, key) "$0 != null && Object.prototype.hasOwnProperty.call($0, $1)"

    if hasKey then Some(field raw key) else None

let private invalid kind reason message =
    createObj
        [ "kind" ==> "invalid"
          "error" ==> createObj [ "kind" ==> kind; "reason" ==> reason; "message" ==> message ] ]

let private current payload = createObj [ "kind" ==> "current"; "payload" ==> payload ]

let private failed runId raw =
    current (
        createObj
            [ "kind" ==> "failed"
              "runId" ==> runId
              "code" ==> field raw "code"
              "message" ==> field raw "message"
              "childSessionId" ==> field raw "child_session_id" ]
    )

let private completed runId raw =
    let view = field raw "view"
    let error = validationError view

    if not (isNull error) then
        invalid "IncompletePayload" error error
    else
        current (
            createObj
                [ "kind" ==> "completed"
                  "runId" ==> runId
                  "view" ==> view
                  "childSessionId" ==> field raw "child_session_id"
                  "authorityRoot" ==> field raw "authority_root"
                  "providerRun" ==> field raw "provider_run"
                  "directory" ==> field raw "directory" ]
        )

let private legacyAbort runId body raw =
    createObj
        [ "kind" ==> "legacy-false-abort"
          "payload" ==>
              createObj
                  [ "status" ==> "aborted"
                    "runId" ==> runId
                    "code" ==> field raw "code"
                    "message" ==> field raw "message"
                    "childSessionId" ==> field raw "child_session_id"
                    "rawBody" ==> body ] ]

let private decodeFinality finality runId raw body =
    match finality with
    | None -> invalid "MissingFinality" "" "missing finality"
    | Some "completed" -> completed runId raw
    | Some "failed" -> failed runId raw
    | Some "aborted" -> legacyAbort runId body raw
    | Some other -> invalid "UnknownFinality" other (sprintf "unknown finality: %s" other)

let private decode body =
    try
        let raw: obj = JS.JSON.parse body
        let version = fieldOpt raw "schemaVersion"
        let status = field raw "status"
        let finality = fieldOpt raw "finality"
        let runId = field raw "run_id"

        if status = "aborted" then
            legacyAbort runId body raw
        else
            match version with
            | None -> invalid "MissingSchemaVersion" "" "missing schemaVersion"
            | Some value when value <> "4" ->
                invalid "UnknownSchemaVersion" value (sprintf "unknown schemaVersion: %s" value)
            | Some _ -> decodeFinality finality runId raw body
    with error ->
        invalid "InvalidJson" error.Message (sprintf "invalid json: %s" error.Message)

let private belongsToWork (work: obj) (payload: obj) =
    let sameChild = field payload "childSessionId" = field work "childSessionId"

    if field payload "kind" = "completed" then
        sameChild
        && field payload "authorityRoot" = field work "authorityRoot"
        && not (String.IsNullOrWhiteSpace(field payload "providerRun"))
    else
        sameChild

let private optionalText value : obj =
    if String.IsNullOrWhiteSpace value then null else box value

let private materialize agentId (payload: obj) =
    let originalRunId = field payload "runId"
    let runId = if String.IsNullOrWhiteSpace originalRunId then "run-" + agentId else originalRunId
    let shared =
        [ "kind" ==> field payload "kind"
          "runId" ==> runId
          "childSessionId" ==> optionalText (field payload "childSessionId") ]

    if field payload "kind" = "completed" then
        createObj (
            shared
            @ [ "view" ==> field payload "view"
                "authorityRoot" ==> optionalText (field payload "authorityRoot")
                "providerRun" ==> optionalText (field payload "providerRun")
                "directory" ==> optionalText (field payload "directory") ]
        )
    else
        createObj (shared @ [ "code" ==> field payload "code"; "message" ==> field payload "message" ])

let private success value = createObj [ "ok" ==> true; "value" ==> value ]
let private failure reason = createObj [ "ok" ==> false; "error" ==> reason ]

let private decodeForWork work agentId body =
    let decoded = decode body

    match field decoded "kind" with
    | "current" ->
        let payload: obj = decoded?payload
        if isNull work || belongsToWork work payload then
            success (materialize agentId payload)
        else
            failure "completion body does not belong to its exact work"
    | "legacy-false-abort" -> failure "legacy false abort is not a joinable completion"
    | _ -> failure (sprintf "completion blob decode failed: %s" (field (decoded?error: obj) "message"))

[<AttachMembers>]
type CompletionRecord() =
    let codec = createNew CanonicalEventCodec ()

    member _.encode(outcome: obj) : string =
        let optional name : obj =
            let value: obj = outcome?(name)
            if isNull value then box "" else value

        let shared = [ "schemaVersion" ==> 4; "run_id" ==> (outcome?runId: obj) ]
        let fields =
            match field outcome "kind" with
            | "completed" ->
                let view = unbox<string> (outcome?view: obj)
                let error = validationError view
                if not (isNull error) then invalidArg "outcome" error
                [ "finality" ==> "completed"
                  "view" ==> view
                  "child_session_id" ==> optional "childSessionId"
                  "authority_root" ==> optional "authorityRoot"
                  "provider_run" ==> optional "providerRun"
                  "directory" ==> optional "directory" ]
            | "failed" ->
                [ "finality" ==> "failed"
                  "code" ==> (outcome?code: obj)
                  "message" ==> (outcome?message: obj)
                  "child_session_id" ==> optional "childSessionId" ]
            | "abandoned" ->
                [ "finality" ==> "failed"
                  "code" ==> "ABANDONED"
                  "message" ==> (outcome?reason: obj)
                  "child_session_id" ==> ""
                  "agent_id" ==> (outcome?agentId: obj) ]
            | _ -> invalidArg "outcome" "unknown completion kind"

        unbox<string> (codec?canonicalJson (createObj (shared @ fields)): obj)

    member _.decode(body: string) : obj = decode body
    member _.belongsToWork(work: obj, payload: obj) : bool = belongsToWork work payload
    member _.materialize(agentId: string, payload: obj) : obj = materialize agentId payload
    member _.decodeForWork(work: obj, agentId: string, body: string) : obj = decodeForWork work agentId body

    member _.read(reference: obj, readBlob: string -> JS.Promise<obj>, sha256: string -> string) : JS.Promise<obj> =
        let blobRef: obj = reference?ref
        let digest: obj = reference?digest

        if isNull blobRef && isNull digest then
            resolved (success null)
        elif isNull blobRef || isNull digest then
            resolved (failure "completion blob ref/digest pair is incomplete")
        else
            try
                let target = unbox<string> blobRef
                let expected = unbox<string> digest

                mapPromise (readBlob target) (fun result ->
                    if not (unbox<bool> (result?ok: obj)) then
                        result
                    else
                        let body = unbox<string> (result?value: obj)
                        if sha256 body <> expected then
                            failure (sprintf "completion blob digest mismatch: %s" expected)
                        else
                            success (createObj [ "body" ==> body; "ref" ==> target; "digest" ==> expected ]))
            with error ->
                rejected error
