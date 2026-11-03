module internal Wanxiangli.WorkspacePathCache

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 != null && typeof $0.then === 'function'")>]
let private isThenable (_value: obj) : bool = jsNative

[<Emit("$0.then(null, $1)")>]
let private catchThenable (_promise: obj) (_handler: obj -> unit) : unit = jsNative

[<AttachMembers>]
type RuntimePathStore() =
    let gate = obj ()
    let roots = Dictionary<string, obj>()

    let normalizeKey (workspace: string) : string =
        if isNull (box workspace) || not (isString (box workspace)) || workspace.Length = 0 then
            if isNull (box workspace) then "" else workspace
        else
            let trimmed = workspace.TrimEnd([| '/'; '\\' |])
            if trimmed.Length = 0 then
                string workspace[0]
            elif trimmed.Length = 2 && Char.IsLetter trimmed[0] && trimmed[1] = ':' && workspace.Length > 2 then
                trimmed + string workspace[2]
            else
                trimmed

    let invalidate (key: string) (expected: obj) : unit =
        lock gate (fun () ->
            match roots.TryGetValue key with
            | true, current when obj.ReferenceEquals(current, expected) -> roots.Remove key |> ignore
            | _ -> ())

    member _.getOrCompute(workspace: string, compute: string -> obj) : obj =
        let key = normalizeKey workspace
        let item =
            lock gate (fun () ->
                match roots.TryGetValue key with
                | true, v -> v
                | false, _ ->
                    let v = compute key
                    roots[key] <- v
                    v)
        if isThenable item then
            catchThenable item (fun _ex ->
                invalidate key item)
        item
