namespace Wanxiangli.Pty

open Fable.Core
open Fable.Core.JsInterop

module internal Native =
    [<Import("isAbsolute", "node:path")>]
    let isAbsolute (_path: string): bool = jsNative

    [<Import("statSync", "node:fs")>]
    let stat (_path: string): obj = jsNative

    [<Emit("$0.isDirectory()")>]
    let isDirectory (_info: obj): bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let isObject (_value: obj): bool = jsNative

    [<Emit("Object.getOwnPropertyNames($0)")>]
    let names (_value: obj): string array = jsNative

    [<Emit("Object.getOwnPropertySymbols($0).length")>]
    let symbolCount (_value: obj): int = jsNative

    [<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
    let descriptor (_value: obj) (_name: string): obj = jsNative

    [<Emit("$0 != null && Object.prototype.hasOwnProperty.call($0, 'value')")>]
    let isValue (_descriptor: obj): bool = jsNative

    [<Emit("typeof $0 === 'string' && $0.isWellFormed()")>]
    let isWellFormed (_value: obj): bool = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= $1 && $0 <= $2")>]
    let integerIn (_value: obj) (_minimum: float) (_maximum: float): bool = jsNative

    [<Emit("typeof $0 === 'function'")>]
    let isFunction (_value: obj): bool = jsNative

    [<Emit("$0($1, $2, $3)")>]
    let invoke3 (_fn: obj) (_a: obj) (_b: obj) (_c: obj): obj = jsNative

    [<Emit("$0[$1]((value) => $2(value))")>]
    let subscribe (_target: obj) (_name: string) (_callback: obj -> unit): unit = jsNative

    [<Emit("$0[$1]($2)")>]
    let call1 (_target: obj) (_name: string) (_a: obj): unit = jsNative

    [<Emit("$0[$1]($2, $3)")>]
    let call2 (_target: obj) (_name: string) (_a: obj) (_b: obj): unit = jsNative

    [<Emit("process.kill($0, $1)")>]
    let kill (_pid: float) (_signal: string): unit = jsNative

    [<Emit("setTimeout($0, $1)")>]
    let after (_callback: unit -> unit) (_ms: float): obj = jsNative

    [<Emit("clearTimeout($0)")>]
    let cancel (_timer: obj): unit = jsNative

    [<Emit("new Promise((resolve) => $0(resolve))")>]
    let promise (_start: (obj -> unit) -> unit): JS.Promise<obj> = jsNative

    [<Emit("$0.then($1)")>]
    let andThen (_source: JS.Promise<obj>) (_next: obj -> obj): JS.Promise<obj> = jsNative

    [<Emit("Promise.resolve($0)")>]
    let resolved (_value: obj): JS.Promise<obj> = jsNative

    [<Emit("Object.defineProperty($0, $1, { value: $2, enumerable: false })")>]
    let attach (_target: obj) (_name: string) (_value: obj): unit = jsNative

    let require condition message = if not condition then invalidOp message
    let get (value: obj) (key: string): obj = value?(key)
    let objectOf (values: (string * obj) list): obj = createObj values

    let value (source: obj) name =
        let property = descriptor source name
        require (isValue property) ("Expected an own data field: " + name)
        get property "value"

    let fields expected source =
        require (isObject source && symbolCount source = 0) "Expected a plain data object"
        let actual = names source |> Array.sort
        require (actual = (expected |> List.toArray |> Array.sort)) "Unexpected or missing fields"
        for name in actual do value source name |> ignore

    let integer minimum maximum (source: obj) =
        require (integerIn source minimum maximum) "Expected a safe integer within the limit"
        unbox<float> source

    let failure operation (error: obj) =
        let message = if isNullOrUndefined error then null else get error "message"
        let code = if isNullOrUndefined error then null else get error "code"
        objectOf [ "operation", box operation
                   "message", (if isNullOrUndefined message then box "Native operation failed" else box (string message))
                   "code", (if isNullOrUndefined code then null else box (string code)) ]
