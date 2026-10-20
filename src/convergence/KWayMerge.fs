module Wanxiangli.Convergence.KWayMerge

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

// 身份字节规则只有一个 owner：wanxiangli/events。这里只在同 id 重复出现时
// 请它裁决同字节去重还是身份碰撞，不复制编码规则。
[<Import("CanonicalEventCodec", "wanxiangli/events")>]
let private codecClass: obj = jsNative

[<Emit("new $0()")>]
let private construct (cls: obj) : obj = jsNative

let private codec: obj = construct codecClass

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

type private Failure =
    | MissingParent of eventId: string
    | NonCanonical of reason: string
    | MalformedEnvelope of reason: string
    | Codec of error: obj

let private failureToJs (failure: Failure) : obj =
    match failure with
    | MissingParent eventId -> createObj [ "code" ==> "MissingParent"; "eventId" ==> eventId ]
    | NonCanonical reason -> createObj [ "code" ==> "NonCanonical"; "reason" ==> reason ]
    | MalformedEnvelope reason -> createObj [ "code" ==> "MalformedEnvelope"; "reason" ==> reason ]
    | Codec error -> error

/// 一个 writer 的完整逻辑流。事件对象原样保留，结果按引用交还调用方。
type private Writer =
    { WriterId: string
      Ids: string array
      Parents: string array array
      Events: obj array }

type private Readiness =
    | Dormant
    | Waiting of missing: int
    | Queued
    | Exhausted

type private Ready = { Index: int; Key: string; WriterId: string }

type private Token = { Index: int; Offset: int }

