module Wanxiangli.Events.CanonicalEventCodec

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Events
open Wanxiangli.Events.CanonicalJson

// DSL-MUTABLE: algorithm-scratch — byte-level helpers; all pure, no I/O
[<Emit("Buffer.from($0).toString('base64')")>]
let private base64OfBytes (bytes: byte[]) : string = jsNative

[<Emit("Buffer.from($0, 'base64')")>]
let private bytesOfBase64 (value: string) : byte[] = jsNative

[<Import("createHash", "node:crypto")>]
let private createHash (algorithm: string) : obj = jsNative

[<Emit("$0.update($1)")>]
let private hashUpdate (hash: obj) (data: byte[]) : obj = jsNative

[<Emit("$0.digest('hex')")>]
let private hashHex (hash: obj) : string = jsNative

[<Emit("new TextDecoder('utf-8', { fatal: true }).decode($0)")>]
let private decodeUtf8Fatal (bytes: byte[]) : string = jsNative

[<Emit("$0.length >= 3 && $0[0] === 0xef && $0[1] === 0xbb && $0[2] === 0xbf")>]
let private hasUtf8Bom (bytes: byte[]) : bool = jsNative

let private sha256Hex (data: byte[]) : string =
    hashHex (hashUpdate (createHash "sha256") data)

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

let private requireText (value: obj) (name: string) : string =
    if isString value then unbox<string> value
    else failwith ("event field " + name + " must be a string")

let private readStrings (value: obj) (name: string) : string list =
    if isNull value then []
    elif not (isArray value) then failwith ("event field " + name + " must be an array of strings")
    else
        let items = unbox<obj array> value
        if items |> Array.exists (fun item -> not (isString item)) then
            failwith ("event field " + name + " must be an array of strings")
        else items |> Array.map (fun item -> unbox<string> item) |> Array.toList

let private payloadsOfJs (value: obj) : Map<string, byte[]> =
    if isNull value then
        Map.empty
    else
        emitJsExpr value "Object.keys($0).map(function (key) { return [key, $0[key]]; })"
        |> unbox<(string * byte[]) array>
        |> Array.fold (fun acc (key, bytes) -> Map.add key bytes acc) Map.empty

let private envelopeOfJs (value: obj) : Envelope =
    { EventId = requireText value?id "id"
      StreamId = requireText value?stream "stream"
      EventType = requireText value?``type`` "type"
      Parents = readStrings value?parents "parents"
      Payload = value?payload
      PayloadRefs = readStrings value?payloadRefs "payloadRefs"
      Payloads = payloadsOfJs value?payloads }

let private envelopeToJs (envelope: Envelope) : obj =
    // payloads 始终投影为对象（含空集）：主仓 durable-events-001/012 的权威
    // 语义是解码视图恒有 payloads 字段，空集为 {}，不是 undefined。
    let payloads =
        [ "payloads"
          ==> (envelope.Payloads
               |> Map.toList
               |> List.map (fun (payloadRef, bytes) -> payloadRef, box bytes)
               |> createObj) ]

    createObj (
        [ "id", box envelope.EventId
          "stream", box envelope.StreamId
          "type", box envelope.EventType
          "parents", box (envelope.Parents |> Array.ofList)
          "payload", box envelope.Payload
          "payloadRefs", box (envelope.PayloadRefs |> Array.ofList) ]
        @ payloads)

let private envelopeObject (envelope: Envelope) : obj =
    let normalized = Envelopes.normalize envelope

    let payloads =
        if Map.isEmpty normalized.Payloads then
            []
        else
            [ "payloads"
              ==> (normalized.Payloads
                   |> Map.toList
                   |> List.map (fun (payloadRef, bytes) -> payloadRef, box (base64OfBytes bytes))
                   |> createObj) ]

    createObj (
        [ "event_id" ==> normalized.EventId
          "stream_id" ==> normalized.StreamId
          "event_type" ==> normalized.EventType
          "parents" ==> (normalized.Parents |> Array.ofList |> box)
          "payload" ==> normalized.Payload
          "payload_refs" ==> (normalized.PayloadRefs |> Array.ofList |> box) ]
        @ payloads)

