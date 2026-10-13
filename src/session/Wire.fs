namespace Wanxiangli.Ownership

open Fable.Core
open Fable.Core.JsInterop

module internal Wire =
    [<ImportAll("node:crypto")>]
    let private crypto: obj = jsNative

    [<Emit("$0.createHash('sha256').update($1, 'utf8').digest('hex')")>]
    let private hash (_provider: obj) (_text: string): string = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let private isString (_value: obj): bool = jsNative

    [<Emit("$0.isWellFormed() && !$0.includes('\\0')")>]
    let private validId (_value: string): bool = jsNative

    [<Emit("$0 != null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let private isObject (_value: obj): bool = jsNative

    [<Emit("Reflect.ownKeys($0)")>]
    let private keys (_value: obj): obj array = jsNative

    [<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
    let private descriptor (_value: obj) (_key: string): obj = jsNative

    [<Emit("Object.prototype.hasOwnProperty.call($0, 'value')")>]
    let private hasValue (_value: obj): bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let private isArray (_value: obj): bool = jsNative

    [<Emit("JSON.stringify($0)")>]
    let stringify (_value: obj): string = jsNative

    [<Emit("JSON.parse($0)")>]
    let parse (_value: string): obj = jsNative

    [<Emit("Buffer.byteLength($0, 'utf8')")>]
    let byteLength (_value: string): int = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= 0")>]
    let private isNumber (_value: obj): bool = jsNative

    let require condition message = if not condition then invalidOp message
    let sha256 text = hash crypto text
    let make (pairs: (string * obj) list): obj = createObj pairs

    let field value key =
        require (isObject value || isArray value) "Expected a data object"
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

    let reason value =
        let value = text value
        require (value.Length > 0 && value.Length <= 4096) "Reason must contain 1 to 4096 characters"
        value

    let number value =
        require (isNumber value) "Expected a non-negative safe integer"
        unbox<float> value

    let array value =
        require (isArray value) "Expected an array of records, not a service"
        let length: int = value?length
        Array.init length (fun position -> field value (string position))

    let canonical value =
        let rec encode depth value =
            require (depth <= 12) "Record nesting is too deep"
            if isNull value then "null"
            elif isArray value then
                "[" + (array value |> Array.map (encode (depth + 1)) |> String.concat ",") + "]"
            elif isObject value then
                let names = keys value |> Array.map text |> Array.sort
                "{" + (names |> Array.map (fun key -> stringify (box key) + ":" + encode (depth + 1) (field value key)) |> String.concat ",") + "}"
            else stringify value
        encode 0 value

    let tupleKey (values: string list) = values |> List.toArray |> box |> stringify
