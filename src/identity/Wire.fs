namespace Wanxiangli.Identity

open System
open Fable.Core
open Fable.Core.JsInterop

/// JS 边界的 plain-object 读取合同。所有解码走这里，不做任何猜测回退。
module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj): bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isNullOrUndefined (_value: obj): bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let isPlainObject (_value: obj): bool = jsNative

    [<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
    let has (_value: obj) (_key: string): bool = jsNative

    let get (value: obj) (key: string): obj = value?(key)

    /// 读取字符串字段：缺失、非字符串、空串一律 None。
    let string (value: obj) (key: string): string option =
        if isPlainObject value && has value key then
            match get value key with
            | raw when isString raw ->
                let text = unbox<string> raw
                if String.IsNullOrWhiteSpace text then None else Some text
            | _ -> None
        else
            None

    /// 读取整数字段：缺失或非有限数一律 None。
    [<Emit("$0 !== null && $0 !== undefined && typeof $0 === 'number' && Number.isFinite($0) && Number.isInteger($0)")>]
    let private isIntegerNumber (_value: obj): bool = jsNative

    let int (value: obj) (key: string): int option =
        if isPlainObject value && has value key then
            match get value key with
            | raw when isIntegerNumber raw -> Some(unbox<int> raw)
            | _ -> None
        else
            None

    /// Option → JS null（供门面投影）。
    let toNull (value: string option): obj =
        match value with
        | Some text -> box text
        | None -> null