let private encodeEnvelope (envelope: Envelope) : string =
    CanonicalJson.canonicalJson (envelopeObject envelope) + "\n"

[<Emit("""
(function (value) {
  function sortedUnique(values) {
    if (!Array.isArray(values)) return false;
    for (let i = 1; i < values.length; i += 1) {
      if (!(values[i - 1] < values[i])) return false;
    }
    return true;
  }

  const allowed = new Set(['event_id', 'event_type', 'parents', 'payload', 'payload_refs', 'payloads', 'stream_id']);
  const payloadKeys = Object.keys(value.payloads || {}).sort();
  const sortedPayloadKeys = payloadKeys.every((key, i) => i === 0 || payloadKeys[i - 1] < key);
  return Object.keys(value).every(key => allowed.has(key))
    && sortedUnique(value.parents)
    && sortedUnique(value.payload_refs)
    && sortedPayloadKeys;
})($0)
""")>]
let private hasCanonicalStructure (parsed: obj) : bool = jsNative

let private hasCanonicalJsonText (parsed: obj) (text: string) : bool =
    CanonicalJson.canonicalJson parsed + "\n" = text

let private payloadsOfParsed (parsed: obj) : Map<string, byte[]> =
    if isNull (box (parsed?payloads)) then Map.empty
    else
        emitJsExpr parsed "Object.keys($0.payloads || {}).map(function (key) { return [key, $0.payloads[key]]; })"
        |> unbox<(string * string) array>
        |> Array.fold (fun acc (key, base64) -> Map.add key (bytesOfBase64 base64) acc) Map.empty

let private payloadClosureError (envelope: Envelope) : obj option =
    // 闭包校验只约束内容地址形态（64 位十六进制 sha256）的 payload ref：
    // 这类 ref 的字节必须内联在 payloads 且 digest 吻合。非内容地址的
    // 外部引用名（如 journal 的 oid）由 eventstore/journal 外层承载，
    // 单事件 decode 不代为裁决（主仓 durable-events-003 权威语义）。
    let isContentAddress (payloadRef: string) =
        payloadRef.Length = 64 && payloadRef |> Seq.forall (fun c -> "0123456789abcdef".Contains c)

    envelope.PayloadRefs
    |> List.tryFind (fun payloadRef ->
        isContentAddress payloadRef
        && (match Map.tryFind payloadRef envelope.Payloads with
            | None -> true
            | Some content -> sha256Hex content <> payloadRef))
    |> Option.map (fun payloadRef ->
        if Map.containsKey payloadRef envelope.Payloads then
            createObj [ "code", box "NonCanonical"; "reason", box ("payload digest mismatch: " + payloadRef) ]
        else
            createObj [ "code", box "MissingPayload"; "payloadRef", box payloadRef ])

let private decodeParsed (text: string) (parsed: obj) : Result<Envelope, obj> =
    let hasShape: bool =
        emitJsExpr
            parsed
            "!!$0 && typeof $0 === 'object' && typeof $0.event_id === 'string' && typeof $0.stream_id === 'string' && typeof $0.event_type === 'string' && Array.isArray($0.parents) && Array.isArray($0.payload_refs)"

    if not hasShape then
        Error(createObj [ "code", box "MalformedEnvelope"; "reason", box "event JSON missing required fields" ])
    elif not (hasCanonicalStructure parsed && hasCanonicalJsonText parsed text) then
        Error(createObj [ "code", box "NonCanonical"; "reason", box "event bytes are not §5.0 canonical" ])
    else
        let envelope =
            { EventId = unbox<string> parsed?event_id
              StreamId = unbox<string> parsed?stream_id
              EventType = unbox<string> parsed?event_type
              Parents = unbox<string array> parsed?parents |> Array.toList
              Payload = parsed?payload
              PayloadRefs = unbox<string array> parsed?payload_refs |> Array.toList
              Payloads = payloadsOfParsed parsed }

        match payloadClosureError envelope with
        | Some error -> Error error
        | None -> Ok envelope

