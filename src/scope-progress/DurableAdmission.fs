module Wanxiangli.ScopeProgress.DurableAdmission

open System
open Fable.Core
open Fable.Core.JsInterop

type AdvisorAdmissionJournal =
    abstract read: stream: string -> string array
    abstract append: stream: string * expectedRevision: float * requestId: string * body: string -> obj

[<Emit("JSON.stringify($0)")>]
let private serialize (_value: obj) : string = jsNative

[<Emit("JSON.parse($0)")>]
let private parse (_value: string) : obj = jsNative

let private reply (ok: bool) (accepted: bool) (held: bool) (status: string) (reason: string) : obj =
    createObj [
        "ok" ==> ok
        "accepted" ==> accepted
        "held" ==> held
        "status" ==> status
        "reason" ==> reason
    ]

let private validIdentity (identity: string) =
    not (String.IsNullOrWhiteSpace identity)
    && not (identity.Contains '\000')

let private operationKey (scopeId: string) (reportId: string) =
    string scopeId.Length + ":" + scopeId + ":" + reportId

let private streamFor (sessionId: string) = "advisor-process:" + sessionId

let private events (journal: AdvisorAdmissionJournal) (sessionId: string) =
    journal.read(streamFor sessionId) |> Array.map parse

let private admitted (scopeId: string) (event: obj) =
    string event?kind = "Admitted" && string event?scope = scopeId

let private finished (scopeId: string) (reportId: string) (event: obj) =
    string event?kind = "Finished"
    && string event?scope = scopeId
    && not (isNull event?reports)
    && (unbox<string array> event?reports |> Array.contains reportId)

let private outstanding (scopeId: string) (recorded: obj array) =
    recorded
    |> Array.filter (admitted scopeId)
    |> Array.exists (fun record ->
        let reportId = string record?report
        not (recorded |> Array.exists (finished scopeId reportId)))

let private commit
    (journal: AdvisorAdmissionJournal)
    (sessionId: string)
    (expectedRevision: int)
    (requestId: string)
    (body: string)
    : obj =
    journal.append(streamFor sessionId, float expectedRevision, requestId, body)

/// 持久提交先于任何付费咨询；已受理但未结算的不同报告只能候选排队。
let advisorClaim
    (journal: AdvisorAdmissionJournal)
    (sessionId: string)
    (scopeId: string)
    (reportId: string)
    (issue: string)
    : obj =
    if not (validIdentity sessionId && validIdentity scopeId && validIdentity reportId) then
        reply false false false "Invalid" "session, Scope and report identity are required"
    elif String.IsNullOrWhiteSpace issue then
        reply false false false "Invalid" "Advisor issue must not be empty"
    else
        try
            let body =
                serialize (
                    createObj [
                        "kind" ==> "Admitted"
                        "scope" ==> scopeId
                        "report" ==> reportId
                        "issue" ==> issue
                    ]
                )
            let rec appendAttempt retries =
                let earlier = events journal sessionId
                let held = outstanding scopeId earlier
                let result =
                    commit journal sessionId earlier.Length ("admit:" + operationKey scopeId reportId) body
                let status = string result?status
                let reason = if isNull result?reason then "" else string result?reason
                match status with
                | "Conflict" when reason = "RevisionConflict" && retries < 8 ->
                    appendAttempt (retries + 1)
                | "Committed" -> reply true true held status reason
                | "Replayed" ->
                    reply true false true status "Advisor report was already admitted; do not repeat an external consultation"
                | "Conflict"
                | "NotWritten"
                | "Unknown" -> reply false false held status reason
                | _ -> reply false false held "Invalid" "Advisor admission received an unknown durable status"
            appendAttempt 0
        with ex ->
            reply false false false "Unknown" ("Advisor admission cannot prove durable reservation: " + ex.Message)

