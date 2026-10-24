namespace Wanxiangli.Fs

open Fable.Core
open Fable.Core.JsInterop

/// 公开模块：FsFailure 与结果构造器被同命名空间各公开模块的签名引用，
/// internal 会被 F# 可访问性规则拒绝。JS 交付面不变（仅导出 Filesystem）。
module Native =

    [<Import("readFileSync", "node:fs")>]
    let readFileBuffer (_path: string) : obj = jsNative

    [<Import("writeFileSync", "node:fs")>]
    let writeFileSync (_path: string) (_data: string) : unit = jsNative

    [<Import("writeFileSync", "node:fs")>]
    let writeFileWithOptions (_path: string) (_data: string) (_options: obj) : unit = jsNative

    [<Import("existsSync", "node:fs")>]
    let existsSync (_path: string) : bool = jsNative

    [<Import("unlinkSync", "node:fs")>]
    let unlinkSync (_path: string) : unit = jsNative

    [<Import("readdirSync", "node:fs")>]
    let readdirSync (_path: string) : string array = jsNative

    [<Import("lstatSync", "node:fs")>]
    let lstatSync (_path: string) : obj = jsNative

    [<Import("realpathSync", "node:fs")>]
    let realpathSync (_path: string) : string = jsNative

    [<Import("join", "node:path")>]
    let pathJoin (_a: string) (_b: string) : string = jsNative

    [<Import("dirname", "node:path")>]
    let pathDirname (_path: string) : string = jsNative

    [<Import("resolve", "node:path")>]
    let pathResolve (_path: string) : string = jsNative

    [<Import("isAbsolute", "node:path")>]
    let pathIsAbsolute (_path: string) : bool = jsNative

    [<Emit("$0.isDirectory()")>]
    let isDirectory (_stat: obj) : bool = jsNative

    [<Emit("$0.isSymbolicLink()")>]
    let isSymbolicLink (_stat: obj) : bool = jsNative

    [<Emit("$0.isFile()")>]
    let isFile (_stat: obj) : bool = jsNative

    [<Emit("new TextDecoder('utf-8', { fatal: true }).decode($0)")>]
    let decodeUtf8 (_buffer: obj) : string = jsNative

    [<Emit("new RegExp($0)")>]
    let regexExact (_source: string) : obj = jsNative

    [<Emit("new RegExp($0, 'g')")>]
    let regexGlobal (_source: string) : obj = jsNative

    [<Emit("$0.test($1)")>]
    let regexTest (_re: obj) (_text: string) : bool = jsNative

    [<Emit("new Promise((resolve) => setImmediate(resolve))")>]
    let yieldEventLoop () : System.Threading.Tasks.Task<unit> = jsNative

    [<Emit("Object.fromEntries($0)")>]
    let dictionary (_entries: (string * obj) array) : obj = jsNative

    /// 稳定失败：{ code, reason }。code 与主仓 JsFailure.code 同码表。
    type FsFailure = { Code: string; Reason: string }

    let failure code reason : FsFailure = { Code = code; Reason = reason }

    let objectOf (fields: (string * obj) array) : obj = dictionary fields

    let okResult (value: obj) : obj =
        objectOf [| "ok", box true; "value", value |]

    let okUnit: obj = objectOf [| "ok", box true |]

    let failureResult (error: FsFailure) : obj =
        objectOf [| "ok", box false; "code", box error.Code; "reason", box error.Reason |]
