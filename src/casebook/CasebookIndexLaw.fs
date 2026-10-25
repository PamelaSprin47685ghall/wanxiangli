module Wanxiangli.Casebook.CasebookIndexLaw

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("Number.isInteger($0)")>]
let private isInteger (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isPlainObject (value: obj) : bool = jsNative

[<Emit("(typeof $0 === 'number' && Number.isFinite($0)) || typeof $0 === 'bigint'")>]
let private isOrder (value: obj) : bool = jsNative

/// 码元序比较（与主仓 F# 字符串比较、Array.prototype.sort 默认序一致），不随区域设置变化。
[<Emit("($0 < $1 ? -1 : $0 > $1 ? 1 : 0)")>]
let private compareText (left: string) (right: string) : int = jsNative

/// 数值或 bigint 的访问序比较（主仓 int64 以 bigint 到达）。
[<Emit("($0 < $1 ? -1 : $0 > $1 ? 1 : 0)")>]
let private compareOrder (left: obj) (right: obj) : int = jsNative

/// 稳定排序的拷贝（ES2019 起 Array.prototype.sort 稳定）。
[<Emit("[...$0].sort($1)")>]
let private stableSorted (items: 'T array) (comparer: 'T -> 'T -> int) : 'T array = jsNative

[<Emit("($0 ^ $1) >>> 0")>]
let private xor32 (left: float) (right: float) : float = jsNative

/// 冻结的旧算术：双精度乘法，不截回 32 位（积可达 2^56，按 IEEE 舍入），下一次异或时才按 ToInt32 取模。
/// 这不是教科书 FNV-1a，但它就是主仓一直发出的判别后缀；为让已发出的 shelfmark 继续可寻址，逐位保留。
[<Emit("$0 * 16777619")>]
let private timesFnvPrime (value: float) : float = jsNative

[<Emit("$0.charCodeAt($1)")>]
let private codeUnitAt (text: string) (index: int) : float = jsNative

[<Emit("($0 >>> 0).toString(16).padStart(8, '0')")>]
let private hex8 (value: float) : string = jsNative

[<Emit("/^\\s*$/.test($0)")>]
let private isBlank (text: string) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBoolean (value: obj) : bool = jsNative

let private untitled = "Untitled case"
let private titleLimit = 72

/// 一个码元是否为 UTF-16 高代理（一个码点的前半）。
let private isHighSurrogate (text: string) (index: int) =
    let unit = codeUnitAt text index
    unit >= 55296.0 && unit <= 56319.0

/// 截到不超过 count 个码元，但绝不把一个码点拆成孤立代理：公开定位符必须是良构字符串，
/// 否则任何 UTF-8 传输都会把半个码点换成 U+FFFD，模型回传的 shelfmark 就再也对不上。
let private prefixUnits (text: string) (count: int) =
    if count > 0 && count < text.Length && isHighSurrogate text (count - 1) then
        text.Substring(0, count - 1)
    else
        text.Substring(0, count)

/// 公开标题：第一条非空行，去掉行首 Markdown 记号与空白、折叠词间空白，最多 72 个码元（超出截到 71 加 “…”）。
let private compactTitle (question: string) =
    let firstLine =
        if isBlank question then untitled
        else
            question.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n')
            |> Array.tryFind (isBlank >> not)
            |> Option.defaultValue untitled
    let cleaned = firstLine.Trim().TrimStart([| '#'; '-'; '*'; ' '; '\t' |]).Trim()
    let words =
        cleaned.Split([| ' '; '\t' |], System.StringSplitOptions.RemoveEmptyEntries) |> String.concat " "
    let title = if isBlank words then untitled else words
    if title.Length <= titleLimit then title
    else (prefixUnits title (titleLimit - 1)).TrimEnd() + "…"

/// 判别后缀：sessionId 的 UTF-16 码元按“低字节、高字节”两次喂入的 FNV-1a 式滚动散列（乘法见 timesFnvPrime），
/// 结果取 32 位，八位小写十六进制。单向：从后缀推不回会话身份。
let private discriminatorOf (sessionId: string) =
    // DSL-MUTABLE: algorithm-scratch — FNV-1a rolling hash accumulator.
    let mutable hash = 2166136261.0
    for i = 0 to sessionId.Length - 1 do
        let c = codeUnitAt sessionId i
        hash <- timesFnvPrime (xor32 hash (float ((int c) &&& 0xFF)))
        hash <- timesFnvPrime (xor32 hash (float ((int c) >>> 8)))
    hex8 hash

let private shelfmarkOf (sessionId: string) (question: string) =
    compactTitle question + " · " + discriminatorOf sessionId

[<Emit("$0[$1]")>]
let private field (item: obj) (name: string) : obj = jsNative

let private requireText (name: string) (value: obj) : string =
    if isString value then unbox<string> value
    else raise (System.ArgumentException(name + " must be a string"))

let private requireArray (name: string) (value: obj) : obj array =
    if isArray value then unbox<obj array> value
    else raise (System.ArgumentException(name + " must be an array"))

type private IndexCase = { SessionId: string; Question: string; Position: int }

let private requireCases (value: obj) : IndexCase array =
    requireArray "cases" value
    |> Array.mapi (fun position item ->
        if not (isPlainObject item) then raise (System.ArgumentException "each case must be an object")
        { SessionId = requireText "sessionId" (field item "sessionId")
          Question = requireText "question" (field item "question")
          Position = position })

/// 公开条目按 shelfmark 码元序稳定排序；同名时保留输入次序（主仓按 sessionId 有序的 Map 给出）。
let private ordered (cases: IndexCase array) : (string * IndexCase) array =
    stableSorted (cases |> Array.map (fun case -> shelfmarkOf case.SessionId case.Question, case)) (fun (a, _) (b, _) ->
        compareText a b)

let private entryObject (shelfmark: string) (question: string) : obj =
    createObj [ "shelfmark", box shelfmark; "question", box question ]

let private requireEntries (name: string) (value: obj) : (string * string) array =
    requireArray name value
    |> Array.map (fun item ->
        if not (isPlainObject item) then raise (System.ArgumentException(name + " entries must be objects"))
        requireText "shelfmark" (field item "shelfmark"), requireText "question" (field item "question"))

/// Casebook 公开索引的纯投影（knowledge-reuse-008/012）。不读存储、不持有快照、不读时钟；
/// 进程级冻结快照与“已失效”标记归调用方。
[<AttachMembers>]
type CasebookIndexLaw() =
    /// 公开标题（不含判别后缀）。
    member _.compactTitle(question: obj) : string = compactTitle (requireText "question" question)

    /// `<标题> · <8 位十六进制判别后缀>`；同输入恒同输出，不含会话身份本身。
    member _.shelfmarkFor(sessionId: obj, question: obj) : string =
        shelfmarkOf (requireText "sessionId" sessionId) (requireText "question" question)

    /// `[{ sessionId, question }]` → 公开条目 `[{ shelfmark, question }]`，按 shelfmark 稳定排序；不带 sessionId。
    member _.entries(cases: obj) : obj array =
        ordered (requireCases cases) |> Array.map (fun (shelfmark, case) -> entryObject shelfmark case.Question)

    /// shelfmark 寻址的那个 case 在输入中的下标（与 entries 同序的第一个同名者）；找不到为 -1。
    member _.locate(cases: obj, shelfmark: obj) : int =
        let wanted = requireText "shelfmark" shelfmark
        ordered (requireCases cases)
        |> Array.tryFind (fun (name, _) -> name = wanted)
        |> Option.map (fun (_, case) -> case.Position)
        |> Option.defaultValue -1

    /// 刷新是否推进 epoch：没有上一快照（previous 为 null）、已失效（dirty）、或公开条目逐项（shelfmark、question、次序）有变时为 true。
    /// epoch 的数值与存放归调用方。
    member _.advancesEpoch(previous: obj, dirty: obj, entries: obj) : bool =
        if not (isBoolean dirty) then raise (System.ArgumentException "dirty must be a boolean")
        let next = requireEntries "entries" entries
        if isNull previous then true
        else unbox<bool> dirty || requireEntries "previous" previous <> next

    /// LRU 淘汰（knowledge-reuse-008）：容量 ≤ 0 或未超容量时不淘汰；否则按访问序升序（同序保留输入次序）
    /// 淘汰最旧的 `count - capacity` 个，返回其 sessionId（按淘汰次序）。不删除、不写事件。
    member _.evictionVictims(capacity: obj, cases: obj) : string array =
        if not (isInteger capacity) then raise (System.ArgumentException "capacity must be an integer")
        let limit = unbox<int> capacity
        let items =
            requireArray "cases" cases
            |> Array.map (fun item ->
                if not (isPlainObject item) then raise (System.ArgumentException "each case must be an object")
                let order = field item "accessOrder"
                if not (isOrder order) then raise (System.ArgumentException "accessOrder must be a finite number or bigint")
                requireText "sessionId" (field item "sessionId"), order)
        if limit <= 0 || items.Length <= limit then [||]
        else
            stableSorted items (fun (_, a) (_, b) -> compareOrder a b)
            |> Array.take (items.Length - limit)
            |> Array.map fst


/// 进程内 Casebook 索引状态机（knowledge-reuse-008/011/012/013）。
/// 独占持有私有 frozen 快照与 dirty 失效标记。
/// 所有操作同步完成，无 IO、不读存储、不读时钟、不写事件。
[<AttachMembers>]
type CasebookIndex() =
    let law = CasebookIndexLaw()

    // DSL-MUTABLE: resource
    let mutable frozen: obj = null
    // DSL-MUTABLE: resource
    let mutable dirty: bool = true

    let entryObject (shelfmark: string) (question: string) : obj =
        createObj [ "shelfmark", box shelfmark; "question", box question ]

    let snapshotObject (epoch: obj) (cases: obj array) : obj =
        createObj [ "epoch", epoch; "cases", box cases ]

    let copyEntries (entries: obj array) : obj array =
        entries |> Array.map (fun e -> entryObject (unbox<string> e?shelfmark) (unbox<string> e?question))

    /// 读取当前冻结的公开快照，未完成首次冻结前返回 null/None。
    member _.tryGet() : obj =
        if isNull frozen then
            null
        else
            let epoch = frozen?epoch
            let cases = unbox<obj array> frozen?cases
            snapshotObject epoch (copyEntries cases)

    /// 标记公开索引已失效；促使下一次成功 freeze 推进 epoch。
    member _.invalidate() : unit =
        dirty <- true

    /// 给定内部案例集合计算公开条目并冻结为新快照。
    /// 即使 cases 为空集合，首次成功冻结也产生 epoch = 0n, dirty = false；
    /// 后续仅在 dirty = true 或公开条目发生实质变化（含次序）时 epoch 推进 1。
    /// 返回防御性浅拷贝的原生快照对象。
    member _.freeze(cases: obj) : obj =
        let caseList =
            if isNull cases then
                [||]
            elif isArray cases then
                unbox<obj array> cases
            else
                [||]

        let publicEntries = law.entries caseList

        let previous =
            if isNull frozen then
                null
            else
                unbox<obj array> frozen?cases

        let advances = law.advancesEpoch (previous, dirty, publicEntries)

        let previousEpoch: int64 =
            if isNull frozen then
                -1L
            else
                let ep = frozen?epoch
                if jsTypeof ep = "bigint" then
                    unbox<int64> ep
                elif jsTypeof ep = "number" then
                    int64 (unbox<float> ep)
                else
                    -1L

        let epoch = if advances then previousEpoch + 1L else previousEpoch
        dirty <- false

        let frozenSnapshot = snapshotObject (box epoch) publicEntries
        frozen <- frozenSnapshot

        // 返回防御性浅拷贝快照
        snapshotObject (box epoch) (copyEntries publicEntries)

    /// 定位 shelfmark 在输入 cases 中的索引，找不到返回 -1。
    member _.locate(cases: obj, shelfmark: string) : int =
        let caseList =
            if isNull cases then
                [||]
            elif isArray cases then
                unbox<obj array> cases
            else
                [||]
        law.locate (caseList, shelfmark)

    /// 稳定公开 shelfmark 计算。
    member _.shelfmarkFor(sessionId: string, question: string) : string =
        law.shelfmarkFor (sessionId, question)

/// 全局唯一单例
let casebookIndex = CasebookIndex()
