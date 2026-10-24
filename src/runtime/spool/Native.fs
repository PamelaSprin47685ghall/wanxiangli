namespace Wanxiangli.Spool

open Fable.Core
open Fable.Core.JsInterop

module internal Native =
    [<Import("openSync", "node:fs")>]
    let openFile (_path: string) (_flags: string) (_mode: int) : int = jsNative

    [<Import("writeSync", "node:fs")>]
    let writeSome (_fd: int) (_bytes: byte array) (_offset: int) (_length: int) : int = jsNative

    [<Import("closeSync", "node:fs")>]
    let closeFile (_fd: int) : unit = jsNative

    [<Import("unlinkSync", "node:fs")>]
    let unlink (_path: string) : unit = jsNative

    [<Import("join", "node:path")>]
    let join (_directory: string) (_name: string) : string = jsNative

    [<Import("isAbsolute", "node:path")>]
    let isAbsolute (_path: string) : bool = jsNative

    [<Import("randomUUID", "node:crypto")>]
    let randomId () : string = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("Object.getOwnPropertyNames($0)")>]
    let names (_value: obj) : string array = jsNative

    [<Emit("Object.getOwnPropertySymbols($0).length")>]
    let symbolCount (_value: obj) : int = jsNative

    [<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
    let descriptor (_value: obj) (_name: string) : obj = jsNative

    [<Emit("$0 != null && Object.prototype.hasOwnProperty.call($0, 'value')")>]
    let isValue (_descriptor: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string' && $0.isWellFormed() && !$0.includes('\\0')")>]
    let isText (_value: obj) : bool = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= 0 && $0 <= $1")>]
    let integerIn (_value: obj) (_maximum: float) : bool = jsNative

    [<Emit("$0 instanceof Uint8Array && !(typeof SharedArrayBuffer !== 'undefined' && $0.buffer instanceof SharedArrayBuffer)")>]
    let isBytes (_value: obj) : bool = jsNative

    [<Emit("Uint8Array.from($0)")>]
    let copy (_bytes: byte array) : byte array = jsNative

    [<Emit("((chunks) => { let size = 0; for (const c of chunks) size += c.length; const out = new Uint8Array(size); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out; })($0)")>]
    let concat (_parts: byte array array) : byte array = jsNative

    [<Emit("""(async (path, chunk, consume) => {
        const { open } = await import('node:fs/promises');
        const handle = await open(path, 'r');
        let total = 0;
        try {
            const buffer = new Uint8Array(chunk);
            for (;;) {
                const { bytesRead } = await handle.read(buffer, 0, chunk, null);
                if (bytesRead === 0) break;
                total += bytesRead;
                await consume(buffer.slice(0, bytesRead));
            }
        } finally { await handle.close(); }
        return { bytes: total };
    })($0, $1, $2)""")>]
    let readChunks (_path: string) (_chunk: int) (_consume: obj) : JS.Promise<obj> = jsNative

    [<Emit("""(async (path, limit) => {
        const { open } = await import('node:fs/promises');
        const handle = await open(path, 'r');
        try {
            const size = (await handle.stat()).size;
            const keep = Math.min(size, limit);
            const start = size - keep;
            const buffer = new Uint8Array(keep);
            let at = 0;
            while (at < keep) {
                const { bytesRead } = await handle.read(buffer, at, keep - at, start + at);
                if (bytesRead === 0) break;
                at += bytesRead;
            }
            return { size, start, bytes: buffer.subarray(0, at) };
        } finally { await handle.close(); }
    })($0, $1)""")>]
    let readEnd (_path: string) (_limit: float) : JS.Promise<obj> = jsNative

    [<Emit("$0.then($1)")>]
    let mapPromise (_source: JS.Promise<obj>) (_map: obj -> obj) : JS.Promise<obj> = jsNative

    [<Emit("$0.catch($1)")>]
    let recover (_source: JS.Promise<obj>) (_map: obj -> obj) : JS.Promise<obj> = jsNative

    [<Emit("Object.defineProperty($0, $1, { value: $2, enumerable: false })")>]
    let attach (_target: obj) (_name: string) (_value: obj) : unit = jsNative

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

    let path (source: obj) =
        require (isText source) "Path must be valid text without NUL"
        let result: string = unbox source
        require (result.Length > 0 && isAbsolute result) "Path must be absolute"
        result

    let integer maximum (source: obj) =
        require (integerIn source maximum) "Expected a non-negative safe integer within the limit"
        unbox<float> source

    let failure operation (error: obj) =
        let message =
            if isNullOrUndefined error then
                null
            else
                get error "message"

        let code = if isNullOrUndefined error then null else get error "code"

        objectOf
            [ "operation", box operation
              "message",
              (if isNullOrUndefined message then
                   box "Native operation failed"
               else
                   box (string message))
              "code", (if isNullOrUndefined code then null else box (string code)) ]