/// 顾问已经观察到终局才能释放全局单飞；未知提交保持阻塞。
let advisorFinish
    (journal: AdvisorAdmissionJournal)
    (sessionId: string)
    (scopeId: string)
    (reportIds: string array)
    (outcome: string)
    : obj =
    if
        not (validIdentity sessionId && validIdentity scopeId)
        || reportIds.Length = 0
        || not (reportIds |> Array.forall validIdentity)
        || (outcome <> "Completed" && outcome <> "Failed")
    then
        reply false false false "Invalid" "valid session, Scope, reports and terminal outcome required"
    else
        try
            let identities = reportIds |> Array.distinct |> Array.sort
            let identity =
                identities |> Array.map (fun id -> string id.Length + ":" + id) |> String.concat ":"
            let body =
                serialize (
                    createObj [
                        "kind" ==> "Finished"
                        "scope" ==> scopeId
                        "reports" ==> identities
                        "outcome" ==> outcome
                    ]
                )
            let rec appendAttempt retries =
                let recorded = events journal sessionId
                let allAdmitted =
                    identities
                    |> Array.forall (fun id ->
                        recorded
                        |> Array.exists (fun event -> admitted scopeId event && string event?report = id))
                if not allAdmitted then
                    reply false false false "Invalid" "cannot finish an Advisor report without durable admission"
                else
                    let result =
                        commit journal sessionId recorded.Length
                            ("finish:" + string scopeId.Length + ":" + scopeId + ":" + identity) body
                    let status = string result?status
                    let reason = if isNull result?reason then "" else string result?reason
                    match status with
                    | "Conflict" when reason = "RevisionConflict" && retries < 8 ->
                        appendAttempt (retries + 1)
                    | "Committed" | "Replayed" -> reply true false false status reason
                    | "Conflict" | "NotWritten" | "Unknown" -> reply false false true status reason
                    | _ -> reply false false true "Invalid" "Advisor finish received an unknown durable status"
            appendAttempt 0
        with ex ->
            reply false false true "Unknown" ("Advisor finish cannot prove durable terminal: " + ex.Message)


/// Read unsettled admissions after a restart without authorizing another model request.
let advisorPending
    (journal: AdvisorAdmissionJournal)
    (sessionId: string)
    (scopeId: string)
    : obj =
    if not (validIdentity sessionId && validIdentity scopeId) then
        createObj [ "ok" ==> false; "reason" ==> "session and Scope identity are required" ]
    else
        try
            let recorded = events journal sessionId
            let pending =
                recorded
                |> Array.filter (admitted scopeId)
                |> Array.filter (fun item ->
                    not (recorded |> Array.exists (finished scopeId (string item?report))))
                |> Array.map (fun item ->
                    let reportId = string item?report
                    let group =
                        recorded
                        |> Array.tryFind (fun record ->
                            string record?kind = "StageBegan"
                            && string record?scope = scopeId
                            && not (isNull record?phase)
                            && unbox<int> record?phase = 1
                            && not (isNull record?reports)
                            && (unbox<string array> record?reports |> Array.contains reportId))
                        |> Option.map (fun record ->
                            createObj [
                                "processId" ==> string record?process
                                "reportIds" ==> unbox<string array> record?reports
                            ])
                        |> Option.defaultValue null
                    let fields =
                        [ "reportId" ==> reportId
                          "issue" ==> string item?issue
                          "state" ==> "Unresolved" ]
                    createObj (if isNull group then fields else fields @ [ "group" ==> group ]))
            createObj [ "ok" ==> true; "pending" ==> pending ]
        with ex ->
            createObj [ "ok" ==> false; "reason" ==> ("Advisor pending recovery is unknown: " + ex.Message) ]

let private stageEvent (scopeId: string) (processId: string) (phase: int) (kind: string) (event: obj) =
    string event?kind = kind
    && string event?scope = scopeId
    && string event?process = processId
    && (unbox<int> event?phase) = phase

let private phaseIdentity scopeId processId phase kind =
    kind + ":" + operationKey scopeId (processId + ":" + string phase)

