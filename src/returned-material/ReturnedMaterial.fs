module Wanxiangli.ReturnedMaterial

open Fable.Core

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("typeof $0")>]
let private valueType (_value: obj) : string = jsNative

[<Emit("$0 === null")>]
let private isExplicitNull (_value: obj) : bool = jsNative

[<Emit("({ body: $0, carry: $1 })")>]
let private createContainer (_body: string array) (_carry: string array) : obj = jsNative

[<Emit("$0[$1]")>]
let private getProperty (_target: obj) (_name: string) : obj = jsNative

let private stringArrayOf label (input: obj) : string array =
    if not (isArray input) then
        invalidArg "encoded" (sprintf "returned material %s must be a JSON string array" label)

    let items: obj array = unbox input
    if items |> Array.exists (fun item -> valueType item <> "string") then
        invalidArg "encoded" (sprintf "returned material %s must contain only strings" label)

    items |> Array.map unbox<string>

/// body 在前、carry 在后；原块与顺序直接保存，不加工原文。
let encode (bodyParts: string array) (carryParts: string array) : string =
    JS.JSON.stringify (createContainer (Array.copy bodyParts) (Array.copy carryParts))

let private decoded (encoded: string) : obj =
    let value: obj = JS.JSON.parse encoded
    if isExplicitNull value || valueType value <> "object" || isArray value then
        invalidArg "encoded" "returned material must be a JSON object"
    value

// 分部读取只检查该字段；显式 null 与缺字段 undefined 保留原来的不同结果。
let body (encoded: string) : string array =
    let value = getProperty (decoded encoded) "body"
    if isExplicitNull value then [||] else stringArrayOf "body" value

let carry (encoded: string) : string array =
    let value = getProperty (decoded encoded) "carry"
    if isExplicitNull value then [||] else stringArrayOf "carry" value

/// 严格校验完整编码字节；不以分部读取的宽松行为替代存储协议。
let validationError (encoded: string) : string =
    let isBodyArray (input: obj) =
        if isExplicitNull input then true
        elif not (isArray input) then false
        else
            let items: obj array = unbox input
            items |> Array.forall (fun item -> not (isExplicitNull item) && valueType item = "string")

    let isCarryArray (input: obj) =
        if isExplicitNull input || not (isArray input) then false
        else
            let items: obj array = unbox input
            items |> Array.forall (fun item -> not (isExplicitNull item) && valueType item = "string")

    let parsed =
        try Some(decoded encoded)
        with _ -> None

    let canonicalValue value =
        if not (isBodyArray (getProperty value "body")) then None
        elif isCarryArray (getProperty value "carry") then Some(encode (body encoded) (carry encoded))
        else None

    match parsed |> Option.bind canonicalValue with
    | Some canonical when canonical = encoded -> null
    | Some _ -> "returned material must use the canonical JSON object encoding"
    | None -> "returned material must be a canonical { body: string[], carry: string[] } JSON object"

let entries (encoded: string) : obj array =
    carry encoded |> Array.map (fun text -> box {| text = text |})

let fullText (encoded: string) : string =
    Array.append (body encoded) (carry encoded) |> String.concat "\n\n"
