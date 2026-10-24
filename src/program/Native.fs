module internal Wanxiangli.Program.Native

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<Import("Runtime", "wanxiangli/runtime")>]
let createRuntime: unit -> obj = jsNative

[<Emit("$0 == null")>]
let missing (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'string'")>]
let isText (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'function'")>]
let isFunction (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let isArray (_value: obj) : bool = jsNative

[<Emit("Number.isFinite($0)")>]
let finite (_value: obj) : bool = jsNative

[<Emit("Object.keys($0)")>]
let keys (_value: obj) : string array = jsNative

[<Emit("$0[$1]")>]
let get (_value: obj) (_name: string) : obj = jsNative

[<Emit("$1.split('.').reduce((owner, name) => owner == null ? undefined : owner[name], $0)")>]
let getMember (_value: obj) (_name: string) : obj = jsNative

[<Emit("(function visit(value, prefix) { return Object.keys(value || {}).flatMap(key => { const name = prefix ? prefix + '.' + key : key; return typeof value[key] === 'function' ? [name] : value[key] && typeof value[key] === 'object' ? visit(value[key], name) : []; }); })($0, '')")>]
let memberNames (_value: obj) : string array = jsNative

[<Emit("Reflect.apply($0, undefined, $1)")>]
let invoke (_callback: obj) (_args: obj array) : obj = jsNative

[<Emit("Promise.resolve($0)")>]
let promise (_value: obj) : Task<obj> = jsNative

[<Emit("Promise.all($0)")>]
let all (_values: Task<obj> array) : Task<obj array> = jsNative

[<Emit("JSON.parse(JSON.stringify($0))")>]
let copy (_value: obj) : obj = jsNative

[<Emit("new TextEncoder().encode($0).byteLength")>]
let utf8Length (_value: string) : float = jsNative

[<Emit("Object.assign({}, $0, $1)")>]
let merge (_left: obj) (_right: obj) : obj = jsNative

[<Emit("$0.then($1, $2)")>]
let listen (_pending: obj) (_completed: obj -> unit) (_failed: obj -> unit) : unit = jsNative

let text (value: obj) =
    if isText value then unbox<string> value else ""

let field value name = text (get value name)

let number value fallback =
    if missing value || not (finite value) then
        fallback
    else
        unbox<float> value

let array (value: obj) : obj array =
    if isArray value then unbox value else [||]

let strings (value: obj) =
    array value |> Array.filter isText |> Array.map text

let failure code reason : obj =
    createObj [ "ok" ==> false; "code" ==> code; "reason" ==> reason ]

let exceptionData (error: obj) =
    let code = field error "code"
    let reason = field error "reason"
    let message = field error "message"

    failure
        (if code = "" then "PROGRAM_FAILED" else code)
        (if reason <> "" then reason
         elif message <> "" then message
         else "operation failed")

let success (value: obj) =
    createObj [ "ok" ==> true; "value" ==> value ]

let validName value =
    isText value
    && not (String.IsNullOrWhiteSpace(text value))
    && not ((text value) |> Seq.exists Char.IsControl)

let budget (value: obj) =
    if not (isText value) || (text value).Length = 0 then
        None
    else
        Some(utf8Length (text value) * 50.0)

let complete (source: TaskCompletionSource<obj>) (value: obj) = source.SetResult value

let now (runtime: obj) : float = runtime?now ()

let schedule (runtime: obj) (milliseconds: float) (callback: unit -> unit) : obj =
    runtime?schedule (milliseconds, callback)

let cancel (timer: obj) =
    if not (missing timer) then
        (timer?cancel (): unit)

let terminal state =
    state = "completed" || state = "failed" || state = "abandoned"

let receipt name state fields =
    merge (createObj [ "name" ==> name; "state" ==> state ]) fields
