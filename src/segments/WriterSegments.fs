module Wanxiangli.Segments.WriterSegments

open Fable.Core
open Fable.Core.JsInterop

// 单行规范字节只有一个 owner：wanxiangli/events。本模块只管一条 writer 流的成帧（完整行、无空内行）
// 与旧式/段系列共存的字节裁决，逐行解码交给它，不复制编码规则。
[<Import("CanonicalEventCodec", "wanxiangli/events")>]
let private codecClass: obj = jsNative

[<Emit("new $0()")>]
let private construct (cls: obj) : obj = jsNative

let private codec: obj = construct codecClass

[<Emit("$0 instanceof Uint8Array")>]
let private isBytes (value: obj) : bool = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("Number.isInteger($0)")>]
let private isInteger (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isPlainObject (value: obj) : bool = jsNative

/// 码元序（与 Array.prototype.sort 的默认序一致），不随区域设置变化。
[<Emit("[...$0].sort()")>]
let private sortedCopy (names: string array) : string array = jsNative

let private suffix = ".ndjson"
let private maxOrdinal = 9999

/// 段序号只认 ASCII 0-9：文件名由 `%04d` 写出，其它 Unicode 数字不是段号。
let private isAsciiDigit (c: char) = c >= '0' && c <= '9'

let private allAsciiDigits (text: string) =
    text.Length > 0 && (text |> Seq.forall isAsciiDigit)

/// stem 以 `-dddd` 结尾（恰好四位 ASCII 数字）时给出 (writer, 序号)，writer 不得为空。
let private parseStem (stem: string) : (string * int) option =
    if stem.Length < 6 then None
    else
        let split = stem.Length - 5
        let digits = stem.Substring(split + 1)
        if stem[split] = '-' && allAsciiDigits digits then
            Some(stem.Substring(0, split), int digits)
        else None

let private stemOf (name: string) =
    if name.EndsWith(suffix, System.StringComparison.Ordinal) then
        Some(name.Substring(0, name.Length - suffix.Length))
    else None

let private parseName (name: string) : (string * int) option =
    stemOf name |> Option.bind parseStem

/// writerId 的毛病；None 表示可用。
let private writerIdFaultOf (writerId: string) : string option =
    if writerId.Trim().Length = 0 then Some "required"
    elif writerId.IndexOfAny([| '/'; '\\' |]) >= 0 || writerId = "." || writerId = ".." then Some "pathSegment"
    elif (parseStem writerId).IsSome then Some "segmentSuffix"
    else None

/// 名字里的 writer 部分：非空、单个路径段。创建新 writer 的额外约束（不得以 `-dddd` 结尾）见 writerIdFault；
/// 旧目录里降级为完整 stem 的 writer（如断续段 `b-0002`）仍须能被整理成自己的段系列。
let private requireStem (writerId: obj) : string =
    if not (isString writerId) then raise (System.ArgumentException "writerId must be a string")
    let text = unbox<string> writerId
    if text.Length = 0 then raise (System.ArgumentException "writerId is not usable: required")
    elif text.IndexOfAny([| '/'; '\\' |]) >= 0 then raise (System.ArgumentException "writerId is not usable: pathSegment")
    else text

let private requireNames (names: obj) : string array =
    if not (isArray names) then raise (System.ArgumentException "names must be an array")
    let items = unbox<obj array> names
    items
    |> Array.map (fun item ->
        if isString item then unbox<string> item
        else raise (System.ArgumentException "each name must be a string"))

let private nonCanonical (reason: string) : obj =
    createObj [ "code", box "NonCanonical"; "reason", box reason ]

/// 一条 writer 流的文本成帧（durable-events-005/014）：空文本是空流；非空必须以 LF 结尾（否则是半行）；
/// 内行不得为空；每行交 events 做规范解码，第一处失败即止。label 只进错误消息。
let private decodeStreamText (label: string) (text: string) : Result<obj array, obj> =
    if text.Length = 0 then Ok [||]
    elif not (text.EndsWith("\n", System.StringComparison.Ordinal)) then
        Error(nonCanonical ("writer file has incomplete trailing line: " + label))
    else
        let lines = text.Split('\n')
        let events = ResizeArray<obj>(lines.Length - 1)
        // DSL-MUTABLE: algorithm-scratch — first failing line stops the decode.
        let mutable failure: obj option = None
        let mutable index = 0
        while index < lines.Length - 1 && failure.IsNone do
            let line = lines[index]
            if line.Length = 0 then
                failure <- Some(nonCanonical ("writer file contains empty interior line: " + label))
            else
                let outcome: obj = codec?tryDecode (line + "\n")
                let decoded: obj = outcome?event
                let error: obj = outcome?error
                let ok: obj = outcome?ok
                if unbox<bool> ok then events.Add decoded else failure <- Some error
            index <- index + 1
        match failure with
        | Some error -> Error error
        | None -> Ok(events.ToArray())

let private requireBytes (name: string) (value: obj) : byte[] =
    if isBytes value then unbox<byte[]> value
    else raise (System.ArgumentException(name + " must be a Uint8Array"))

let private isPrefixOf (prefix: byte[]) (full: byte[]) =
    if prefix.Length > full.Length then false
    else
        // DSL-MUTABLE: algorithm-scratch — early-exit prefix scan.
        let mutable same = true
        let mutable index = 0
        while same && index < prefix.Length do
            same <- prefix[index] = full[index]
            index <- index + 1
        same

/// 一种物理形态的 EventId 集合；字节不是完整规范 NDJSON（非 UTF-8、半行、非规范行、空内行）时 None。
let private eventIdsOf (bytes: byte[]) : Set<string> option =
    let text: obj = codec?tryDecodeUtf8Text bytes
    let ok: obj = text?ok
    let decodedText: obj = text?text
    if not (unbox<bool> ok) then None
    else
        match decodeStreamText "coexistence" (unbox<string> decodedText) with
        | Error _ -> None
        | Ok events -> Some(events |> Array.map (fun (event: obj) -> let id: obj = event?id in unbox<string> id) |> Set.ofArray)

/// 旧式文件与段系列共存的字节裁决（durable-events-005）：
/// 旧式是段系列（按序拼接）的字节前缀（含相等）→ 段系列为准；段系列是旧式的字节前缀 → 旧式为准；
/// 双方都是完整规范 NDJSON 且 EventId 不相交 → 行续接（段系列后接旧式行）；其余为分歧。
let private coexistenceOf (legacy: byte[]) (series: byte[]) : string =
    if isPrefixOf legacy series then "series"
    elif isPrefixOf series legacy then "legacy"
    else
        match eventIdsOf legacy, eventIdsOf series with
        | Some legacyIds, Some seriesIds when Set.isEmpty (Set.intersect legacyIds seriesIds) -> "continuation"
        | _ -> "diverged"

let private segmentName (writerId: string) (ordinal: int) =
    writerId + "-" + (string ordinal).PadLeft(4, '0') + suffix

/// 文件名 → writer 分组（durable-events-005/014）：一个 `-dddd` 名只有在同一前缀的序号从 0000 起连续时才并入
/// 该前缀的段系列；否则它就是以完整 stem 为 writer 的旧式单文件。旧式文件与它的段系列可同组共存。
let private group (names: string array) : (string * string array) array =
    let candidates =
        names |> Array.filter (fun name -> (stemOf name).IsSome) |> sortedCopy
    let parsed = candidates |> Array.choose (fun name -> parseName name |> Option.map (fun (w, o) -> w, o, name))
    let series =
        parsed
        |> Array.groupBy (fun (w, _, _) -> w)
        |> Array.filter (fun (_, entries) ->
            let ordinals = entries |> Array.map (fun (_, o, _) -> o) |> Set.ofArray
            let highest = Set.maxElement ordinals
            Set.count ordinals = highest + 1)
        |> Array.map fst
        |> Set.ofArray
    candidates
    |> Array.map (fun name ->
        match parseName name with
        | Some(w, _) when Set.contains w series -> w, name
        | _ -> (stemOf name).Value, name)
    |> Array.groupBy fst
    |> Array.map (fun (w, entries) -> w, entries |> Array.map snd |> sortedCopy)
    |> Array.sortWith (fun (a, _) (b, _) -> System.String.CompareOrdinal(a, b))

/// writer 段文件命名与分组律（durable-events-005/014）。只算名字，不读目录、不读写字节、不加锁。
[<AttachMembers>]
type WriterSegments() =
    /// 四位段号的上界。
    member _.maxOrdinal = maxOrdinal

    /// writerId 不可用的原因：`required`（空或全空白）、`pathSegment`（含分隔符或为 . / ..）、
    /// `segmentSuffix`（以 `-dddd` 结尾，会与段名混淆）；可用时为 null。
    member _.writerIdFault(writerId: obj) : obj =
        if not (isString writerId) then box "required"
        else
            match writerIdFaultOf (unbox<string> writerId) with
            | Some fault -> box fault
            | None -> null

    /// `<writerId>-dddd.ndjson`；序号必须是 0..9999 的整数，越界抛错而不是写出会被读成别的 writer 的名字。
    member _.segmentFileName(writerId: obj, ordinal: obj) : string =
        let writer = requireStem writerId
        if not (isInteger ordinal) then raise (System.ArgumentException "ordinal must be an integer")
        let value = unbox<int> ordinal
        if value < 0 || value > maxOrdinal then
            raise (System.ArgumentException "segment ordinal exhausted the four-digit space")
        segmentName writer value

    /// 旧式无后缀文件名 `<writerId>.ndjson`。
    member _.legacyFileName(writerId: obj) : string = requireStem writerId + suffix

    /// 段名解析：`{ writerId, ordinal }` 或 null。只认 ASCII 四位数字与 `.ndjson` 后缀，writer 不得为空。
    member _.parseSegmentFileName(name: obj) : obj =
        if not (isString name) then raise (System.ArgumentException "name must be a string")
        match parseName (unbox<string> name) with
        | Some(w, o) -> createObj [ "writerId", box w; "ordinal", box o ]
        | None -> null

    /// 某 writer 的段系列（不论是否连续），按名字排序。
    member _.seriesOf(writerId: obj, names: obj) : string array =
        let writer = requireStem writerId
        requireNames names
        |> Array.filter (fun name ->
            match parseName name with
            | Some(w, _) -> w = writer
            | None -> false)
        |> sortedCopy

    /// 目录名单 → writer 分组 `[{ writerId, fileNames }]`，按 writerId 码元序，组内文件名有序。非 `.ndjson` 忽略。
    member _.groupWriterFiles(names: obj) : obj array =
        group (requireNames names)
        |> Array.map (fun (w, files) -> createObj [ "writerId", box w; "fileNames", box files ])

    /// 一组文件构成的逻辑流形态：`segments`（只有段）、`legacy`（只有旧式文件）、
    /// `coexisting`（旧式文件与段系列共存，须由调用方按字节裁决）、`multipleLegacy`（不成立，失败关闭）。
    member _.streamLayout(writerFiles: obj) : obj =
        if not (isPlainObject writerFiles) then raise (System.ArgumentException "writerFiles must be an object")
        let writer: obj = writerFiles?writerId
        if not (isString writer) then raise (System.ArgumentException "writerId must be a string")
        let writerId = unbox<string> writer
        let names = requireNames (writerFiles?fileNames: obj)
        let isOwnSegment name =
            match parseName name with
            | Some(w, _) -> w = writerId
            | None -> false
        let segments = names |> Array.filter isOwnSegment |> sortedCopy
        let legacy = names |> Array.filter (isOwnSegment >> not) |> sortedCopy
        match legacy with
        | [||] -> createObj [ "kind", box "segments"; "segments", box segments ]
        | [| only |] when segments.Length = 0 -> createObj [ "kind", box "legacy"; "legacy", box only ]
        | [| only |] -> createObj [ "kind", box "coexisting"; "legacy", box only; "segments", box segments ]
        | many -> createObj [ "kind", box "multipleLegacy"; "legacy", box many ]

    /// 一条 writer 流文本的成帧与逐行规范解码：`{ ok: true, events }` 或 `{ ok: false, error }`。
    /// 成帧错误是 `NonCanonical`（消息带 label）；行内错误原样来自 wanxiangli/events。
    member _.decodeStream(label: obj, text: obj) : obj =
        if not (isString label) then raise (System.ArgumentException "label must be a string")
        if not (isString text) then raise (System.ArgumentException "text must be a string")
        match decodeStreamText (unbox<string> label) (unbox<string> text) with
        | Ok events -> createObj [ "ok", box true; "events", box events ]
        | Error error -> createObj [ "ok", box false; "error", error ]

    /// 旧式文件与段系列共存时的字节裁决：`series` | `legacy` | `continuation` | `diverged`。
    /// series 是段系列按序拼接的字节。只看字节，不读写文件、不删除；按裁决执行物理收敛归调用方。
    member _.coexistence(legacyBytes: obj, seriesBytes: obj) : string =
        coexistenceOf (requireBytes "legacyBytes" legacyBytes) (requireBytes "seriesBytes" seriesBytes)