let private tryDecodeEnvelope (text: string) : Result<Envelope, obj> =
    if isNull text then
        Error(createObj [ "code", box "MalformedEnvelope"; "reason", box "null event text" ])
    elif not (text.EndsWith("\n")) || text.EndsWith("\n\n") then
        Error(createObj [ "code", box "NonCanonical"; "reason", box "event bytes must end with exactly one LF" ])
    else
        try
            let body = text.Substring(0, text.Length - 1)
            decodeParsed text (JS.JSON.parse body)
        with ex ->
            Error(createObj [ "code", box "MalformedEnvelope"; "reason", box ex.Message ])

let private tryDecodeUtf8TextOf (bytes: byte[]) : Result<string, obj> =
    if hasUtf8Bom bytes then
        Error(createObj [ "code", box "NonCanonical"; "reason", box "event bytes must not contain a BOM" ])
    else
        try
            Ok(decodeUtf8Fatal bytes)
        with _ ->
            Error(createObj [ "code", box "NonCanonical"; "reason", box "event bytes are not valid UTF-8" ])

let private checkIdentityOf (left: Envelope) (right: Envelope) : Result<unit, obj> =
    if left.EventId <> right.EventId then Ok()
    elif encodeEnvelope left = encodeEnvelope right then Ok()
    else Error(createObj [ "code", box "IdentityCollision"; "eventId", box left.EventId ])

let private mergeEnvelopes (events: Envelope list) : Result<Envelope list, obj> =
    let step (acc: Map<string, Envelope * string>) (envelope: Envelope) =
        let normalized = Envelopes.normalize envelope
        let bytes = encodeEnvelope normalized
        match Map.tryFind normalized.EventId acc with
        | Some(_, existingBytes) when existingBytes = bytes -> Ok acc
        | Some _ -> Error(createObj [ "code", box "IdentityCollision"; "eventId", box normalized.EventId ])
        | None -> Ok(Map.add normalized.EventId (normalized, bytes) acc)

    events
    |> List.fold (fun state envelope -> state |> Result.bind (fun acc -> step acc envelope)) (Ok Map.empty)
    |> Result.map (fun acc -> acc |> Map.toList |> List.map (fun (_, (envelope, _)) -> envelope))

// DSL-MUTABLE: algorithm-scratch — three-color marks over parent edges; bounded by event count
let private hasCycle (merged: Envelope list) : bool =
    let edges = merged |> List.map (fun envelope -> envelope.EventId, envelope.Parents) |> Map.ofList
    let colors = Dictionary<string, int>()

    let rec visit (eventId: string) : bool =
        let found, color = colors.TryGetValue eventId
        if found && color = 1 then true
        elif found && color = 2 then false
        else
            colors.[eventId] <- 1
            let cyclic =
                match Map.tryFind eventId edges with
                | Some parents -> parents |> List.exists visit
                | None -> false
            colors.[eventId] <- 2
            cyclic

    merged |> List.exists (fun envelope -> visit envelope.EventId)

