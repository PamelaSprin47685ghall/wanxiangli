module Wanxiangli.Projection.ToolResultBound

open System
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type ToolResultBoundStore() =
    let defaultHostMaxLines = 2000
    let defaultHostMaxBytes = 51200
    let marker = "...head truncated (tail kept)...\n\n"
    let markerBytes = 34
    let markerLineCost = 2

    let mutable hostMaxLines = defaultHostMaxLines
    let mutable hostMaxBytes = defaultHostMaxBytes

    let ceilingOf (value: obj) (floor: int) : int option =
        if emitJsExpr (value, floor) "typeof $0 === 'number' && Number.isFinite($0) && $0 > $1" then
            Some(int (unbox<float> value))
        else
            None

    let isHighSurrogate (c: char) =
        let code = int c
        code >= 0xD800 && code <= 0xDBFF

    let isLowSurrogate (c: char) =
        let code = int c
        code >= 0xDC00 && code <= 0xDFFF

    /// UTF-8 bytes of the scalar at index (handles surrogate pairs).
    /// Returns (codeUnits, bytes).
    let scalarAt (text: string) (index: int) : int * int =
        let c = text.[index]
        let code = int c

        if code < 0x80 then
            1, 1
        elif code < 0x800 then
            1, 2
        elif isHighSurrogate c && index + 1 < text.Length && isLowSurrogate text.[index + 1] then
            2, 4
        else
            1, 3

    let byteCount (text: string) : int =
        let mutable total = 0
        let mutable index = 0
        let stop = if isNull text then 0 else text.Length
        while index < stop do
            let units, bytes = scalarAt text index
            total <- total + bytes
            index <- index + units
        total

    let scalarStepBack (text: string) (start: int) : int =
        if
            start >= 2
            && isLowSurrogate text.[start - 1]
            && isHighSurrogate text.[start - 2]
        then
            start - 2
        else
            start - 1

    let rec walkUtf8Tail (text: string) (maxBytes: int) (acc: int) (start: int) : int =
        let atEnd = start <= 0
        let prev = if atEnd then 0 else scalarStepBack text start
        let bytes = if atEnd then 0 else snd (scalarAt text prev)

        if atEnd then start
        elif acc + bytes > maxBytes then start
        else walkUtf8Tail text maxBytes (acc + bytes) prev

    let sliceFrom (text: string) (start: int) : string =
        if start >= text.Length then "" else text.Substring(start)

    /// UTF-8-safe suffix with byte length <= maxBytes. Single reverse walk.
    let utf8Tail (text: string) (maxBytes: int) : string =
        if maxBytes <= 0 then
            ""
        elif byteCount text <= maxBytes then
            text
        else
            sliceFrom text (walkUtf8Tail text maxBytes 0 text.Length)

    /// Locate segment start (one past previous \n) and the newline index (-1 if none).
    let findLineBounds (text: string) (segEnd: int) : int * int =
        let mutable p = segEnd - 1

        while p >= 0 && text.[p] <> '\n' do
            p <- p - 1

        p + 1, p

    let overflowTail (text: string) (segStart: int) (segEnd: int) (maxBytes: int) : string list =
        let tail = utf8Tail (text.Substring(segStart, segEnd - segStart)) maxBytes
        if tail = "" then [] else [ tail ]

    let rec collectTail
        (text: string)
        (maxLines: int)
        (maxBytes: int)
        (segments: string list)
        (accBytes: int)
        (count: int)
        (segEnd: int)
        : string list =
        let segStart, newlineAt = findLineBounds text segEnd
        let line = text.Substring(segStart, segEnd - segStart)
        let lineBytes = byteCount line
        let size = lineBytes + (if count = 0 then 0 else 1)
        let overBudget = count >= maxLines || accBytes + size > maxBytes

        if overBudget && count = 0 then
            overflowTail text segStart segEnd maxBytes
        elif overBudget then
            segments
        elif newlineAt < 0 then
            line :: segments
        else
            collectTail text maxLines maxBytes (line :: segments) (accBytes + size) (count + 1) newlineAt

    let takeTail (maxLines: int) (maxBytes: int) (text: string) : string =
        String.concat "\n" (collectTail text maxLines maxBytes [] 0 0 text.Length)

    let newlineBump (n: int) (c: char) = if c = '\n' then n + 1 else n

    let countLines (text: string) : int =
        let mutable n = 1

        for c in text do
            n <- newlineBump n c

        n

    let fitsWith (maxLines: int) (maxBytes: int) (text: string) : bool =
        if isNull text || text = "" then
            true
        else
            let totalBytes = byteCount text
            let totalLines = countLines text
            totalLines <= maxLines && totalBytes <= maxBytes

    member _.DefaultHostMaxLines = defaultHostMaxLines
    member _.DefaultHostMaxBytes = defaultHostMaxBytes
    member _.Marker = marker
    member _.MarkerBytes = markerBytes
    member _.MarkerLineCost = markerLineCost

    member _.defaultHostMaxLines = defaultHostMaxLines
    member _.defaultHostMaxBytes = defaultHostMaxBytes
    member _.marker = marker
    member _.markerBytes = markerBytes
    member _.markerLineCost = markerLineCost

    member _.HostMaxLines() : int = hostMaxLines
    member _.HostMaxBytes() : int = hostMaxBytes
    member _.ContentMaxLines() : int = hostMaxLines - markerLineCost
    member _.ContentMaxBytes() : int = hostMaxBytes - markerBytes

    member _.hostMaxLines() : int = hostMaxLines
    member _.hostMaxBytes() : int = hostMaxBytes
    member _.contentMaxLines() : int = hostMaxLines - markerLineCost
    member _.contentMaxBytes() : int = hostMaxBytes - markerBytes

    member _.setHostLimits(maxLines: obj, maxBytes: obj) : unit =
        match ceilingOf maxLines markerLineCost with
        | Some n -> hostMaxLines <- n
        | None -> ()

        match ceilingOf maxBytes markerBytes with
        | Some n -> hostMaxBytes <- n
        | None -> ()

    member _.clearHostLimitsForTests() : unit =
        hostMaxLines <- defaultHostMaxLines
        hostMaxBytes <- defaultHostMaxBytes

    member _.fitsInWindow(text: string) : bool =
        fitsWith hostMaxLines hostMaxBytes text

    member _.bound(text: string) : string =
        if fitsWith hostMaxLines hostMaxBytes text then
            text
        else
            marker + takeTail (hostMaxLines - markerLineCost) (hostMaxBytes - markerBytes) text

let toolResultBound = ToolResultBoundStore()
