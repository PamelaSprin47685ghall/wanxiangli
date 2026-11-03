namespace Wanxiangli.Segments

open Fable.Core
open Fable.Core.JsInterop

module private Writers =
    type State =
        { Directory: obj
          WriterId: string
          Cap: int
          mutable CurrentFile: string }

    let private segments = Wanxiangli.Segments.WriterSegments.WriterSegments()

    [<Import("default", "node:fs")>]
    let private fs: obj = jsNative

    [<Import("join", "node:path")>]
    let private join (_left: string) (_right: string) : string = jsNative

    [<Emit("new WeakMap()")>]
    let private createOwners () : obj = jsNative

    let private owners = createOwners ()

    [<Emit("$0.set($1, $2)")>]
    let private set (_owners: obj) (_owner: obj) (_state: State) : unit = jsNative

    [<Emit("$0.get($1)")>]
    let private get (_owners: obj) (_owner: obj) : State = jsNative

    let state owner = get owners owner

    let bind owner options =
        let cap: int = options?segmentCap
        if cap <= 0 then invalidArg "segmentCap" "segment cap must be positive"
        let writer: string = options?writerId
        match segments.writerIdFault writer |> unbox<string> with
        | null -> ()
        | "required" -> invalidArg "writerId" "WriterId is required"
        | "pathSegment" -> invalidArg "writerId" "WriterId must be one path segment"
        | _ -> invalidArg "writerId" "WriterId must not end with a hyphen and four digits"
        let directory: obj = options?directory
        set owners owner { Directory = directory; WriterId = writer; Cap = cap; CurrentFile = segments.segmentFileName(writer, 0) }

    [<Emit("$0()")>]
    let private directory (_provider: obj) : string = jsNative

    let private fileOf state name = join (directory state.Directory) name
    let filePath state = fileOf state state.CurrentFile

    [<Emit("$0.existsSync($1)")>]
    let private exists (_fs: obj) (_path: string) : bool = jsNative

    [<Emit("$0.readdirSync($1)")>]
    let private names (_fs: obj) (_directory: string) : string array = jsNative

    [<Emit("$0.statSync($1).size")>]
    let private size (_fs: obj) (_path: string) : int = jsNative

    [<Emit("$0.mkdirSync($1, {recursive: true})")>]
    let private ensureDirectory (_fs: obj) (_directory: string) : unit = jsNative

    [<Emit("Buffer.byteLength($0, 'utf8')")>]
    let private byteLength (_text: string) : int = jsNative

    [<Emit("$0.appendFileSync($1, $2, 'utf8')")>]
    let private appendText (_fs: obj) (_path: string) (_text: string) : unit = jsNative

    [<Emit("$0.openSync($1, 'r+')")>]
    let private openFile (_fs: obj) (_path: string) : int = jsNative

    [<Emit("$0.fsyncSync($1)")>]
    let private syncFile (_fs: obj) (_fd: int) : unit = jsNative

    [<Emit("$0.closeSync($1)")>]
    let private closeFile (_fs: obj) (_fd: int) : unit = jsNative

    [<Emit("({phase: $0, cause: $1})")>]
    let private fault (_phase: string) (_cause: obj) : obj = jsNative

    [<Emit("({ok: false, kind: $0, primary: $1, cleanupFailures: $2})")>]
    let private failure (_kind: string) (_primary: obj) (_cleanup: obj array) : obj = jsNative

    [<Emit("({ok: true, completion: $0})")>]
    let private success (_completion: string) : obj = jsNative

    let private attempt phase action =
        try Ok(action ())
        with cause -> Error(fault phase (box cause))

    let private series state =
        let currentDirectory = directory state.Directory
        if not (exists fs currentDirectory) then [||]
        else segments.seriesOf(state.WriterId, names fs currentDirectory)

    let private fallback state =
        if exists fs (join (directory state.Directory) (segments.legacyFileName state.WriterId)) then
            segments.legacyFileName state.WriterId
        else segments.segmentFileName(state.WriterId, 0)

    let private highest state =
        match series state |> Array.tryLast with
        | Some name -> name
        | None -> fallback state

    let private resolveTarget state =
        let cached = fileOf state state.CurrentFile
        if exists fs cached then cached
        else
            state.CurrentFile <- highest state
            fileOf state state.CurrentFile

    let private nextOrdinal name =
        let parsed = segments.parseSegmentFileName name
        if isNull parsed then invalidArg "name" (sprintf "not a segment file name: %s" name)
        let ordinal: int = parsed?ordinal
        let next = ordinal + 1
        if next > segments.maxOrdinal then invalidArg "writerId" "segment ordinal exhausted the four-digit space"
        next

    let private roll state textBytes path =
        if state.CurrentFile = segments.legacyFileName state.WriterId then path
        else
            let currentSize = if exists fs path then size fs path else 0
            if currentSize > 0 && currentSize + textBytes > state.Cap then
                // 先改变目标再取路径；后续目录或追加失败不回滚这份真实状态。
                state.CurrentFile <- segments.segmentFileName(state.WriterId, nextOrdinal state.CurrentFile)
                fileOf state state.CurrentFile
            else path

    let private barrier path =
        match attempt "open" (fun () -> openFile fs path) with
        | Error primary -> failure "after-append" primary [||]
        | Ok fd ->
            let synced = attempt "fsync" (fun () -> syncFile fs fd)
            let closed = attempt "close" (fun () -> closeFile fs fd)
            match synced, closed with
            | Ok (), Ok () -> success "durable"
            | Error primary, Ok () | Ok (), Error primary -> failure "after-append" primary [||]
            | Error primary, Error cleanup -> failure "after-append" primary [| cleanup |]

    let private appendBytes path text =
        match attempt "append" (fun () -> appendText fs path text) with
        | Error primary -> failure "after-append" primary [||]
        | Ok () -> barrier path

    let append state text =
        if text = "" then success "no-append"
        else
            match attempt "before-append" (fun () -> ensureDirectory fs (directory state.Directory)) with
            | Error primary -> failure "before-append" primary [||]
            | Ok () ->
                let target () =
                    let path = resolveTarget state
                    roll state (byteLength text) path
                match attempt "before-append" target with
                | Error primary -> failure "before-append" primary [||]
                | Ok path -> appendBytes path text

[<AttachMembers>]
type SegmentedWriter(options: obj) as this =
    do Writers.bind this options
    member this.writerId = (Writers.state this).WriterId
    member this.filePath() : string = Writers.filePath (Writers.state this)
    member this.append(text: string) : obj = Writers.append (Writers.state this) text