/// 一次归并的全部草稿状态。实例只活在一次 run 内，不跨调用共享。
type private Run(writers: Writer array, allowExternalParents: bool) =
    let offsets = Array.zeroCreate<int> writers.Length
    let readiness = Array.create writers.Length Dormant
    let known = HashSet<string>()
    let seen = Dictionary<string, obj>()
    let parentWaiters = Dictionary<string, ResizeArray<Token>>()
    let duplicateWaiters = Dictionary<string, ResizeArray<Token>>()
    let heap = ResizeArray<Ready>()
    let ordered = ResizeArray<obj>()
    // DSL-MUTABLE: algorithm-scratch — 仅本次归并的就绪比较计数（诊断，非权威）。
    let mutable comparisons = 0.0

    do
        for writer in writers do
            for id in writer.Ids do
                known.Add id |> ignore

    member _.Comparisons = comparisons
    member _.Ordered = ordered

    member private _.HasHead index = offsets[index] < writers[index].Ids.Length

    member private _.Less (left: Ready) (right: Ready) =
        comparisons <- comparisons + 1.0
        let byEvent = compare left.Key right.Key
        (if byEvent <> 0 then byEvent else compare left.WriterId right.WriterId) < 0

    member private this.Push(entry: Ready) =
        heap.Add entry
        let mutable child = heap.Count - 1
        let mutable moving = true
        while moving && child > 0 do
            let parent = (child - 1) / 2
            if this.Less heap[child] heap[parent] then
                let value = heap[child]
                heap[child] <- heap[parent]
                heap[parent] <- value
                child <- parent
            else
                moving <- false

    member private this.Pop() =
        let first = heap[0]
        let last = heap[heap.Count - 1]
        heap.RemoveAt(heap.Count - 1)
        if heap.Count > 0 then
            heap[0] <- last
            let mutable parent = 0
            let mutable moving = true
            while moving do
                let left = parent * 2 + 1
                let right = left + 1
                let smaller =
                    if left >= heap.Count then None
                    elif right < heap.Count && this.Less heap[right] heap[left] then Some right
                    else Some left
                match smaller with
                | Some child when this.Less heap[child] heap[parent] ->
                    let value = heap[child]
                    heap[child] <- heap[parent]
                    heap[parent] <- value
                    parent <- child
                | _ -> moving <- false
        first

    member private this.Queue index =
        match readiness[index] with
        | Queued -> ()
        | _ when not (this.HasHead index) -> readiness[index] <- Exhausted
        | _ ->
            readiness[index] <- Queued
            let writer = writers[index]
            this.Push { Index = index; Key = writer.Ids[offsets[index]]; WriterId = writer.WriterId }

    static member private AddWaiter (waiters: Dictionary<string, ResizeArray<Token>>) key token =
        match waiters.TryGetValue key with
        | true, entries -> entries.Add token
        | false, _ ->
            let entries = ResizeArray<Token>()
            entries.Add token
            waiters.Add(key, entries)

    /// 父引用缺失：严格模式下任何未见父都阻塞；retained 模式下只有保留集合内存在的父才阻塞，
    /// 集合外的父视为窗口外因果边界（durable-convergence-011）。
    member private _.Missing(parents: string array) =
        parents
        |> Array.filter (fun key -> not (seen.ContainsKey key) && (not allowExternalParents || known.Contains key))

    member this.Schedule index =
        if not (this.HasHead index) then
            readiness[index] <- Exhausted
        else
            let writer = writers[index]
            let offset = offsets[index]
            let key = writer.Ids[offset]
            if seen.ContainsKey key then
                this.Queue index
            else
                match this.Missing writer.Parents[offset] with
                | [||] -> this.Queue index
                | missing ->
                    let token = { Index = index; Offset = offset }
                    readiness[index] <- Waiting missing.Length
                    for parent in missing do
                        Run.AddWaiter parentWaiters parent token
                    Run.AddWaiter duplicateWaiters key token

    member private this.WakeParent key =
        match parentWaiters.TryGetValue key with
        | false, _ -> ()
        | true, entries ->
            parentWaiters.Remove key |> ignore
            for token in entries do
                if offsets[token.Index] = token.Offset then
                    match readiness[token.Index] with
                    | Waiting 1 -> this.Queue token.Index
                    | Waiting count when count > 1 -> readiness[token.Index] <- Waiting(count - 1)
                    | _ -> ()

    member private this.WakeDuplicate key =
        match duplicateWaiters.TryGetValue key with
        | false, _ -> ()
        | true, entries ->
            duplicateWaiters.Remove key |> ignore
            for token in entries do
                if offsets[token.Index] = token.Offset then
                    match readiness[token.Index] with
                    | Waiting _ -> this.Queue token.Index
                    | _ -> ()

    member private _.FrontierError() =
        if allowExternalParents then
            NonCanonical "retained writer-stream order has a cyclic or backward causal frontier"
        else
            let pending = HashSet<string>()
            for index = 0 to writers.Length - 1 do
                for offset = offsets[index] to writers[index].Ids.Length - 1 do
                    pending.Add writers[index].Ids[offset] |> ignore
            let missing =
                [| for index = 0 to writers.Length - 1 do
                       if offsets[index] < writers[index].Ids.Length then
                           yield! writers[index].Parents[offsets[index]] |]
                |> Array.filter (fun parent -> not (seen.ContainsKey parent) && not (pending.Contains parent))
                |> Array.sort
            if missing.Length > 0 then MissingParent missing[0]
            else NonCanonical "writer-stream order has a cyclic or backward causal frontier"

    /// 取出一个就绪 head 并推进其 writer；Ok false 表示继续，Ok true 表示归并完成。
    member this.Step() : Result<bool, Failure> =
        if heap.Count > 0 then
            let ready = this.Pop()
            let index = ready.Index
            if not (this.HasHead index) || writers[index].Ids[offsets[index]] <> ready.Key then
                Error(NonCanonical "k-way ready cursor no longer names its current event")
            else
                let offset = offsets[index]
                let head = writers[index].Events[offset]
                offsets[index] <- offset + 1
                readiness[index] <- Dormant
                match seen.TryGetValue ready.Key with
                | true, existing ->
                    let outcome: obj = codec?checkIdentity (existing, head)
                    if unbox<bool> outcome?ok then
                        this.Schedule index
                        Ok false
                    else
                        Error(Codec outcome?error)
                | false, _ ->
                    seen.Add(ready.Key, head)
                    ordered.Add head
                    this.WakeParent ready.Key
                    this.WakeDuplicate ready.Key
                    this.Schedule index
                    Ok false
        elif Array.exists (fun index -> offsets[index] < writers[index].Ids.Length) [| 0 .. writers.Length - 1 |] then
            Error(this.FrontierError())
        else
            Ok true