/// Commit an irreversible logical provider-call reservation before asking the model.
/// An unconfirmed reservation is Unknown, never permission to send again.
let advisorStageBegin
    (journal: AdvisorAdmissionJournal)
    (sessionId: string)
    (scopeId: string)
    (processId: string)
    (phase: int)
    (question: string)
    (reportIds: string array)
    : obj =
    if
        not (validIdentity sessionId && validIdentity scopeId && validIdentity processId)
        || phase < 1 || phase > 5
        || String.IsNullOrWhiteSpace question
        || reportIds.Length = 0
        || (reportIds |> Array.exists (validIdentity >> not))
        || (reportIds |> Array.distinct |> Array.length) <> reportIds.Length
    then
        createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Invalid"; "reason" ==> "valid stage identity and question required" ]
    else
        try
            let rec attempt retries =
                let recorded = events journal sessionId
                let began =
                    recorded
                    |> Array.tryFind (stageEvent scopeId processId phase "StageBegan")
                let answered =
                    recorded
                    |> Array.tryFind (stageEvent scopeId processId phase "StageAnswered")
                match began with
                | Some original when
                    string original?question <> question
                    || isNull original?reports
                    || (unbox<string array> original?reports) <> reportIds ->
                    createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Conflict"; "reason" ==> "stage prompt differs from the reserved request" ]
                | Some _ ->
                    match answered with
                    | Some proof ->
                        createObj [ "ok" ==> true; "start" ==> false; "confirmed" ==> true; "prose" ==> string proof?prose; "status" ==> "Confirmed" ]
                    | None ->
                        createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Unknown"; "reason" ==> "stage was sent or interrupted without a confirmed reply" ]
                | None ->
                    let previousConfirmed =
                        phase = 1 ||
                        (recorded |> Array.exists (stageEvent scopeId processId (phase - 1) "StageAnswered"))
                    let admittedToScope =
                        reportIds
                        |> Array.forall (fun reportId ->
                            recorded |> Array.exists (fun event ->
                                admitted scopeId event && string event?report = reportId))
                    let reservedElsewhere =
                        recorded
                        |> Array.exists (fun event ->
                            string event?kind = "StageBegan"
                            && string event?scope = scopeId
                            && string event?process <> processId
                            && not (isNull event?phase)
                            && unbox<int> event?phase = 1
                            && not (isNull event?reports)
                            && (unbox<string array> event?reports
                                |> Array.exists (fun previous -> reportIds |> Array.contains previous)))
                    if reservedElsewhere then
                        createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Conflict"; "reason" ==> "one report already belongs to a different Advisor Process" ]
                    elif not previousConfirmed || not admittedToScope then
                        createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Invalid"; "reason" ==> "previous stage or admission is not confirmed" ]
                    else
                        let body =
                            serialize (createObj [
                                "kind" ==> "StageBegan"; "scope" ==> scopeId; "process" ==> processId
                                "phase" ==> phase; "question" ==> question; "reports" ==> reportIds
                            ])
                        let result =
                            commit journal sessionId recorded.Length (phaseIdentity scopeId processId phase "begin") body
                        let status = string result?status
                        let reason = if isNull result?reason then "" else string result?reason
                        match status with
                        | "Conflict" when reason = "RevisionConflict" && retries < 8 -> attempt (retries + 1)
                        | "Committed" ->
                            createObj [ "ok" ==> true; "start" ==> true; "confirmed" ==> false; "status" ==> status ]
                        | "Replayed" ->
                            createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Unknown"; "reason" ==> "stage reservation already exists" ]
                        | _ -> createObj [ "ok" ==> false; "start" ==> false; "status" ==> status; "reason" ==> reason ]
            attempt 0
        with ex ->
            createObj [ "ok" ==> false; "start" ==> false; "status" ==> "Unknown"; "reason" ==> ("stage reservation unknown: " + ex.Message) ]

/// Durable reply proof. Only a proven, nonempty model reply may let the next stage start.
let advisorStageConfirm
    (journal: AdvisorAdmissionJournal)
    (sessionId: string)
    (scopeId: string)
    (processId: string)
    (phase: int)
    (prose: string)
    : obj =
    if
        not (validIdentity sessionId && validIdentity scopeId && validIdentity processId)
        || phase < 1 || phase > 5
        || String.IsNullOrWhiteSpace prose
    then
        createObj [ "ok" ==> false; "status" ==> "Invalid"; "reason" ==> "valid stage identity and nonempty confirmed reply required" ]
    else
        try
            let rec attempt retries =
                let recorded = events journal sessionId
                let reserved = recorded |> Array.exists (stageEvent scopeId processId phase "StageBegan")
                let answered = recorded |> Array.tryFind (stageEvent scopeId processId phase "StageAnswered")
                if not reserved then
                    createObj [ "ok" ==> false; "status" ==> "Invalid"; "reason" ==> "unreserved model call cannot be confirmed" ]
                else
                    match answered with
                    | Some previous ->
                        if string previous?prose = prose then
                            createObj [ "ok" ==> true; "status" ==> "Replayed" ]
                        else
                            createObj [ "ok" ==> false; "status" ==> "Conflict"; "reason" ==> "a different reply was already confirmed" ]
                    | None ->
                        let body =
                            serialize (createObj [
                                "kind" ==> "StageAnswered"; "scope" ==> scopeId; "process" ==> processId
                                "phase" ==> phase; "prose" ==> prose
                            ])
                        let result =
                            commit journal sessionId recorded.Length (phaseIdentity scopeId processId phase "answer") body
                        let status = string result?status
                        let reason = if isNull result?reason then "" else string result?reason
                        match status with
                        | "Conflict" when reason = "RevisionConflict" && retries < 8 -> attempt (retries + 1)
                        | "Committed" | "Replayed" -> createObj [ "ok" ==> true; "status" ==> status ]
                        | _ -> createObj [ "ok" ==> false; "status" ==> status; "reason" ==> reason ]
            attempt 0
        with ex ->
            createObj [ "ok" ==> false; "status" ==> "Unknown"; "reason" ==> ("stage reply commit unknown: " + ex.Message) ]
