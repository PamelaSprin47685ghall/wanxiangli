namespace Wanxiangli.Process

open Fable.Core
open Fable.Core.JsInterop

module internal Native =
    [<Import("spawn", "node:child_process")>]
    let spawn (_file: string) (_arguments: string array) (_options: obj) : obj = jsNative

    [<ImportAll("node:process")>]
    let runtime: obj = jsNative

    [<Import("isAbsolute", "node:path")>]
    let isAbsolute (_path: string) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("Object.getOwnPropertyNames($0)")>]
    let names (_value: obj) : string array = jsNative

    [<Emit("Object.getOwnPropertySymbols($0).length")>]
    let symbolCount (_value: obj) : int = jsNative

    [<Emit("Object.fromEntries($0)")>]
    let dictionary (_entries: (string * obj) array) : obj = jsNative

    [<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
    let descriptor (_value: obj) (_name: string) : obj = jsNative

    [<Emit("$0 != null && Object.prototype.hasOwnProperty.call($0, 'value')")>]
    let isValue (_descriptor: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string' && $0.isWellFormed() && !$0.includes('\\0')")>]
    let isText (_value: obj) : bool = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= 0 && $0 <= $1")>]
    let integerIn (_value: obj) (_maximum: float) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("$0 instanceof Uint8Array && !(typeof SharedArrayBuffer !== 'undefined' && $0.buffer instanceof SharedArrayBuffer)")>]
    let isBytes (_value: obj) : bool = jsNative

    [<Emit("$0.set($1.subarray($2, $2 + $3), $4)")>]
    let copyBytes (_target: byte array) (_source: byte array) (_offset: int) (_count: int) (_destination: int) : unit =
        jsNative

    [<Emit("new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode($0)")>]
    let decode (_bytes: byte array) : string = jsNative

    [<Emit("new Promise($0)")>]
    let promise (_executor: (obj -> unit) -> unit) : JS.Promise<obj> = jsNative

    [<Emit("Promise.resolve($0)")>]
    let resolved (_value: obj) : JS.Promise<obj> = jsNative

    [<Emit("$0.then($1)")>]
    let mapPromise (_source: JS.Promise<obj>) (_map: obj -> obj) : JS.Promise<obj> = jsNative

    [<Emit("setTimeout($0, $1)")>]
    let timer (_callback: unit -> unit) (_milliseconds: int) : obj = jsNative

    [<Emit("clearTimeout($0)")>]
    let clearTimer (_timer: obj) : unit = jsNative

    [<Emit("JSON.parse(JSON.stringify($0))")>]
    let clone (_value: obj) : obj = jsNative

    [<Emit("$0.on($1, $2)")>]
    let on1 (_target: obj) (_event: string) (_callback: obj -> unit) : unit = jsNative

    [<Emit("$0.on($1, $2)")>]
    let on2 (_target: obj) (_event: string) (_callback: obj -> obj -> unit) : unit = jsNative

    [<Emit("$0.write($1, $2)")>]
    let write (_stream: obj) (_bytes: byte array) (_callback: obj -> unit) : unit = jsNative

    [<Emit("$0.end()")>]
    let endStream (_stream: obj) : unit = jsNative

    [<Emit("$0.kill(-$1, $2)")>]
    let killGroup (_runtime: obj) (_pid: int) (_signal: string) : unit = jsNative

    let require condition message =
        if not condition then
            invalidOp message

    let get (value: obj) (key: string) : obj = value?(key)
    let objectOf (values: (string * obj) list) : obj = createObj values

    let value (source: obj) name =
        let property = descriptor source name
        require (isValue property) ("Expected an own data field: " + name)
        get property "value"

    let fields expected source =
        require (isObject source && symbolCount source = 0) "Expected a plain data object"
        let actual = names source |> Array.sort
        require (actual = (expected |> List.toArray |> Array.sort)) "Unexpected or missing fields"

        for name in actual do
            value source name |> ignore

    let text allowEmpty source =
        require (isText source) "Expected valid text without NUL"
        let result: string = unbox source
        require (allowEmpty || result.Length > 0) "Text must not be empty"
        result

    let integer maximum source =
        require (integerIn source maximum) "Expected a non-negative safe integer within the limit"
        unbox<float> source

    let failure operation (error: obj) =
        let message = get error "message"
        let code = get error "code"

        objectOf
            [ "operation", box operation
              "message",
              (if isNullOrUndefined message then
                   box "Native operation failed"
               else
                   box (string message))
              "code", (if isNullOrUndefined code then null else box (string code)) ]

type internal StartOptions =
    { Executable: string
      Arguments: string array
      Directory: string
      Environment: obj
      TailBytes: int
      MaxWriteBytes: int }

module internal StartOptions =
    let read input =
        Native.fields [ "executable"; "args"; "cwd"; "env"; "tailBytes"; "maxWriteBytes" ] input

        let path name =
            let result = Native.value input name |> Native.text false
            Native.require (Native.isAbsolute result) (name + " must be absolute")
            result

        let executable = path "executable"
        let directory = path "cwd"
        let arguments = Native.value input "args"

        Native.require
            (Native.isArray arguments && Native.symbolCount arguments = 0)
            "args must be an array of data strings"

        let count: int = arguments?length
        Native.require ((Native.names arguments).Length = count + 1) "args contains extra properties or holes"

        let arguments =
            Array.init count (fun index -> Native.value arguments (string index) |> Native.text true)

        let environment = Native.value input "env"

        Native.require
            (Native.isObject environment && Native.symbolCount environment = 0)
            "env must be a plain data object"

        let pairs =
            Native.names environment
            |> Array.map (fun name ->
                Native.text false (box name) |> ignore
                Native.require (not (name.Contains "=")) "Environment name contains equals"
                name, box (Native.value environment name |> Native.text true))
            |> Array.toList

        let tail = Native.value input "tailBytes" |> Native.integer 16777216. |> int
        let write = Native.value input "maxWriteBytes" |> Native.integer 16777216. |> int
        Native.require (write > 0) "maxWriteBytes must be positive"
        let platform: string = Native.runtime?platform
        Native.require (platform = "linux" || platform = "darwin") "POSIX process groups are required"

        { Executable = executable
          Arguments = arguments
          Directory = directory
          Environment = Native.dictionary (List.toArray pairs)
          TailBytes = tail
          MaxWriteBytes = write }