let private readStream (pair: obj) : Result<Writer, Failure> =
    if not (isArray pair) then
        Error(MalformedEnvelope "writer stream must be a [writerId, events] pair")
    else
        let values = unbox<obj array> pair
        if values.Length <> 2 || not (isString values[0]) || not (isArray values[1]) then
            Error(MalformedEnvelope "writer stream must be a [writerId, events] pair")
        else
            let events = unbox<obj array> values[1]
            let wellFormed (event: obj) =
                not (isNull event)
                && isString event?id
                && isArray event?parents
                && (unbox<obj array> event?parents |> Array.forall isString)
            if not (Array.forall wellFormed events) then
                Error(MalformedEnvelope "writer event must carry a string id and string parents")
            else
                Ok
                    { WriterId = unbox<string> values[0]
                      Ids = events |> Array.map (fun event -> unbox<string> event?id)
                      Parents = events |> Array.map (fun event -> unbox<string array> event?parents)
                      Events = events }

/// 同一 WriterId 只能代表一条完整逻辑流（durable-convergence-003）；
/// 重复出现说明调用方没有先聚合段，静默取其一会丢掉另一支事实，故拒绝。
let private readStreams (streams: obj) : Result<Writer array, Failure> =
    if not (isArray streams) then
        Error(MalformedEnvelope "writer streams must be an array")
    else
        let parsed = unbox<obj array> streams |> Array.map readStream
        match parsed |> Array.tryPick (function Error failure -> Some failure | Ok _ -> None) with
        | Some failure -> Error failure
        | None ->
            let writers = parsed |> Array.choose (function Ok writer -> Some writer | Error _ -> None)
            let names = HashSet<string>()
            match writers |> Array.tryFind (fun writer -> not (names.Add writer.WriterId)) with
            | Some duplicate -> Error(NonCanonical("duplicate writer stream: " + duplicate.WriterId))
            | None -> Ok(writers |> Array.sortWith (fun left right -> compare left.WriterId right.WriterId))

let private run (allowExternalParents: bool) (streams: obj) : obj =
    match readStreams streams with
    | Error failure -> createObj [ "ok" ==> false; "error" ==> failureToJs failure; "readyComparisons" ==> 0 ]
    | Ok writers ->
        let state = Run(writers, allowExternalParents)
        for index = 0 to writers.Length - 1 do
            state.Schedule index
        // DSL-MUTABLE: algorithm-scratch — 有限循环的终局判定。
        let mutable verdict: Result<bool, Failure> = Ok false
        while (match verdict with Ok false -> true | _ -> false) do
            verdict <- state.Step()
        match verdict with
        | Error failure ->
            createObj [ "ok" ==> false; "error" ==> failureToJs failure; "readyComparisons" ==> state.Comparisons ]
        | Ok _ ->
            createObj [ "ok" ==> true; "events" ==> state.Ordered.ToArray(); "readyComparisons" ==> state.Comparisons ]

/// 多 writer 结构归并：各 writer 内追加顺序不变；当前因果就绪的 head 之间以 EventId
/// 文本序确定先后，parent 先于 child；同 id 同字节去重，异字节即身份碰撞。
/// 不读文件、不解释业务事件、不挑选赢家。
[<AttachMembers>]
type KWayMerge() =
    /// 完整历史：保留集合内外任何缺失 parent 都是存储损坏。
    member _.merge(streams: obj) : obj = run false streams
    /// retention 窗口：整个保留集合中都不存在的 parent 视为窗口外已满足的因果边界；
    /// 集合内存在的依赖仍参与排序与成环检测。
    member _.mergeRetained(streams: obj) : obj = run true streams
