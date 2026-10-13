namespace Wanxiangli.Trace

open System
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =
    [<ImportAll("node:crypto")>]
    let private crypto: obj = jsNative

    [<Emit("$0.createHash('sha256').update($1, 'utf8').digest('hex')")>]
    let private hash (_provider: obj) (_text: string): string = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj): bool = jsNative

    [<Emit("$0.isWellFormed() && !$0.includes('\\0')")>]
    let private validId (_value: string): bool = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= 0")>]
    let private isIndex (_value: obj): bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let private isObject (_value: obj): bool = jsNative

    [<Emit("Reflect.ownKeys($0)")>]
    let private keys (_value: obj): obj array = jsNative

    [<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
    let private descriptor (_value: obj) (_key: string): obj = jsNative

    [<Emit("Object.prototype.hasOwnProperty.call($0, 'value')")>]
    let private hasValue (_value: obj): bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj): bool = jsNative

    [<Emit("$0 instanceof Uint8Array && ArrayBuffer.isView($0)")>]
    let private isBytes (_value: obj): bool = jsNative

    [<Emit("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer').get.call($0)")>]
    let private backingBuffer (_value: obj): obj = jsNative

    [<Emit("$0 instanceof ArrayBuffer && !Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable').get.call($0)")>]
    let private isFixedBuffer (_value: obj): bool = jsNative

    [<Emit("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get.call($0)")>]
    let private viewLength (_value: obj): float = jsNative

    [<Emit("Buffer.copyBytesFrom($0).toString('base64')")>]
    let private captureView (_value: obj): string = jsNative

    [<Emit("Buffer.from($0).toString('base64')")>]
    let private encodeBytes (_value: obj): string = jsNative

    [<Emit("new Uint8Array(Buffer.from($0, 'base64'))")>]
    let bytes (_value: string): byte array = jsNative

    [<Emit("new Uint8Array($0)")>]
    let private copyBytes (_value: byte array): byte array = jsNative

    [<Emit("new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode($0)")>]
    let private decodeText (_value: byte array): string = jsNative

    [<Emit("JSON.stringify($0)")>]
    let stringify (_value: obj): string = jsNative

    [<Emit("JSON.parse($0)")>]
    let parse (_value: string): obj = jsNative

    [<Emit("Buffer.byteLength($0, 'utf8')")>]
    let byteLength (_value: string): int = jsNative

    let require condition message = if not condition then invalidOp message
    let sha256 text = hash crypto text
    let make (pairs: (string * obj) list): obj = createObj pairs

    let field value key =
        let property = descriptor value key
        require (not (isNullOrUndefined property) && hasValue property) ("Missing field or accessor: " + key)
        let result: obj = property?value
        result

    let exact names value =
        require (isObject value) "Expected a plain data object"
        let found = keys value
        require (found.Length = List.length names) "Unexpected or missing fields"
        for key in found do
            require (isString key && List.contains (unbox<string> key) names) "Unknown field"
        for key in names do field value key |> ignore

    let text value =
        require (isString value) "Expected text"
        unbox<string> value

    let identifier value =
        let value = text value
        require (value.Length > 0 && value.Length <= 1024 && validId value) "Invalid identifier"
        value

    let index value =
        require (isIndex value) "Expected a non-negative safe integer"
        unbox<float> value

    let array value =
        require (isArray value) "Expected an array of data"
        let length: int = value?length
        Array.init length (fun position -> field value (string position))

    let captureBytes value =
        require (isBytes value) "Expected unshared fixed byte storage"
        require (backingBuffer value |> isFixedBuffer) "Expected unshared fixed byte storage"
        require (viewLength value <= 524288.) "Byte part exceeds 512 KiB"
        captureView value

    let base64 value =
        let encoded = text value
        require (encoded.Length <= 699052) "Encoded byte part exceeds its limit"
        let decoded = bytes encoded
        require (decoded.Length <= 524288 && encodeBytes (box decoded) = encoded) "Noncanonical base64"
        encoded

    let contentBytes value =
        let raw = copyBytes value
        let text = try box (decodeText raw) with _ -> null
        make [ "bytes", box raw; "text", text ]

    let content encoded = contentBytes (bytes encoded)

    let canonical (value: obj) =
        let rec encode (value: obj) =
            if isNull value then "null"
            elif isArray value then "[" + (array value |> Array.map encode |> String.concat ",") + "]"
            elif isObject value then
                let names = keys value |> Array.map text |> Array.sort
                "{" + (names |> Array.map (fun key -> stringify (box key) + ":" + encode (field value key)) |> String.concat ",") + "}"
            else stringify value
        encode value
