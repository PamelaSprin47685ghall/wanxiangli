namespace Wanxiangli.Segments

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

module private Readers =
    type CacheEntry =
        { Dev: float
          Ino: float
          Identity: string
          Length: int
          Events: obj array }

    type Group =
        { WriterId: string
          FileNames: string list }

    type Metadata =
        { Group: Group
          LastActivityMs: float }

    type TailLine =
        { Start: int
          Text: string }

    type TailCursor =
        | BetweenFiles
        | InsideFile of fd: int * path: string * lineEnd: int

    [<Import("default", "node:fs")>]
    let private fs: obj = jsNative

    [<Import("join", "node:path")>]
    let private join (_left: string) (_right: string) : string = jsNative

    [<Import("CanonicalEventCodec", "wanxiangli/events")>]
    let private codecClass: obj = jsNative

    [<Import("WriterRetention", "wanxiangli/retention")>]
    let private retentionClass: obj = jsNative

    [<Emit("new $0()")>]
    let private construct (_cls: obj) : obj = jsNative

    let private codec = construct codecClass
    let private retention = construct retentionClass
    let private segments = Wanxiangli.Segments.WriterSegments.WriterSegments()

    [<Emit("new WeakMap()")>]
    let private createOwners () : obj = jsNative

    let private owners = createOwners ()

    [<Emit("$0.set($1, $2)")>]
    let private setOwner (_owners: obj) (_owner: obj) (_cache: Dictionary<string, CacheEntry>) : unit = jsNative

    [<Emit("$0.get($1)")>]
    let private getOwner (_owners: obj) (_owner: obj) : Dictionary<string, CacheEntry> = jsNative

    let bind owner = setOwner owners owner (Dictionary<string, CacheEntry>())
    let cache owner = getOwner owners owner

    [<Emit("$0()")>]
    let private directory (_provider: obj) : string = jsNative

    [<Emit("[$0.dev, $0.ino, $0.mode, $0.size, $0.mtimeMs, $0.ctimeMs].join(':')")>]
    let private statIdentity (_stat: obj) : string = jsNative

    [<Emit("({ [Symbol.iterator]() { return { next: $0 } } })")>]
    let private iterableOfNext (_next: unit -> obj) : obj = jsNative

    let private exists path : bool = fs?existsSync path
    let private stat path : obj = fs?statSync path
    let private readBytes path : byte[] = fs?readFileSync path
    let private openFile path : int = fs?openSync (path, "r")
    let private closeFile fd : unit = fs?closeSync fd
    let private size path : int = (stat path)?size

    let private fileActivity path : float =
        let mtimeMs: float = (stat path)?mtimeMs
        round mtimeMs

    let private nonCanonical reason = createObj [ "code" ==> "NonCanonical"; "reason" ==> reason ]

    let private decodeText label text : Result<obj array, obj> =
        let outcome = segments.decodeStream(label, text)
        let ok: bool = outcome?ok
        let events: obj array = outcome?events
        let error: obj = outcome?error
        if ok then Ok events else Error error

    let private decodeUtf8 bytes : Result<string, obj> =
        let outcome: obj = codec?tryDecodeUtf8Text bytes
        let ok: bool = outcome?ok
        let text: string = outcome?text
        let error: obj = outcome?error
        if ok then Ok text else Error error

    let private decodeBytes path bytes =
        decodeUtf8 bytes |> Result.bind (decodeText path)

    let private pruneCache (cache: Dictionary<string, CacheEntry>) =
        cache.Keys
        |> Seq.filter (fun path -> not (exists path))
        |> Seq.toList
        |> List.iter (fun path -> cache.Remove path |> ignore)

    let private readExactAt fd position length =
        let bytes = Array.zeroCreate<byte> length
        let mutable filled = 0

        while filled < length do
            let count: int = fs?readSync (fd, bytes, filled, length - filled, position + filled)

            if count <= 0 then
                failwith "unexpected EOF while reading writer tail"

            filled <- filled + count

        bytes

    let private tryPhysical action onError =
        try
            action ()
        with ex ->
            onError ex

    let private withReadFd path onError action =
        let fd = openFile path

        try
            tryPhysical (fun () -> action fd) onError
        finally
            closeFile fd

    let private decodeFileCached (cache: Dictionary<string, CacheEntry>) path =
        let observed = stat path
        let dev: float = observed?dev
        let ino: float = observed?ino
        let length: int = observed?size
        let identity = statIdentity observed

        let remember events =
            cache[path] <-
                { Dev = dev
                  Ino = ino
                  Identity = identity
                  Length = length
                  Events = events }

            events

        let fullDecode () = readBytes path |> decodeBytes path |> Result.map remember

        let incrementalDecode cached =
            withReadFd path
                (fun ex -> Error(nonCanonical (sprintf "writer read failed: %s" ex.Message)))
                (fun fd -> Ok(readExactAt fd cached.Length (length - cached.Length)))
            |> Result.bind (decodeBytes path)
            |> Result.map (fun appended -> Array.append cached.Events appended |> remember)

        match cache.TryGetValue path with
        | true, cached when cached.Identity = identity -> Ok cached.Events
        | true, cached when cached.Dev = dev && cached.Ino = ino && cached.Length < length -> incrementalDecode cached
        | _ -> fullDecode ()

    let private locateLineStart fd lineEnd =
        let mutable cursor = lineEnd
        let mutable start: int option = None

        while start.IsNone do
            let blockStart = max 0 (cursor - 4096)
            let bytes = readExactAt fd blockStart (cursor - blockStart)

            match bytes |> Array.tryFindIndexBack ((=) 10uy) with
            | Some index -> start <- Some(blockStart + index + 1)
            | None when blockStart = 0 -> start <- Some 0
            | None -> cursor <- blockStart

        start.Value

    let private readCompleteLineBefore fd path lineEnd : Result<TailLine, string> =
        if lineEnd <= 0 then
            Error(sprintf "writer file contains empty final line: %s" path)
        else
            let start = locateLineStart fd lineEnd
            let length = lineEnd - start

            if length <= 0 then
                Error(sprintf "writer file contains empty final line: %s" path)
            else
                readExactAt fd start length
                |> decodeUtf8
                |> Result.mapError (fun _ -> sprintf "writer file contains invalid UTF-8: %s" path)
                |> Result.map (fun text -> { Start = start; Text = text })

    let private nonEmptyFileSize path =
        let present = exists path
        let length = if present then size path else 0
        if not present || length = 0 then None else Some length

    let private writerActivity paths =
        let opened = ResizeArray<int>()
        let mutable files = List.rev paths
        let mutable cursor = BetweenFiles
        let mutable stopped = false

        let stop () =
            stopped <- true
            None

        let enterSizedFile path length =
            let fd = openFile path
            opened.Add fd
            let endsWithLf = tryPhysical (fun () -> (readExactAt fd (length - 1) 1)[0] = 10uy) (fun _ -> false)

            if endsWithLf then
                cursor <- InsideFile(fd, path, length - 1)
                Some()
            else
                stop ()

        let enterFile path =
            match nonEmptyFileSize path with
            | None -> stop ()
            | Some length -> enterSizedFile path length

        let enterNextFile () =
            match files with
            | [] -> stop ()
            | path :: rest ->
                files <- rest
                enterFile path

        let readLineBefore fd path lineEnd =
            match tryPhysical (fun () -> readCompleteLineBefore fd path lineEnd) (fun ex -> Error ex.Message) with
            | Error _ -> stop ()
            | Ok line ->
                cursor <- if line.Start > 0 then InsideFile(fd, path, line.Start - 1) else BetweenFiles
                Some line.Text

        let rec pull () =
            match stopped, cursor with
            | true, _ -> None
            | false, BetweenFiles -> enterNextFile () |> Option.bind pull
            | false, InsideFile(fd, path, lineEnd) -> readLineBefore fd path lineEnd

        let next () =
            match pull () with
            | Some line -> createObj [ "done" ==> false; "value" ==> line ]
            | None -> createObj [ "done" ==> true ]

        let verdict: obj =
            try
                retention?lastActivity (iterableOfNext next)
            finally
                opened |> Seq.iter closeFile

        if isNull verdict then
            paths |> List.map fileActivity |> List.max
        else
            unbox<float> verdict

    let private writerFileGroups provider =
        let path = directory provider

        if not (exists path) then
            []
        else
            let names: string array = fs?readdirSync path
            segments.groupWriterFiles names
            |> Array.toList
            |> List.map (fun group ->
                let writerId: string = group?writerId
                let fileNames: string array = group?fileNames
                { WriterId = writerId; FileNames = Array.toList fileNames })

    [<Emit("$0 != null && $0.code === $1")>]
    let private hasErrorCode (_error: exn) (_code: string) : bool = jsNative

    /// Listing a writer directory whose parent is a regular file yields no
    /// writers: the store reports the empty history and the append boundary then
    /// refuses at its own mkdir. Every other listing failure — a directory where
    /// a file belongs (EISDIR), a permission refusal (EACCES) — stays an error;
    /// reading those as "no history yet" would hide a real broken store.
    let private listedWriterFileGroups provider =
        try
            writerFileGroups provider
        with ex ->
            if hasErrorCode ex "ENOTDIR" then [] else reraise ()

    let private physicalMetadata provider =
        listedWriterFileGroups provider
        |> List.map (fun group ->
            let paths = group.FileNames |> List.map (fun name -> join (directory provider) name)
            { Group = group; LastActivityMs = writerActivity paths })

    let writerPhysicalMetadata provider =
        physicalMetadata provider
        |> List.map (fun writer ->
            createObj [ "writerId" ==> writer.Group.WriterId
                        "fileNames" ==> List.toArray writer.Group.FileNames
                        "lastActivityMs" ==> writer.LastActivityMs ])
        |> List.toArray

    let physicalInventory provider =
        try
            writerFileGroups provider
            |> List.sortBy (fun group -> group.WriterId)
            |> List.map (fun group ->
                let files =
                    group.FileNames
                    |> List.sort
                    |> List.map (fun name ->
                        let path = join (directory provider) name
                        if exists path then name + "=" + statIdentity (stat path)
                        else name + "=missing")
                    |> String.concat ","
                group.WriterId + "[" + files + "]")
            |> String.concat ";"
        with _ ->
            "inventory-unavailable"

    let private coexistingForms path writerId legacyFile segmentNames =
        let legacyBytes = readBytes (join path legacyFile)
        let segmentBytes = segmentNames |> List.map (fun name -> readBytes (join path name)) |> Array.concat
        let verdict = segments.coexistence(legacyBytes, segmentBytes)
        let kind: string = verdict?kind

        match kind with
        | "series" -> Ok(segmentNames |> List.map (fun name -> name, 0))
        | "legacy" -> Ok [ legacyFile, 0 ]
        | "continuation" ->
            let copied: int = verdict?copiedLines
            Ok((segmentNames |> List.map (fun name -> name, 0)) @ [ legacyFile, copied ])
        | _ -> Error(nonCanonical (sprintf "writer files diverged: %s" writerId))

    let private logicalStreamFiles provider group =
        let layout =
            segments.streamLayout (createObj [ "writerId" ==> group.WriterId; "fileNames" ==> List.toArray group.FileNames ])

        let names () =
            let names: string array = layout?segments
            Array.toList names

        let kind: string = layout?kind
        let legacy: string = layout?legacy

        match kind with
        | "segments" -> Ok(names () |> List.map (fun name -> name, 0))
        | "legacy" -> Ok [ legacy, 0 ]
        | "coexisting" -> coexistingForms (directory provider) group.WriterId legacy (names ())
        | _ -> Error(nonCanonical (sprintf "multiple legacy files for one writer: %s" group.WriterId))

    let private decodeWriterFiles cache provider group =
        // A writer may hold up to 10,000 segments. Folding them through
        // `Result.bind` nests one continuation per file and overflows the stack
        // long before the ordinal space runs out, so the walk is a plain loop.
        match logicalStreamFiles provider group with
        | Error error -> Error error
        | Ok files ->
            let decoded = ResizeArray<obj[]>(files.Length)
            // DSL-MUTABLE: algorithm-scratch — the first failing file stops the walk.
            let mutable failure: obj option = None
            let mutable index = 0

            while index < files.Length && failure.IsNone do
                let name, copied = files[index]

                match decodeFileCached cache (join (directory provider) name) with
                | Error error -> failure <- Some error
                | Ok events -> decoded.Add(Array.skip copied events)

                index <- index + 1

            match failure with
            | Some error -> Error error
            | None -> Ok(decoded |> Seq.concat |> Array.ofSeq)

    let readStreams cache provider nowMs =
        pruneCache cache

        let groups =
            physicalMetadata provider
            |> List.filter (fun writer ->
                let retained: bool = retention?isRetained (nowMs, writer.LastActivityMs)
                retained)
            |> List.map (fun writer -> writer.Group)

        let streams = ResizeArray<obj>(groups.Length)
        // DSL-MUTABLE: algorithm-scratch — the first failing writer stops the walk.
        let mutable failure: obj option = None
        let mutable index = 0

        while index < groups.Length && failure.IsNone do
            let group = groups[index]

            match decodeWriterFiles cache provider group with
            | Error error -> failure <- Some error
            | Ok events ->
                streams.Add(createObj [ "writerId" ==> group.WriterId; "events" ==> events ])

            index <- index + 1

        match failure with
        | Some error -> createObj [ "ok" ==> false; "error" ==> error ]
        | None -> createObj [ "ok" ==> true; "streams" ==> streams.ToArray() ]

[<AttachMembers>]
type SegmentedReader() as this =
    do Readers.bind this

    member this.readStreams(directory: obj, nowMs: float) : obj = Readers.readStreams (Readers.cache this) directory nowMs
    member _.writerPhysicalMetadata(directory: obj) : obj array = Readers.writerPhysicalMetadata directory
    member _.physicalInventory(directory: obj) : string = Readers.physicalInventory directory
