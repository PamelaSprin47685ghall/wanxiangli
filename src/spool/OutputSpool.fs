module Wanxiangli.Spool.OutputSpool

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Spool

[<AllowNullLiteral>]
type SpoolMessages =
    abstract append: channel: string * bytes: byte array -> obj
    abstract inspect: unit -> obj
    abstract finish: unit -> obj
    abstract discard: unit -> obj

/// 内存留存的上限与单次读取块的上限；超过它的内存缓冲不再是有界缓冲。
let private maximumBytes = 16777216.

let private continuation (value: byte) = value >= 0x80uy && value <= 0xBFuy

let private construct (input: obj): SpoolMessages =
    Native.fields [ "directory"; "memoryBytes" ] input
    let directory = Native.value input "directory" |> Native.path
    let memoryBytes = Native.value input "memoryBytes" |> Native.integer maximumBytes
    let entries = ResizeArray<string * byte array>()
    let mutable held = 0.
    let mutable observed = 0.
    let mutable written = 0.
    let mutable mode = "Memory"
    let mutable finished = false
    let mutable removed = false
    let mutable descriptor: int option = None
    let mutable path: string option = None
    let mutable failure: obj = null
    let mutable result: obj = null

    let closeDescriptor () =
        match descriptor with
        | Some fd ->
            descriptor <- None
            Native.closeFile fd
        | None -> ()

    let fail operation (error: obj) =
        if isNull failure then failure <- Native.failure operation error
        mode <- "Failed"
        entries.Clear()
        held <- 0.
        try closeDescriptor () with _ -> ()

    let writeAll fd (bytes: byte array) =
        let mutable offset = 0
        while offset < bytes.Length do
            let count = Native.writeSome fd bytes offset (bytes.Length - offset)
            offset <- offset + count
            written <- written + float count

    let switchToFile () =
        try
            let target = Native.join directory ("wanxiangli-spool-" + Native.randomId () + ".out")
            let fd = Native.openFile target "wx" 0o600
            path <- Some target
            descriptor <- Some fd
            for (_, bytes) in entries do writeAll fd bytes
            entries.Clear()
            held <- 0.
            mode <- "File"
        with error -> fail (if descriptor.IsNone then "open" else "write") (box error)

    let pathValue () = match path with Some value -> box value | None -> null

    let state () =
        Native.objectOf [ "phase", box (if finished then "Finished" else mode)
                          "observed", box observed; "written", box written; "held", box held
                          "path", pathValue (); "failure", failure ]

    let append (channel: string, bytes: byte array) =
        Native.require (channel = "stdout" || channel = "stderr") "Channel must be stdout or stderr"
        Native.require (Native.isBytes (box bytes)) "Output must be a non-shared Uint8Array"
        if finished then Native.objectOf [ "kind", box "Finished" ]
        else
            observed <- observed + float bytes.Length
            match mode with
            | "Memory" when bytes.Length > 0 ->
                entries.Add(channel, Native.copy bytes)
                held <- held + float bytes.Length
                if held > memoryBytes then switchToFile ()
            | "File" when bytes.Length > 0 ->
                try writeAll descriptor.Value bytes with error -> fail "write" (box error)
            | _ -> ()
            if mode = "Failed" then Native.objectOf [ "kind", box "Failed"; "error", failure ]
            else Native.objectOf [ "kind", box mode ]

    let channelBytes name =
        entries |> Seq.filter (fun (channel, _) -> channel = name) |> Seq.map snd |> Seq.toArray |> Native.concat

    let finish () =
        if isNull result then
            finished <- true
            if mode = "File" then
                try closeDescriptor () with error -> fail "close" (box error)
            result <-
                match mode with
                | "Memory" ->
                    let output =
                        Native.objectOf [ "kind", box "Memory"; "observed", box observed
                                          "stdout", box (channelBytes "stdout"); "stderr", box (channelBytes "stderr") ]
                    entries.Clear()
                    held <- 0.
                    output
                | "File" -> Native.objectOf [ "kind", box "File"; "observed", box observed; "path", pathValue (); "bytes", box written ]
                | _ ->
                    Native.objectOf [ "kind", box "Failed"; "observed", box observed; "written", box written
                                      "path", pathValue (); "error", failure ]
        match Native.get result "kind" |> unbox<string> with
        | "Memory" ->
            Native.objectOf [ "kind", box "Memory"; "observed", Native.get result "observed"
                              "stdout", box (Native.copy (unbox (Native.get result "stdout")))
                              "stderr", box (Native.copy (unbox (Native.get result "stderr"))) ]
        | _ -> JS.JSON.parse (JS.JSON.stringify result)

    let discard () =
        finished <- true
        entries.Clear()
        held <- 0.
        try closeDescriptor () with _ -> ()
        match path with
        | None -> Native.objectOf [ "kind", box "Absent" ]
        | Some _ when removed -> Native.objectOf [ "kind", box "Absent" ]
        | Some target ->
            try
                Native.unlink target
                removed <- true
                Native.objectOf [ "kind", box "Removed" ]
            with error ->
                if Native.get error "code" = box "ENOENT" then
                    removed <- true
                    Native.objectOf [ "kind", box "Absent" ]
                else Native.objectOf [ "kind", box "Failed"; "error", Native.failure "unlink" (box error) ]

    { new SpoolMessages with
        member _.append(channel, bytes) = append (channel, bytes)
        member _.inspect() = state ()
        member _.finish() = finish ()
        member _.discard() = discard () }

let private readChunks (target: obj) (chunkBytes: obj) (consume: obj) : JS.Promise<obj> =
    let file = Native.path target
    let size = Native.integer maximumBytes chunkBytes
    Native.require (size > 0.) "chunkBytes must be positive"
    Native.require (jsTypeof consume = "function") "consume must be a function"
    let reading = Native.readChunks file (int size) consume
    Native.recover
        (Native.mapPromise reading (fun outcome -> Native.objectOf [ "kind", box "Read"; "bytes", Native.get outcome "bytes" ]))
        (fun error -> Native.objectOf [ "kind", box "Failed"; "error", Native.failure "read" error ])

let private readTail (target: obj) (limitBytes: obj) : JS.Promise<obj> =
    let file = Native.path target
    let limit = Native.integer maximumBytes limitBytes
    let shape (raw: obj) =
        let start: float = unbox (Native.get raw "start")
        let bytes: byte array = unbox (Native.get raw "bytes")
        let mutable skip = 0
        if start > 0. then
            while skip < bytes.Length && skip < 3 && continuation bytes[skip] do
                skip <- skip + 1
        Native.objectOf [ "kind", box "Tail"; "observed", Native.get raw "size"
                          "truncated", box (start + float skip > 0.); "discarded", box (start + float skip)
                          "bytes", box (Native.copy bytes[skip..]) ]
    Native.recover
        (Native.mapPromise (Native.readEnd file limit) shape)
        (fun error -> Native.objectOf [ "kind", box "Failed"; "error", Native.failure "read" error ])

let OutputSpool (input: obj): SpoolMessages = construct input

let private constructor: obj = box (System.Func<obj, SpoolMessages>(OutputSpool))

do
    Native.attach constructor "readChunks" (box (System.Func<obj, obj, obj, JS.Promise<obj>>(readChunks)))
    Native.attach constructor "readTail" (box (System.Func<obj, obj, JS.Promise<obj>>(readTail)))
