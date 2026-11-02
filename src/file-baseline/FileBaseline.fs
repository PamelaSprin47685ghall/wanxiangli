namespace Wanxiangli.FileBaseline

open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module private Baselines =
    type Binding = { Resolve: obj; Payloads: obj }
    type private Content = { Bytes: obj; Text: string; Hash: string }
    type private Stored = Missing | Present of hash: string * payload: string

    let private law = Wanxiangli.FileBaseline.FileDiff.FileDiff()

    [<Emit("new WeakMap()")>]
    let private createOwners () : obj = jsNative

    let private owners = createOwners ()

    [<Emit("$0.set($1, {Resolve: $2.resolvePath, Payloads: $2.payloads})")>]
    let private set (_owners: obj) (_owner: obj) (_options: obj) : unit = jsNative

    [<Emit("$0.get($1)")>]
    let private get (_owners: obj) (_owner: obj) : Binding = jsNative

    let bind owner options = set owners owner options
    let binding owner = get owners owner

    [<Emit("$0($1)")>]
    let private resolve (_resolve: obj) (_path: string) : string = jsNative

    [<Import("readFileSync", "node:fs")>]
    let private readFile (_path: string) : obj = jsNative

    [<Import("createHash", "node:crypto")>]
    let private createHash (_algorithm: string) : obj = jsNative

    [<Emit("$0.update($1, 'utf8').digest('hex')")>]
    let private digest (_hash: obj) (_text: string) : string = jsNative

    [<Emit("new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode($0)")>]
    let private decodeUtf8 (_bytes: obj) : string = jsNative

    [<Emit("(function(bytes, text) { const encoded = new TextEncoder().encode(text); return encoded.length === bytes.length && encoded.every((value, index) => value === bytes[index]); })($0, $1)")>]
    let private preservesBytes (_bytes: obj) (_text: string) : bool = jsNative

    [<Emit("({ok: true, value: $0})")>]
    let private success (_value: obj) : obj = jsNative

    [<Emit("({ok: false, error: $0})")>]
    let private failure (_message: string) : obj = jsNative

    let wire result =
        match result with
        | Ok value -> success (box value)
        | Error message -> failure message

    [<Emit("$0.ok")>]
    let private isSuccess (_result: obj) : bool = jsNative

    [<Emit("$0.value")>]
    let private valueOf (_result: obj) : obj = jsNative

    [<Emit("$0.error")>]
    let private errorOf (_result: obj) : string = jsNative

    [<Emit("$0 === null")>]
    let private isNullValue (_value: obj) : bool = jsNative

    [<Emit("$0.read($1)")>]
    let private readPayload (_payloads: obj) (_reference: string) : Task<obj> = jsNative

    [<Emit("$0.write($1)")>]
    let private writePayload (_payloads: obj) (_bytes: obj) : Task<obj> = jsNative

    let private decodeContent path bytes =
        try
            let text = decodeUtf8 bytes
            if not (preservesBytes bytes text) then Error(sprintf "file %s did not preserve its UTF-8 bytes" path)
            else Ok { Bytes = bytes; Text = text; Hash = digest (createHash "sha256") text }
        with _ -> Error(sprintf "failed to read file %s: invalid UTF-8" path)

    let private readTarget binding path =
        // 路径能力的错误不是文件不存在；保留在读取 catch 外。
        let fullPath = resolve binding.Resolve path
        try readFile fullPath |> decodeContent path |> Result.map Some
        with cause ->
            let code: obj = cause?code
            if law.readFailure code = "missing" then Ok None
            else Error(sprintf "failed to read file %s: %s" path cause.Message)

    [<Emit("({kind: 'Missing'})")>]
    let private missingEntry () : obj = jsNative

    [<Emit("({kind: 'Present', payloadRef: $0, payload_ref: $0, sha256: $1, contentHash: $1})")>]
    let private presentEntry (_reference: string) (_hash: string) : obj = jsNative

    let private writeTarget binding path content =
        task {
            match content with
            | None -> return Ok(path, missingEntry ())
            | Some captured ->
                let! result = writePayload binding.Payloads captured.Bytes
                if not (isSuccess result) then
                    return Error(sprintf "failed to write payload for %s: %s" path (errorOf result))
                else return Ok(path, presentEntry (unbox<string> (valueOf result)) captured.Hash)
        }

    [<Emit("({})")>]
    let private emptyObject () : obj = jsNative

    [<Emit("$0[$1] = $2")>]
    let private addEntry (_target: obj) (_path: string) (_entry: obj) : unit = jsNative

    [<Emit("JSON.stringify($0)")>]
    let private stringify (_value: obj) : string = jsNative

    [<Emit("[...new Set($0)].sort()")>]
    let private distinctPaths (_paths: string array) : string array = jsNative

    let private encode (entries: (string * obj) seq) =
        let encoded = emptyObject ()
        for path, entry in entries |> Seq.sortBy fst do addEntry encoded path entry
        stringify encoded

    let rec private capturePaths binding (paths: string array) index (entries: ResizeArray<string * obj>) =
        task {
            if index = paths.Length then return Ok(encode entries)
            else
                let path = paths[index]
                match readTarget binding path with
                | Error message -> return Error message
                | Ok content ->
                    let! stored = writeTarget binding path content
                    match stored with
                    | Error message -> return Error message
                    | Ok entry ->
                        entries.Add entry
                        return! capturePaths binding paths (index + 1) entries
        }

    let capture binding paths = capturePaths binding (distinctPaths paths) 0 (ResizeArray())

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let private isObject (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let private isString (_value: obj) : bool = jsNative

    [<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
    let private hasField (_target: obj) (_field: string) : bool = jsNative

    [<Emit("$0[$1]")>]
    let private fieldValue (_target: obj) (_field: string) : obj = jsNative

    [<Emit("JSON.stringify($0, null, 4)")>]
    let private pretty (_value: obj) : string = jsNative

    [<Emit("Object.entries($0)")>]
    let private entriesOf (_value: obj) : (string * obj) array = jsNative

    let private stringField entry name =
        if not (hasField entry name) then
            Error(sprintf "Error at: `$`\nExpecting an object with a field named `%s` but instead got:\n%s" name (pretty entry))
        else
            let value = fieldValue entry name
            if isString value then Ok(unbox<string> value)
            else Error(sprintf "Error at: `$.%s`\nExpecting a string but instead got: %s" name (pretty value))

    let private decodeEntry entry =
        if not (isObject entry) then Error("Error at: `$`\nExpecting an object but instead got:\n" + pretty entry)
        else
            stringField entry "kind"
            |> Result.bind (function
                | "Missing" -> Ok Missing
                | "Present" ->
                    stringField entry "sha256" |> Result.bind (fun hash ->
                        stringField entry "payloadRef" |> Result.map (fun payload -> Present(hash, payload)))
                | kind -> Error("Error at: `$`\nThe following `failure` occurred with the decoder: unknown file state " + kind))

    let private decodeBaseline paths baseline =
        let parsed =
            try Ok(JS.JSON.parse baseline)
            with cause -> Error("Given an invalid JSON: " + cause.Message)
        let decoded = parsed |> Result.bind (fun root ->
            if not (isObject root) then Error("Error at: `$`\nExpecting an object but instead got: " + pretty root)
            else
                let mutable result = Ok []
                for path, entry in entriesOf root do
                    result <- result |> Result.bind (fun previous -> decodeEntry entry |> Result.map (fun state -> (path, state) :: previous))
                result |> Result.map List.rev)
        match decoded with
        | Error message -> Error("invalid maintenance baseline: " + message)
        | Ok entries when Set.ofList (List.map fst entries) <> Set.ofArray paths ->
            Error "maintenance baseline does not cover the related paths"
        | Ok entries -> Ok(entries |> List.sortBy fst |> List.toArray)

    let private readStored binding path state =
        task {
            match state with
            | Missing -> return Ok None
            | Present(hash, payload) ->
                let! result = readPayload binding.Payloads payload
                if not (isSuccess result) then return Error(errorOf result)
                else
                    let bytes = valueOf result
                    if isNullValue bytes then return Error(sprintf "missing baseline payload for %s" path)
                    else
                        match decodeContent path bytes with
                        | Error message -> return Error message
                        | Ok content when content.Hash <> hash -> return Error(sprintf "baseline payload digest mismatch for %s" path)
                        | Ok content -> return Ok(Some content.Text)
        }

    [<Emit("({diffSummary: $0, refresh: $1, targetState: $2})")>]
    let private maintenance (_diff: string) (_refresh: bool) (_state: string) : obj = jsNative

    let rec private comparePaths binding (entries: (string * Stored) array) index captured diffs =
        task {
            if index = entries.Length then
                let summary = law.summarize (Array.ofList (List.rev diffs))
                let diff: string = summary?diffSummary
                let refresh: bool = summary?refresh
                return Ok(maintenance diff refresh (encode (List.rev captured)))
            else
                let path, state = entries[index]
                let! before = readStored binding path state
                match before with
                | Error message -> return Error message
                | Ok before ->
                    match readTarget binding path with
                    | Error message -> return Error message
                    | Ok target ->
                        let! stored = writeTarget binding path target
                        match stored with
                        | Error message -> return Error message
                        | Ok entry ->
                            let diff = law.fileDiff(path, Option.toObj before, target |> Option.map (fun content -> content.Text) |> Option.toObj)
                            return! comparePaths binding entries (index + 1) (entry :: captured) (diff :: diffs)
        }

    let compare binding paths baseline =
        task {
            match decodeBaseline paths baseline with
            | Error message -> return Error message
            | Ok entries -> return! comparePaths binding entries 0 [] []
        }

[<AttachMembers>]
type FileBaseline(options: obj) as this =
    do Baselines.bind this options
    member this.capture(paths: string array) : Task<obj> =
        task { let! result = Baselines.capture (Baselines.binding this) paths in return Baselines.wire result }
    member this.compare(paths: string array, baseline: string) : Task<obj> =
        task { let! result = Baselines.compare (Baselines.binding this) paths baseline in return Baselines.wire result }
