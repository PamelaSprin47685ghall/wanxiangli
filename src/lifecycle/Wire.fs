namespace Wanxiangli.Lifecycle

open System
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =
    [<ImportAll("node:crypto")>]
    let private crypto: obj = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'number' && Number.isFinite($0)")>]
    let isNumber (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let private isBoolean (_value: obj): bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj): bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let private isObject (_value: obj): bool = jsNative

    [<Emit("Object.keys($0).sort()")>]
    let private keys (_value: obj): string array = jsNative

    [<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
    let has (_value: obj) (_key: string): bool = jsNative

    [<Emit("JSON.stringify($0)")>]
    let private stringify (_value: obj): string = jsNative

    [<Emit("JSON.parse($0)")>]
    let parse (_text: string): obj = jsNative

    [<Emit("Number.isSafeInteger($0) && $0 >= 0")>]
    let isCursor (_value: obj): bool = jsNative

    [<Emit("$0.isWellFormed() && !$0.includes('\\0')")>]
    let private validIdentifier (_value: string): bool = jsNative

    [<Emit("$0.createHash('sha256').update($1, 'utf8').digest('hex')")>]
    let private digest (_provider: obj) (_text: string): string = jsNative

    let fail message = invalidOp message
    let require condition message = if not condition then fail message
    let get (value: obj) (key: string): obj = value?(key)
    let sha256 text = digest crypto text

    let fields required optional (value: obj) =
        require (isObject value) "Expected a plain object"
        for key in required do
            require (has value key) ("Missing field: " + key)
        for key in keys value do
            require (List.contains key required || List.contains key optional) ("Unknown field: " + key)

    let text (value: obj) =
        require (isString value) "Expected text"
        let result: string = unbox value
        require (result.Length > 0) "Text must not be empty"
        result

    let identifier (value: obj) =
        let result = text value
        require (result.Length <= 1024) "Identifier is too long"
        require (validIdentifier result) "Identifier must be valid text without NUL"
        result

    let cursor (value: obj) =
        require (isCursor value) "Cursor must be a non-negative safe integer"
        unbox<float> value

    let strings (value: obj) =
        require (isArray value) "Expected an array"
        (unbox<obj array> value) |> Array.map text

    let updates (value: obj) =
        require (isArray value) "Expected an array"
        unbox<obj array> value
        |> Array.toList
        |> List.map (fun update ->
            fields [ "key"; "value" ] [] update
            let key = text (get update "key")
            let raw = get update "value"
            key, (if isNull raw then None else Some(text raw)))

    let optionalText (value: obj) key =
        if not (has value key) || isNull (get value key) then None
        else Some(text (get value key))

    let optionalCursor (value: obj) key =
        if not (has value key) || isNull (get value key) then None
        else Some(cursor (get value key))

    let canonical (value: obj) =
        let rec encode depth (item: obj) =
            require (depth <= 32) "JSON nesting is too deep"
            if isNull item then "null"
            elif isString item || isNumber item || isBoolean item then stringify item
            elif isArray item then
                let parts = unbox<obj array> item |> Array.map (encode (depth + 1))
                "[" + String.concat "," parts + "]"
            else
                require (isObject item) "Only JSON data is accepted"
                let parts = keys item |> Array.map (fun key -> stringify (box key) + ":" + encode (depth + 1) (get item key))
                "{" + String.concat "," parts + "}"
        encode 0 value

    let objectOf (pairs: (string * obj) list) = createObj pairs
    let nullable (value: string option): obj = value |> Option.map box |> Option.defaultValue null
    let encodeUpdates updates =
        updates
        |> List.map (fun (key, value) -> objectOf [ "key", box key; "value", nullable value ])
        |> List.toArray
    let nullableCursor (value: float option): obj = value |> Option.map box |> Option.defaultValue null
    let identity tag (parts: string list) = sha256 (canonical (box (tag :: parts |> List.toArray)))
