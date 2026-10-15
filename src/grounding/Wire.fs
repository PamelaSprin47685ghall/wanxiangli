module Wanxiangli.Grounding.Wire

open Fable.Core
open Fable.Core.JsInterop

[<ImportAll("node:crypto")>]
let private crypto: obj = jsNative

[<Emit("$0.createHash('sha256').update($1, 'utf8').digest('hex')")>]
let private digest (_provider: obj) (_text: string): string = jsNative

/// 与主仓 HostDigest 同一公式的 SHA-256 小写十六进制摘要。
let sha256Hex (text: string) : string = digest crypto text

[<Import("Filesystem", "wanxiangli/fs")>]
let private filesystemFactory: obj = jsNative

[<Emit("$0({ root: '' })")>]
let private createFilesystem (_factory: obj): obj = jsNative

let private api = createFilesystem filesystemFactory

/// 与主仓 GlobMatch 同一 wildmatch 内核（wanxiangli/fs，CUT-24）。
/// 非法 pattern 视为配置错误，直接抛错，不静默返回 false。
let matchesPathPattern (pattern: string) (path: string) : bool =
    let result = api?matchesPathPattern(pattern, path)
    if not (unbox<bool> (result?ok)) then
        failwith ("invalid APPLIES-TO pattern: " + pattern)
    else
        unbox<bool> (result?value)
