namespace Wanxiangli.Prefix

open Fable.Core
open Fable.Core.JsInterop

/// JS 边界的 plain-data 读取合同。解码失败一律抛 TypeError，不猜测回退。
module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isNullOrUndefined (_value: obj) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("Number.isSafeInteger($0)")>]
    let isSafeInteger (_value: obj) : bool = jsNative

    [<Emit("(() => { throw new TypeError($0) })()")>]
    let fail (_message: string) : 'a = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    let get (value: obj) (key: string) : obj = value?(key)

    let text (value: obj) (key: string) : string =
        let raw = if isObject value then get value key else null

        if isString raw && (unbox<string> raw).Length > 0 then
            unbox<string> raw
        else
            fail $"prefix: field '%s{key}' must be a non-empty string"

    let optionalText (value: obj) (key: string) : string option =
        let raw = if isObject value then get value key else null

        if isNullOrUndefined raw then None
        elif isString raw then Some(unbox<string> raw)
        else fail $"prefix: field '%s{key}' must be a string or null"

    /// 现行世代：非负安全整数。
    let epoch (value: obj) (key: string) : float =
        let raw = if isObject value then get value key else null

        if isSafeInteger raw && unbox<float> raw >= 0.0 then
            unbox<float> raw
        else
            fail $"prefix: field '%s{key}' must be a non-negative integer epoch"

    /// 推进行上的世代号：任意安全整数。越界或负值是行的内容，由 commit 判定，不在解码时拒绝。
    let lineEpoch (value: obj) (key: string) : float =
        let raw = if isObject value then get value key else null

        if isSafeInteger raw then
            unbox<float> raw
        else
            fail $"prefix: field '%s{key}' must be an integer epoch"

    let strings (value: obj) (key: string) : string list =
        let raw = if isObject value then get value key else null

        if not (isArray raw) then
            fail $"prefix: field '%s{key}' must be an array of strings"
        else
            unbox<obj array> raw
            |> Array.toList
            |> List.map (fun item ->
                if isString item then
                    unbox<string> item
                else
                    fail $"prefix: field '%s{key}' must contain only strings")

    let stringArray (items: string seq) : obj = freeze (box (Seq.toArray items))
