module Wanxiangli.Trace.TraceCapture

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type CaptureHistory =
    abstract head: unit -> int64
    abstract headSequence: unit -> int64
    abstract entries: unit -> obj array
    abstract opening: unit -> obj
    abstract terminals: unit -> obj array
    abstract terminalFor: string -> obj

[<AllowNullLiteral>]
type private Serial =
    abstract run<'T>: string * Func<Task<'T>> -> Task<'T>

[<Import("KeyedSerial", "wanxiangli/keyed-serial")>]
let private serialClass: obj = jsNative

let private field (value: obj) (key: string) : obj = value?(key)
let private text value key : string = field value key |> unbox
let private success () = createObj [ "ok" ==> true; "value" ==> (null: obj) ]

[<AllowNullLiteral>]
type CaptureStore =
    abstract read: unit -> obj
    abstract writeBody: string -> Task<obj>
    abstract append: obj -> Task<unit>

let private history (snapshot: obj) : CaptureHistory = field snapshot "history" |> unbox
let private entries (snapshot: obj) : obj array = field snapshot "identities" |> unbox

let private delta (before: CaptureHistory) (after: CaptureHistory) =
    createObj
        [ "previousHead" ==> before.head()
          "currentHead" ==> after.head()
          "capturedPartCount" ==> (after.entries().Length - before.entries().Length)
          "openingCaptured" ==> (isNull (before.opening()) && not (isNull (after.opening())))
          "terminalCaptured" ==> (after.terminals().Length > before.terminals().Length) ]

let private partFact sequence part reference digest =
    createObj
        [ "kind" ==> "part"
          "sequence" ==> sequence
          "part" ==> part
          "bodyRef" ==> reference
          "bodyDigest" ==> digest ]

let private appendBody (store: CaptureStore) sequence (part: obj) =
    task {
        let! written = store.writeBody (text part "body")
        if not (unbox<bool> (field written "ok")) then return written
        else
            let body = field written "value"
            do! store.append (partFact sequence part (text body "reference") (text body "digest"))
            return success ()
    }

[<AttachMembers>]
type TraceCapture() =
    let serial = createNew serialClass () |> unbox<Serial>

    member _.run<'T>(key: string, action: Func<Task<'T>>) = serial.run(key, action)
    member _.receipt(before: CaptureHistory, after: CaptureHistory) = delta before after

    member _.captureOpening(store: CaptureStore, assignment: string, requirements: string array) : Task<unit> =
        task {
            let existing = store.read() |> history
            if isNull (existing.opening()) && not (String.IsNullOrWhiteSpace assignment) then
                do! store.append (createObj [ "kind" ==> "opening"; "assignment" ==> assignment; "requirements" ==> requirements ])
        }

    member _.captureTerminalText(store: CaptureStore, providerRun: string, body: string, digest: string) : Task<obj> =
        task {
            if String.IsNullOrWhiteSpace body then
                return success ()
            else
                let previous = store.read() |> history |> fun current -> current.terminalFor providerRun
                if not (isNull previous) && text previous "bodyDigest" = digest then return success ()
                else
                    let! written = store.writeBody body
                    if not (unbox<bool> (field written "ok")) then return written
                    else
                        let reference = field written "value"
                        do! store.append (createObj [ "kind" ==> "terminal"; "providerRun" ==> providerRun; "bodyRef" ==> text reference "reference"; "bodyDigest" ==> text reference "digest" ])
                        return success ()
        }

    member _.captureTerminalReference(store: CaptureStore, providerRun: string, reference: string, digest: string) : Task<unit> =
        task {
            let previous = store.read() |> history |> fun current -> current.terminalFor providerRun
            if isNull previous || text previous "bodyRef" <> reference || text previous "bodyDigest" <> digest then
                do! store.append (createObj [ "kind" ==> "terminal"; "providerRun" ==> providerRun; "bodyRef" ==> reference; "bodyDigest" ==> digest ])
        }

    member _.captureParts(store: CaptureStore, parts: obj array, mode: string) : Task<obj> =
        task {
            let snapshot = store.read()
            let current = history snapshot
            let recorded = entries snapshot
            let keys = HashSet<string>(recorded |> Array.map (fun entry -> text entry "key"))
            let secondary = HashSet<string>()
            let compatible = Dictionary<string, HashSet<string>>()
            for entry in recorded do
                let other = field entry "secondaryKey"
                if not (isNull other) then secondary.Add(unbox<string> other) |> ignore
                let key = text entry "key"
                let values =
                    match compatible.TryGetValue key with
                    | true, value -> value
                    | _ ->
                        let value = HashSet<string>()
                        compatible.Add(key, value)
                        value
                values.Add(text entry "compatibility") |> ignore

            let alreadyCaptured (part: obj) =
                if mode = "positional" then keys.Contains(text part "key")
                else
                    let exact = unbox<bool> (field part "exactKey") && keys.Contains(text part "key")
                    let other = field part "secondaryKey"
                    let physical = not (isNull other) && secondary.Contains(unbox<string> other)
                    let old = field part "legacyKey"
                    let legacy =
                        if isNull old then false
                        else
                            match compatible.TryGetValue(unbox<string> old) with
                            | true, values -> values.Contains(text part "compatibility")
                            | _ -> false
                    exact || physical || legacy

            let mutable cursor = current.headSequence()
            let mutable result = success ()
            let mutable index = 0
            while index < parts.Length && unbox<bool> (field result "ok") do
                let part = parts[index]
                if not (alreadyCaptured part) then
                    cursor <- cursor + 1L
                    let! written = appendBody store cursor part
                    result <- written
                index <- index + 1
            return result
        }

    member _.captureReference(store: CaptureStore, part: obj, reference: string, digest: string) : Task<unit> =
        task {
            let snapshot = store.read()
            let captured = entries snapshot |> Array.exists (fun item -> text item "key" = text part "key")
            if not captured then
                do! store.append (partFact ((history snapshot).headSequence() + 1L) part reference digest)
        }
