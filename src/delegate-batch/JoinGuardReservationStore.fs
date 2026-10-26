module Wanxiangli.DelegateBatch.JoinGuardReservationStore

open System
open System.Collections.Generic
open System.Runtime.InteropServices
open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("$0 === null || $0 === undefined")>]
let private isAbsent (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'function'")>]
let private isFunction (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object'")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

let private isNullOrAbsent (o: obj) : bool =
    isNull o || isAbsent o

let private formatNudgeKey (sessionId: string) (terminalProviderRun: string) : string =
    let sid = if isNull sessionId then "" else sessionId.Trim()
    let run = if isNull terminalProviderRun then "" else terminalProviderRun.Trim()
    "join-guard:" + sid + ":" + run

let private evaluateHasOutstandingClaim (claim: obj) : bool =
    if isNullOrAbsent claim then
        false
    elif isFunction claim then
        let fn = unbox<unit -> obj> claim
        let res = fn ()
        if isBool res then unbox<bool> res else false
    elif isBool claim then
        unbox<bool> claim
    else
        false

let private removeByPrefix (targetSet: HashSet<string>) (prefix: string) : unit =
    if not (isNull targetSet) then
        let matching =
            targetSet
            |> Seq.filter (fun key -> key.StartsWith(prefix, StringComparison.Ordinal))
            |> Seq.toArray
        for key in matching do
            targetSet.Remove key |> ignore

let private scopeContains (scope: obj) (key: string) : bool =
    if isNullOrAbsent scope then
        false
    elif isObject scope && isFunction (field scope "contains") then
        unbox<bool> (scope?contains(key))
    elif isObject scope && isFunction (field scope "Contains") then
        unbox<bool> (scope?Contains(key))
    elif isObject scope && isFunction (field scope "has") then
        unbox<bool> (scope?has(key))
    else
        false

let private scopeAdd (scope: obj) (key: string) : unit =
    if isNullOrAbsent scope then
        ()
    elif isObject scope && isFunction (field scope "add") then
        scope?add(key) |> ignore
    elif isObject scope && isFunction (field scope "Add") then
        scope?Add(key) |> ignore
    else
        ()

let private scopeRemove (scope: obj) (key: string) : unit =
    if isNullOrAbsent scope then
        ()
    elif isObject scope && isFunction (field scope "remove") then
        scope?remove(key) |> ignore
    elif isObject scope && isFunction (field scope "Remove") then
        scope?Remove(key) |> ignore
    elif isObject scope && isFunction (field scope "delete") then
        let delFn: obj = field scope "delete"
        delFn?call(scope, key) |> ignore
    else
        ()

let private scopeClear (scope: obj) : unit =
    if isNullOrAbsent scope then
        ()
    elif isObject scope && isFunction (field scope "clear") then
        scope?clear() |> ignore
    elif isObject scope && isFunction (field scope "Clear") then
        scope?Clear() |> ignore
    else
        ()

/// Scoped set wrapper for instance-level reservations.
[<AttachMembers>]
type JoinGuardScope() =
    let keySet = HashSet<string>()
    member _.keys = keySet
    member _.contains(key: string) = keySet.Contains key
    member _.add(key: string) = keySet.Add key
    member _.remove(key: string) = keySet.Remove key
    member _.clear() = keySet.Clear()
    member _.snapshot() = Seq.toArray keySet
    member _.count = keySet.Count

/// Single-flight reservation store for JoinGuard reminders across process.
[<AttachMembers>]
type JoinGuardReservationStore() =
    let gate = obj ()
    let processKeys = HashSet<string>()
    let scopes = ResizeArray<HashSet<string>>()

    member _.nudgeKey(sessionId: string, terminalProviderRun: string) : string =
        formatNudgeKey sessionId terminalProviderRun

    member _.formatKey(sessionId: string, terminalProviderRun: string) : string =
        formatNudgeKey sessionId terminalProviderRun

    member _.createScope() : HashSet<string> =
        lock gate (fun () ->
            let scope = HashSet<string>()
            scopes.Add scope
            scope)

    member _.tryReserve
        (
            scope: obj,
            sessionId: string,
            terminalProviderRun: string,
            [<Optional; DefaultParameterValue(null: obj)>] hasOutstandingJoinClaim: obj
        ) : string option =
        let key = formatNudgeKey sessionId terminalProviderRun
        lock gate (fun () ->
            if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace terminalProviderRun then
                None
            elif evaluateHasOutstandingClaim hasOutstandingJoinClaim then
                None
            elif processKeys.Contains key then
                None
            elif scopeContains scope key then
                None
            else
                processKeys.Add key |> ignore
                scopeAdd scope key
                Some key)

    member _.release(scope: obj, key: string) : unit =
        lock gate (fun () ->
            processKeys.Remove key |> ignore
            scopeRemove scope key
            for s in scopes do
                if not (isNull s) && not (obj.ReferenceEquals(s, scope)) then
                    s.Remove key |> ignore)

    member _.clearSession
        (
            sessionId: string,
            [<Optional; DefaultParameterValue(null: obj)>] scope: obj
        ) : unit =
        let prefix = "join-guard:" + (if isNull sessionId then "" else sessionId.Trim()) + ":"
        lock gate (fun () ->
            removeByPrefix processKeys prefix
            if not (isNullOrAbsent scope) then
                match scope with
                | :? HashSet<string> as set ->
                    removeByPrefix set prefix
                | _ ->
                    if isObject scope && isFunction (field scope "snapshot") then
                        let items: string array = unbox (scope?snapshot())
                        for item in items do
                            if not (isNull item) && item.StartsWith(prefix, StringComparison.Ordinal) then
                                scopeRemove scope item
                    elif isObject scope && isFunction (field scope "forEach") && isFunction (field scope "delete") then
                        let toDelete = ResizeArray<string>()
                        scope?forEach(fun (item: obj) ->
                            if not (isNullOrAbsent item) then
                                let s = string item
                                if s.StartsWith(prefix, StringComparison.Ordinal) then
                                    toDelete.Add s)
                        for item in toDelete do
                            scopeRemove scope item
            for s in scopes do
                if not (isNull s) && not (obj.ReferenceEquals(s, scope)) then
                    removeByPrefix s prefix)

    member _.clear([<Optional; DefaultParameterValue(null: obj)>] scope: obj) : unit =
        lock gate (fun () ->
            processKeys.Clear()
            scopeClear scope
            for s in scopes do
                if not (isNull s) then s.Clear())

    member this.clearAll() : unit =
        this.clear(null)

    member _.processCount : int =
        lock gate (fun () -> processKeys.Count)

    member _.snapshot() : string array =
        lock gate (fun () -> Seq.toArray processKeys)

let joinGuardReservationStore = JoinGuardReservationStore()