let private validateEnvelopes (events: Envelope list) (isKnownEventType: string -> bool) : Result<Envelope list * string list, obj> =
    match events |> List.tryFind (fun envelope -> not (isKnownEventType envelope.EventType)) with
    | Some envelope -> Error(createObj [ "code", box "UnknownEventType"; "eventType", box envelope.EventType ])
    | None ->
        match events |> List.tryPick payloadClosureError with
        | Some error -> Error error
        | None ->
            mergeEnvelopes events
            |> Result.bind (fun merged ->
                let retained = merged |> List.map (fun envelope -> envelope.EventId) |> Set.ofList
                let missing =
                    merged
                    |> List.tryPick (fun envelope ->
                        envelope.Parents
                        |> List.tryFind (fun parent -> not (Set.contains parent retained))
                        |> Option.map (fun parent -> (envelope, parent)))
                match missing with
                | Some(_, parent) -> Error(createObj [ "code", box "MissingParent"; "eventId", box parent ])
                | None ->
                    if hasCycle merged then Error(createObj [ "code", box "CyclicParents" ])
                    else
                        let parented = merged |> List.collect (fun envelope -> envelope.Parents) |> Set.ofList
                        let heads =
                            merged
                            |> List.map (fun envelope -> envelope.EventId)
                            |> List.filter (fun eventId -> not (Set.contains eventId parented))
                            |> List.sort
                        Ok(merged, heads))

let private succeeded (valueName: string) (value: obj) : obj =
    createObj [ "ok", box true; valueName, value ]

let private failed (error: obj) : obj =
    createObj [ "ok", box false; "error", error ]

/// Public codec for the versionless durable fact protocol (§5.0).
/// All operations are pure; no file, SQLite or Git access lives here.
/// D-04: this codec serves the single-writer SQLite CAS protocol; multi-writer
/// convergence (fork/adjudication) is a separate protocol and is not modeled here.
[<AttachMembers>]
type CanonicalEventCodec() =

    /// Canonical JSON text (no trailing LF) for any JSON value.
    member _.canonicalJson(value: obj) : string = CanonicalJson.canonicalJson value

    /// Encode one event as canonical JSON plus exactly one trailing LF (§5.0).
    member _.encode(event: obj) : string = encodeEnvelope (envelopeOfJs event)

    /// Decode canonical JSON+LF. Re-encoding must reproduce the same bytes.
    member _.tryDecode(text: string) : obj =
        match tryDecodeEnvelope text with
        | Ok envelope -> succeeded "event" (envelopeToJs envelope)
        | Error error -> failed error

    /// Strict UTF-8 text decode: rejects BOM and invalid sequences.
    member _.tryDecodeUtf8Text(bytes: byte[]) : obj =
        match tryDecodeUtf8TextOf bytes with
        | Ok text -> succeeded "text" (box text)
        | Error error -> failed error

    member _.tryDecodeUtf8(bytes: byte[]) : obj =
        match tryDecodeUtf8TextOf bytes |> Result.bind tryDecodeEnvelope with
        | Ok envelope -> succeeded "event" (envelopeToJs envelope)
        | Error error -> failed error

    /// Same EventId with different canonical bytes → IdentityCollision (§5.3).
    member _.checkIdentity(left: obj, right: obj) : obj =
        match checkIdentityOf (envelopeOfJs left) (envelopeOfJs right) with
        | Ok() -> createObj [ "ok", box true ]
        | Error error -> failed error

    /// Set-union by event id; identical duplicates collapse, collisions fail closed.
    member _.mergeByIdentity(events: obj array) : obj =
        match mergeEnvelopes (events |> Array.toList |> List.map envelopeOfJs) with
        | Ok merged -> succeeded "events" (box (merged |> List.map envelopeToJs |> Array.ofList))
        | Error error -> failed error

    /// Full pure validation: vocabulary (via explicit predicate), payload closure,
    /// identity dedupe, parent closure, acyclicity. Returns merged events and heads.
    member _.validate(events: obj array, isKnownEventType: string -> bool) : obj =
        match validateEnvelopes (events |> Array.toList |> List.map envelopeOfJs) isKnownEventType with
        | Ok(merged, heads) ->
            createObj
                [ "ok", box true
                  "events", box (merged |> List.map envelopeToJs |> Array.ofList)
                  "heads", box (heads |> Array.ofList) ]
        | Error error -> failed error
