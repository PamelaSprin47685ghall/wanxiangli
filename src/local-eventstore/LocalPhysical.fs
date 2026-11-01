namespace Wanxiangli.LocalEventStore

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module Physical =

    type private NativeWriter =
        abstract writerId: string
        abstract filePath: unit -> string
        abstract append: string -> obj

    type private NativeReader =
        abstract readStreams: obj * float -> obj
        abstract writerPhysicalMetadata: obj -> obj array
        abstract physicalInventory: obj -> string

    type private NativeFiles =
        abstract mkdirSync: string * obj -> unit
        abstract existsSync: string -> bool
        abstract readFileSync: string -> byte array
        abstract statSync: string -> obj
        abstract readdirSync: string -> string array
        abstract openSync: string * string -> int
        abstract fsyncSync: int -> unit
        abstract closeSync: int -> unit
        abstract writeFileSync: string * string * string -> unit
        abstract appendFileSync: string * string * string -> unit
        abstract utimesSync: string * float * float -> unit
        abstract unlinkSync: string -> unit

    type private NativeHash =
        abstract update: byte array -> obj
        abstract digest: string -> string

    type private NativeCodec =
        abstract encode: obj -> string
        abstract tryDecodeUtf8Text: byte array -> obj

    type private NativeSegments =
        abstract seriesOf: string * string array -> string array
        abstract segmentFileName: string * int -> string
        abstract legacyFileName: string -> string
        abstract parseSegmentFileName: string -> obj
        abstract coexistence: byte array * byte array -> obj

    [<Import("default", "node:fs")>]
    let private fs: NativeFiles = jsNative

    [<Import("join", "node:path")>]
    let private join (_left: string) (_right: string) : string = jsNative

    [<Import("createHash", "node:crypto")>]
    let private createHash (_algorithm: string) : NativeHash = jsNative

    [<Import("acquire", "wanxiangli/file-lock")>]
    let private acquireLease (_path: string) (_wait: obj) : Task<obj> = jsNative

    [<Import("CanonicalEventCodec", "wanxiangli/events")>]
    let private codecClass: obj = jsNative

    [<Import("WriterSegments", "wanxiangli/segments")>]
    let private segmentsClass: obj = jsNative

    [<Import("SegmentedReader", "wanxiangli/segments")>]
    let private readerClass: obj = jsNative

    [<Import("SegmentedWriter", "wanxiangli/segments")>]
    let private writerClass: obj = jsNative

    [<Emit("new $0()")>]
    let private construct (_constructor: obj) : obj = jsNative

    [<Emit("new $0($1)")>]
    let private constructWith (_constructor: obj) (_options: obj) : obj = jsNative

    [<Emit("$0()")>]
    let private directoryPath (_provider: obj) : string = jsNative

    [<Emit("Buffer.byteLength($0, 'utf8')")>]
    let private byteLength (_text: string) : int = jsNative

    [<Emit("$0[$1]")>]
    let private field (_value: obj) (_name: string) : obj = jsNative

    let private textField value name = unbox<string> (field value name)
    let private truth value name = unbox<bool> (field value name)
    let private number value name = unbox<float> (field value name)
    let private integer value name = unbox<int> (field value name)

    let private codec: NativeCodec = construct codecClass |> unbox
    let private segments: NativeSegments = construct segmentsClass |> unbox
    let private reader: NativeReader = construct readerClass |> unbox

    let createWriter (options: obj) : obj =
        constructWith
            writerClass
            (createObj
                [ "directory" ==> field options "directory"
                  "writerId" ==> textField options "writerId"
                  "segmentCap" ==> integer options "segmentCap" ])

    let writerId (writer: obj) = (unbox<NativeWriter> writer).writerId

    let filePath (writer: obj) = (unbox<NativeWriter> writer).filePath()

    let inventory (directory: obj) = reader.physicalInventory directory

    let writerPhysicalMetadata (directory: obj) = reader.writerPhysicalMetadata directory

    let readStreams (directory: obj) (nowMs: float) = reader.readStreams(directory, nowMs)

    let digest (bytes: byte array) : string =
        let hash = createHash "sha256"
        hash.update bytes |> ignore
        hash.digest "hex"

    let acquire (lockTarget: obj) : Task<obj> =
        task {
            let target = directoryPath lockTarget
            fs.mkdirSync (target, createObj [ "recursive" ==> true ])
            return! acquireLease target (createObj [ "kind" ==> "Budget"; "budgetMs" ==> 30000.0 ])
        }

    let private phase (value: string) =
        match value with
        | "before-append" -> "BeforePhysicalAppend"
        | "append" -> "PhysicalAppend"
        | "open" -> "DurabilityOpen"
        | "fsync" -> "DurabilityBarrier"
        | "close" -> "DurabilityClose"
        | other -> invalidOp (sprintf "unknown writer phase: %s" other)

    let private fault (value: obj) =
        createObj [ "phase" ==> phase (textField value "phase"); "cause" ==> field value "cause" ]

    let private beforeAppend (cause: exn) =
        createObj
            [ "ok" ==> false
              "kind" ==> "before-append"
              "primary" ==> createObj [ "phase" ==> "BeforePhysicalAppend"; "cause" ==> cause ]
              "cleanupFailures" ==> ([||]: obj array) ]

    let append (writer: obj) (events: obj array) : obj =
        let encoded =
            try
                events
                |> Array.map codec.encode
                |> String.concat ""
                |> Ok
            with cause ->
                Error cause

        match encoded with
        | Error cause -> beforeAppend cause
        | Ok "" -> createObj [ "ok" ==> true; "completion" ==> "no-append" ]
        | Ok text ->
            let result = (unbox<NativeWriter> writer).append text

            if truth result "ok" then
                result
            else
                createObj
                    [ "ok" ==> false
                      "kind" ==> textField result "kind"
                      "primary" ==> fault (field result "primary")
                      "cleanupFailures" ==> (unbox<obj array> (field result "cleanupFailures") |> Array.map fault) ]

    let private ok () = createObj [ "ok" ==> true ]

    let private refused reason = createObj [ "ok" ==> false; "reason" ==> reason ]

    let private decodeText (bytes: byte array) : Result<string, string> =
        let result = codec.tryDecodeUtf8Text bytes

        if truth result "ok" then
            Ok(textField result "text")
        else
            let error = field result "error"
            Error(sprintf "writer history is not valid UTF-8: %s %A" (textField error "code") (textField error "reason"))

    let private exists path = fs.existsSync path

    let private readBytes path = fs.readFileSync path

    let private size path : int =
        integer (fs.statSync path) "size"

    let private seriesFiles (directory: obj) writerId : string list =
        let path = directoryPath directory

        if not (exists path) then
            []
        else
            let names = fs.readdirSync path
            segments.seriesOf (writerId, names) |> Array.toList

    let private segmentFile writerId ordinal = segments.segmentFileName (writerId, ordinal)

    let private legacyFile writerId = segments.legacyFileName writerId

    let private ordinalOf name =
        let parsed = segments.parseSegmentFileName name

        if isNull parsed then
            invalidArg "name" (sprintf "not a segment file name: %s" name)
        else
            integer parsed "ordinal"

    let private durabilityBarrier path =
        let fd = fs.openSync (path, "r+")

        try
            fs.fsyncSync fd
        finally
            fs.closeSync fd

    type private Assembly =
        { Lines: string list
          Bytes: int
          Completed: string list }

    let private seal assembly =
        if List.isEmpty assembly.Lines then
            if assembly.Bytes > 0 then
                { Lines = []; Bytes = 0; Completed = "" :: assembly.Completed }
            else
                assembly
        else
            let body = assembly.Lines |> List.rev |> String.concat "\n"
            { Lines = []; Bytes = 0; Completed = (body + "\n") :: assembly.Completed }

    let private splitText text cap headroom =
        if String.IsNullOrEmpty text then
            []
        else
            let absorb assembly line =
                let count = byteLength (line + "\n")
                let next =
                    if assembly.Bytes > 0 && assembly.Bytes + count > cap then seal assembly
                    else assembly

                { next with Lines = line :: next.Lines; Bytes = next.Bytes + count }

            let initial = { Lines = []; Bytes = headroom; Completed = [] }
            let final = text.Split('\n') |> Array.filter (fun line -> line.Length > 0) |> Array.fold absorb initial
            (seal final).Completed |> List.rev

    let private writeSeries directory writerId text cap =
        let path = directoryPath directory
        let pieces = splitText text cap 0
        let names = List.init pieces.Length (segmentFile writerId)

        List.zip names pieces
        |> List.iter (fun (name, body) ->
            let target = join path name
            fs.writeFileSync (target, body, "utf8")
            durabilityBarrier target)

        names

    let private reorganizeLegacy directory writerId cap =
        let path = directoryPath directory
        let legacy = join path (legacyFile writerId)

        match decodeText (readBytes legacy) with
        | Error reason -> refused reason
        | Ok text ->
            let names = writeSeries directory writerId text cap
            let seconds = (number (fs.statSync legacy) "mtimeMs" |> round) / 1000.0
            fs.utimesSync (join path (List.last names), seconds, seconds)
            fs.unlinkSync legacy
            ok ()

    let private convergeLegacy directory writerId legacy cap =
        if not (exists legacy) || size legacy <= cap then ok ()
        else reorganizeLegacy directory writerId cap

    let private replaceSeries directory writerId legacy names cap =
        let path = directoryPath directory
        names |> List.iter (fun name -> fs.unlinkSync (join path name))

        if size legacy > cap then reorganizeLegacy directory writerId cap
        else ok ()

    let private appendLegacy directory writerId legacy copied cap =
        let path = directoryPath directory

        match decodeText (readBytes legacy) with
        | Error reason -> refused reason
        | Ok text ->
            let names = seriesFiles directory writerId
            let tail, headroom =
                match List.tryLast names with
                | Some name -> name, size (join path name)
                | None -> segmentFile writerId 0, 0

            let remaining = text.Split('\n') |> Array.skip copied |> String.concat "\n"
            let pieces = splitText remaining cap headroom
            let targets =
                pieces
                |> List.mapi (fun index _ ->
                    if index = 0 then tail
                    else segmentFile writerId (ordinalOf tail + index))

            List.zip targets pieces
            |> List.iter (fun (name, piece) ->
                if piece.Length > 0 then
                    let target = join path name
                    fs.appendFileSync (target, piece, "utf8")
                    durabilityBarrier target)

            if copied > 0 then names |> List.iter (fun name -> durabilityBarrier (join path name))
            fs.unlinkSync legacy
            ok ()

    let convergeWriterFiles (directory: obj) (writerId: string) (cap: int) : obj =
        let path = directoryPath directory
        let legacy = join path (legacyFile writerId)
        let names = seriesFiles directory writerId

        if List.isEmpty names then
            convergeLegacy directory writerId legacy cap
        elif not (exists legacy) then
            ok ()
        else
            let legacyBytes = readBytes legacy
            let seriesBytes = names |> List.map (join path >> readBytes) |> Array.concat
            let verdict = segments.coexistence (legacyBytes, seriesBytes)

            match textField verdict "kind" with
            | "series" ->
                fs.unlinkSync legacy
                ok ()
            | "legacy" -> replaceSeries directory writerId legacy names cap
            | "continuation" -> appendLegacy directory writerId legacy (integer verdict "copiedLines") cap
            | _ -> refused (sprintf "writer files diverged: %s" writerId)
