module Wanxiangli.EventStore.SqliteJournal

open Fable.Core
open Fable.Core.JsInterop

type IJournal =
    abstract read: stream: string -> string array
    abstract append: stream: string * expectedRevision: float * requestId: string * body: string -> obj
    abstract close: unit -> unit

module private Native =
    [<ImportAll("node:crypto")>]
    let crypto: obj = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && typeof $0.exec === 'function' && typeof $0.prepare === 'function' && typeof $0.close === 'function'")>]
    let isDatabase (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'string' && $0.length > 0")>]
    let isText (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'string' && $0.length > 0 && $0.isWellFormed() && !$0.includes('\\0')")>]
    let isKey (_value: obj): bool = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= 0 && $0 < Number.MAX_SAFE_INTEGER")>]
    let isRevision (_value: obj): bool = jsNative

    [<Emit("Buffer.byteLength($0, 'utf8')")>]
    let byteLength (_value: string): int = jsNative

    [<Emit("$0.isWellFormed()")>]
    let wellFormed (_value: string): bool = jsNative

    [<Emit("Buffer.from($0, 'utf8')")>]
    let encode (_value: string): obj = jsNative

    [<Emit("new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode($0)")>]
    let decode (_value: obj): string = jsNative

    [<Emit("$0.createHash('sha256').update($1, 'utf8').digest('hex')")>]
    let hash (_provider: obj) (_value: string): string = jsNative

    let digest value = hash crypto value
    let require condition message = if not condition then invalidOp message

    let result (status: string) (revision: float) (reason: string): obj =
        createObj [ "status" ==> status; "revision" ==> revision; "reason" ==> reason ]

let SqliteJournal (database: obj): IJournal =
    do Native.require (Native.isDatabase database) "An explicit SQLite connection is required"
    let mutable closed = false
    let mutable busy = false

    let guard action =
        Native.require (not busy) "Journal does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let ensureOpen () = Native.require (not closed) "Journal is closed; reopen after an unknown commit"
    let execute (sql: string): unit = database?exec(sql)
    let prepare (sql: string): obj = database?prepare(sql)
    let closeConnection (): unit = database?close()

    do
        try
            execute "PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;"
            execute """
CREATE TABLE IF NOT EXISTS journal_entries (
  stream TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  request_id TEXT NOT NULL,
  body BLOB NOT NULL,
  checksum TEXT NOT NULL,
  PRIMARY KEY (stream, revision),
  UNIQUE (stream, request_id)
) STRICT;
CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'Journal is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'Journal is append-only'); END;
"""
            let check: obj = (prepare "PRAGMA quick_check")?get()
            let integrity: string = check?quick_check
            Native.require (integrity = "ok") "SQLite integrity check failed"
        with error ->
            closeConnection ()
            closed <- true
            raise error

    let read (stream: string): string array =
        ensureOpen ()
        Native.require (Native.isKey (box stream)) "Stream must be valid text without NUL"
        let rows: obj array = (prepare "SELECT revision, body, checksum FROM journal_entries WHERE stream=? ORDER BY revision")?all(stream)
        rows |> Array.mapi (fun index row ->
            let revision: float = row?revision
            let bytes: obj = row?body
            let body = Native.decode bytes
            let checksum: string = row?checksum
            Native.require (revision = float (index + 1)) "Journal revision gap"
            Native.require (Native.isText (box body) && Native.digest body = checksum) "Journal checksum mismatch"
            body)

    let append (stream: string, expectedRevision: float, requestId: string, body: string): obj =
        ensureOpen ()
        Native.require (Native.isKey (box stream) && Native.isKey (box requestId)) "Stream and requestId must be valid text without NUL"
        Native.require (Native.isRevision (box expectedRevision)) "Expected revision is invalid"
        Native.require (Native.isText (box body) && Native.wellFormed body && Native.byteLength body <= 1048576) "Body must contain 1 to 1048576 valid UTF-8 bytes"
        let bytes = Native.encode body
        let mutable started = false
        let mutable committing = false
        try
            execute "BEGIN IMMEDIATE"
            started <- true
            let duplicate: obj = (prepare "SELECT revision, body, checksum FROM journal_entries WHERE stream=? AND request_id=?")?get(stream, requestId)
            if not (isNullOrUndefined duplicate) then
                execute "ROLLBACK"
                started <- false
                let storedBytes: obj = duplicate?body
                let stored = Native.decode storedBytes
                let checksum: string = duplicate?checksum
                let revision: float = duplicate?revision
                if stored = body && checksum = Native.digest body then
                    Native.result "Replayed" revision null
                else Native.result "Conflict" expectedRevision "RequestIdConflict"
            else
                let head: obj = (prepare "SELECT COUNT(*) AS count, COALESCE(MAX(revision),0) AS revision FROM journal_entries WHERE stream=?")?get(stream)
                let revision: float = head?revision
                let count: float = head?count
                Native.require (revision = count) "Journal revision gap"
                if revision <> expectedRevision then
                    execute "ROLLBACK"
                    started <- false
                    Native.result "Conflict" revision "RevisionConflict"
                else
                    let statement = prepare "INSERT INTO journal_entries (stream, revision, request_id, body, checksum) VALUES (?, ?, ?, ?, ?)"
                    let _: obj = statement?run(stream, revision + 1., requestId, bytes, Native.digest body)
                    committing <- true
                    execute "COMMIT"
                    started <- false
                    Native.result "Committed" (revision + 1.) null
        with error ->
            let mutable rolledBack = not started
            if started && not committing then
                try
                    execute "ROLLBACK"
                    rolledBack <- true
                with _ -> ()
            if committing || not rolledBack then
                closed <- true
                try closeConnection () with _ -> ()
                Native.result "Unknown" expectedRevision error.Message
            else Native.result "NotWritten" expectedRevision error.Message

    let close (): unit =
        if not closed then
            closeConnection ()
            closed <- true

    { new IJournal with
        member _.read(stream) = guard (fun () -> read stream)
        member _.append(stream, expectedRevision, requestId, body) = guard (fun () -> append (stream, expectedRevision, requestId, body))
        member _.close() = guard close }
