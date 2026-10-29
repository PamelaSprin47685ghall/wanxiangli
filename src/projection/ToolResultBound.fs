module Wanxiangli.Projection.ToolResultBound

open System
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type ToolResultBoundStore() =
    let defaultLines = 2000
    let defaultBytes = 51200
    let truncationMarker = "...head truncated (tail kept)...\n\n"
    let truncationBytes = 34
    let truncationLines = 2

    let mutable lineLimit = defaultLines
    let mutable byteLimit = defaultBytes

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
        let c = text[index]
        let code = int c

        if code < 0x80 then
            1, 1
        elif code < 0x800 then
            1, 2
        elif isHighSurrogate c && index + 1 < text.Length && isLowSurrogate text[index + 1] then
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
            && isLowSurrogate text[start - 1]
            && isHighSurrogate text[start - 2]
        then
            start - 2
        else
            start - 1

    let walkUtf8Tail (text: string) (maxBytes: int) : int =
        let mutable start = text.Length
        let mutable usedBytes = 0
        let mutable withinBudget = true

        while start > 0 && withinBudget do
            let previous = scalarStepBack text start
            let bytes = snd (scalarAt text previous)

            if usedBytes + bytes > maxBytes then
                withinBudget <- false
            else
                usedBytes <- usedBytes + bytes
                start <- previous

        start

    let sliceFrom (text: string) (start: int) : string =
        if start >= text.Length then "" else text.Substring(start)

    /// UTF-8-safe suffix with byte length <= maxBytes. Single reverse walk.
    let utf8Tail (text: string) (maxBytes: int) : string =
        if maxBytes <= 0 then
            ""
        elif byteCount text <= maxBytes then
            text
        else
            sliceFrom text (walkUtf8Tail text maxBytes)

    /// Locate segment start (one past previous \n) and the newline index (-1 if none).
    let findLineBounds (text: string) (segEnd: int) : int * int =
        let mutable p = segEnd - 1

        while p >= 0 && text[p] <> '\n' do
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

    member _.DefaultHostMaxLines = defaultLines
    member _.DefaultHostMaxBytes = defaultBytes
    member _.Marker = truncationMarker
    member _.MarkerBytes = truncationBytes
    member _.MarkerLineCost = truncationLines

    member _.defaultHostMaxLines = defaultLines
    member _.defaultHostMaxBytes = defaultBytes
    member _.marker = truncationMarker
    member _.markerBytes = truncationBytes
    member _.markerLineCost = truncationLines

    member _.HostMaxLines() : int = lineLimit
    member _.HostMaxBytes() : int = byteLimit
    member _.ContentMaxLines() : int = lineLimit - truncationLines
    member _.ContentMaxBytes() : int = byteLimit - truncationBytes

    member _.hostMaxLines() : int = lineLimit
    member _.hostMaxBytes() : int = byteLimit
    member _.contentMaxLines() : int = lineLimit - truncationLines
    member _.contentMaxBytes() : int = byteLimit - truncationBytes

    member _.setHostLimits(maxLines: obj, maxBytes: obj) : unit =
        match ceilingOf maxLines truncationLines with
        | Some n -> lineLimit <- n
        | None -> ()

        match ceilingOf maxBytes truncationBytes with
        | Some n -> byteLimit <- n
        | None -> ()

    member _.clearHostLimitsForTests() : unit =
        lineLimit <- defaultLines
        byteLimit <- defaultBytes

    member _.fitsInWindow(text: string) : bool =
        fitsWith lineLimit byteLimit text

    member _.bound(text: string) : string =
        if fitsWith lineLimit byteLimit text then
            text
        else
            truncationMarker + takeTail (lineLimit - truncationLines) (byteLimit - truncationBytes) text

let toolResultBound = ToolResultBoundStore()
