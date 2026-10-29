module Wanxiangli.PairHint.PairHint

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type PairHintMessages =
    abstract isUnchanged: left: obj array * right: obj array -> bool
    abstract budgetSuffix: budget: int -> string
    abstract adjustBudgetForKpi: estimatedNextScopeBudget: int * kpiCompletion: string -> int
    abstract turnBudget: sessionId: string -> int
    abstract setRetention: sessionId: string * remaining: int -> unit
    abstract isInitialized: sessionId: string -> bool
    abstract startTurn: sessionId: string -> unit
    abstract resetSession: sessionId: string * budget: int -> unit
    abstract clearSession: sessionId: string -> unit
    abstract writeUserHint: message: obj * texts: string array -> obj
    abstract writeToolResultHint: message: obj * texts: string array -> obj
    abstract stripKnownHints: message: obj * texts: string array -> obj
    abstract userCanCarryHint: message: obj -> bool
    abstract toolCanCarryHint: message: obj -> bool
    abstract planRequest: sessionId: string * neutralMessages: obj * language: string -> obj
    abstract planFilter: neutralMessages: obj -> obj
    abstract appendTailOnce: content: obj * tail: string -> obj
    abstract bindDelegation: recipient: string * delegator: string -> unit
    abstract askNegotiation: recipient: string * questions: string * language: string -> obj
    abstract prepareNegotiationReply: receipt: string * answer: string * language: string -> obj
    abstract completeNegotiationReply: receipt: string -> bool
    abstract confirmNegotiationSteer: receipt: string * recipient: string -> bool
    abstract negotiationRequired: recipient: string -> bool
    abstract rememberSystem: sessionId: string * system: string array -> unit
    abstract rememberMessages: sessionId: string * messages: obj array -> unit
    abstract rememberTransform: sessionId: string * input: obj array * output: obj array -> unit
    abstract latestPrevious: sessionId: string -> obj
    abstract rememberModel: sessionId: string * model: obj -> unit
    abstract modelFor: sessionId: string -> obj
    abstract startTemporary: tempId: string * delegatorId: string -> obj
    abstract startTemporaryPrevious: tempId: string * sourceSessionId: string * metadata: obj -> obj
    abstract projectPreviousMessages: messages: obj array -> obj
    abstract modelForTemporary: tempId: string -> obj
    abstract isTemporary: sessionId: string -> bool
    abstract finishTemporary: tempId: string -> unit
    abstract recordToolViolation: tempId: string -> unit
    abstract toolViolationCount: tempId: string -> int
    abstract forgetSession: sessionId: string -> unit
    abstract projectSystem: tempId: string * system: string array -> obj
    abstract projectMessages: tempId: string * question: obj -> obj
    abstract pendingKind: sessionId: string -> string
    abstract isPreviousScopePending: sessionId: string -> bool
    abstract hasPreviousScope: sessionId: string -> bool
    abstract setHasPreviousScope: sessionId: string * value: bool -> unit
    abstract beginAskPreviousScope: sessionId: string -> unit
    abstract askPreviousScope: sessionId: string * questions: string * ?receipt: string -> obj
    abstract preparePreviousScopeReply: receipt: string * sessionId: string * answer: string * language: string -> obj
    abstract confirmPreviousScopeSteer: receipt: string * sessionId: string -> bool

type private PendingKind =
    | NoPending
    | AwaitingNegotiation
    | AwaitingPreviousScope

type private ScopeSession() =
    let mutable budget = 0
    let mutable budgetKnown = false
    let mutable initialized = false
    let mutable promptKey = ""
    let mutable promptTime: float option = None
    let toolTails = Dictionary<string, string>()
    let mutable pending = NoPending
    let mutable hasPreviousScope = false

    member _.Budget = budget
    member _.BudgetKnown = budgetKnown
    member _.Initialized = initialized
    member _.PendingKind =
        match pending with
        | NoPending -> "none"
        | AwaitingNegotiation -> "negotiate"
        | AwaitingPreviousScope -> "askPreviousScope"
    member _.PreviousScopePending = pending = AwaitingPreviousScope
    member _.NegotiationRequired = pending = AwaitingNegotiation
    member _.IsPending = pending <> NoPending
    member _.HasPreviousScope with get() = hasPreviousScope and set v = hasPreviousScope <- v

    member _.BeginNegotiation() =
        pending <- AwaitingNegotiation
        budget <- 0
        budgetKnown <- false
        initialized <- false

    member _.NegotiationReplyAdmitted() =
        if pending = AwaitingNegotiation then
            pending <- NoPending
            budget <- 0
            budgetKnown <- false
            initialized <- false

    member _.BeginAskPreviousScope() =
        // 显式让 AwaitingNegotiation 压过 reset 意图，不被隐式转换
        if pending <> AwaitingNegotiation then
            pending <- AwaitingPreviousScope
            initialized <- false
            hasPreviousScope <- true

    member _.AskPreviousScopeAdmitted() =
        if pending = AwaitingPreviousScope then
            pending <- NoPending
            initialized <- budgetKnown

    member _.StartTurn() = ()

    member _.Observe(nextKey: string, nextTime: float option, hasReset: bool) =
        if promptKey = nextKey then
            if pending = NoPending && budgetKnown && hasReset then initialized <- true
        elif promptTime.IsNone || nextTime.IsNone || nextTime.Value >= promptTime.Value then
            promptKey <- nextKey
            promptTime <- nextTime
            if pending = NoPending && budgetKnown && hasReset then initialized <- true
        if hasReset then hasPreviousScope <- true

    member _.MarkInitialized(value: bool) =
        if pending = NoPending then
            initialized <- value && budgetKnown

    /// Once displayed, a terminal result is immutable within its prefix epoch.
    member _.TerminalTail(identity: string, proposed: string, remember: bool) =
        match toolTails.TryGetValue identity with
        | true, earlier -> earlier
        | false, _ ->
            if remember then toolTails[identity] <- proposed
            proposed

    member _.Reset(nextBudget: int) =
        // 首次 negotiate 受理前 resetScope 自身拒绝执行（delegation [034]：受理即解除，不等答复 steer）
        if pending <> AwaitingNegotiation then
            budget <- max 0 nextBudget
            budgetKnown <- true
            initialized <- true
            hasPreviousScope <- true
            toolTails.Clear()

    /// Sync displayed retention remaining after keepLast / removeLast without clearing tails.
    member _.SetRetention(remaining: int) =
        if pending = NoPending then
            budget <- max 0 remaining
            budgetKnown <- true

let private kpiAdjustedBudget (estimate: int) (completion: string) : int =
    if estimate < 0 then invalidArg "estimatedNextScopeBudget" "Next scope budget cannot be negative"
    let numerator, denominator =
        match completion with
        | "not_started" -> 1, 2
        | "far_below" -> 3, 4
        | "partially_met" -> 9, 10
        | "met" | "not_applicable" -> 1, 1
        | "exceeded" -> 5, 4
        | _ -> invalidArg "kpiCompletion" "Unknown KPI completion level"
    if estimate <= 0 then 0
    else
        let adjusted = Math.Ceiling(float estimate * float numerator / float denominator)
        int (min adjusted (float Int32.MaxValue))

[<Literal>]
let private Separator = "\u0000\uFEFF"

[<Literal>]
// Annotation-first: scope.kind=resetScope is the barrier. Legacy standalone tool name is read-only compat for old transcripts.
let private ResetTool = "resetScope"

let private isChinese (language: string) : bool =
    if language = "zh-CN" then true
    elif language = "en" || isNull (box language) then false
    else invalidArg "language" "Expected explicit en or zh-CN provider language"

let private initializeReminder (language: string) : string =
    if isChinese language then
        "[系统：估计第一个细粒度任务状态闭环所需的 retentionBudget（实质性操作下界）。用带 scope.kind=resetScope 的工具调用初始化该闭环（newScopeGoal + newScopeRetentionBudget），再执行其他工作。见共同法 «Scope»。]"
    else
        "[System: Estimate the retentionBudget (lower bound on substantive keeps) for the first fine-grained task block. Initialize that closed-loop with a tool call whose scope.kind=resetScope (newScopeGoal + newScopeRetentionBudget) before other work. See common law «Scope».]"

let private negotiateReminder (language: string) : string =
    if isChinese language then
        "[系统：先调用 negotiate(questions: string) 向委托者澄清本次任务（可同拍在 scope 里带 resetScope；negotiate 受理后 reset 立即生效）。把需要确认的多个具体问题集中写入 questions；调用一经受理即协商完成，时序继续，不必等待答复。见共同法 «Scope»。]"
    else
        "[System: Call negotiate(questions: string) NOW to clarify this assignment (you may carry scope.kind=resetScope on the same turn; once negotiate is accepted, that reset takes effect immediately). Group related questions into questions. Acceptance completes negotiation; do not wait for an answer. See common law «Scope».]"

let private askPreviousScopeReminder (language: string) : string =
    if isChinese language then
        "[系统：你已经收到前一 Scope 的交接。现在必须先调用 askPreviousScope(questions)，由你根据交接及当前目标，自行向前一 Scope 确认需要澄清的具体问题。调用受理后不必等待答复，可继续工作；回答随后作为 steer 到达。]"
    else
        "[System: You have received the handoff from the previous scope. You must now call askPreviousScope(questions) first to clarify specific questions with the previous scope based on the handoff and current objective. The call acknowledges sending immediately; continue your work without waiting. Answers will arrive later as a user steer.]"

let private weakReminder (language: string) : string =
    if isChinese language then
        "[系统：当前 scope 的 retention 已用尽（剩余 0）。继续完成正在进行的工作，不得因本提醒中断、暂停或放弃；当前状态闭环完成后，下一次非豁免工具必须 scope.kind=resetScope。见共同法 «Scope»。]"
    else
        "[System: This scope's retention is exhausted (0 remaining). Continue work already in progress; do not interrupt or abandon it for this reminder. After closing the current state loop, the next non-exempt tool must use scope.kind=resetScope. See common law «Scope».]"

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("$0 == null ? undefined : $0[$1]")>]
let private field (value: obj) (_name: string) : obj = jsNative

[<Emit("({...$0})")>]
let private copy (value: obj) : obj = jsNative

let private textOf (value: obj) : string =
    if isNull value || not (isString value) then "" else unbox<string> value

let private fieldText (value: obj) (name: string) : string = textOf (field value name)

let private role (message: obj) : string =
    let direct = fieldText message "role"
    if direct <> "" then direct else fieldText (field message "info") "role"

let private blocks (message: obj) : obj array =
    let content = field message "content"
    if isArray content then unbox<obj array> content
    else
        let parts = field message "parts"
        if isArray parts then unbox<obj array> parts else [||]

let private hasParts (message: obj) : bool = isArray (field message "parts")

let private asArray (messages: obj) : obj array =
    if isNull messages then [||]
    elif isArray messages then unbox<obj array> messages
    else emitJsExpr messages "Array.from($0)"

let private sameElements (left: obj array) (right: obj array) : bool =
    obj.ReferenceEquals(left, right)
    || (left.Length = right.Length && Array.forall2 (fun a b -> obj.ReferenceEquals(a, b)) left right)

let private mapIfChanged (items: obj array) (fn: obj -> obj) : obj array =
    let next = Array.map fn items
    if sameElements items next then items else next

let private textBlock (item: obj) : bool =
    fieldText item "type" = "text" && isString (field item "text")

let private contentText (content: obj) : string =
    if isString content then unbox<string> content
    elif isArray content then
        unbox<obj array> content
        |> Array.filter textBlock
        |> Array.map (fun b -> fieldText b "text")
        |> String.concat "\n"
    else ""

let private tail (content: obj) : string =
    let text = contentText content
    let idx = text.LastIndexOf(Separator, StringComparison.Ordinal)
    if idx < 0 then "" else text.Substring(idx + Separator.Length)

let private suffixText (value: string) (addition: string) = value + Separator + addition

let private appendBlocks (items: obj array) (addition: string) : obj array =
    let last = items |> Array.tryFindIndexBack textBlock
    match last with
    | None -> Array.append items [| createObj [ "type" ==> "text"; "text" ==> (Separator + addition) ] |]
    | Some lastIndex ->
        items |> Array.mapi (fun i item ->
            if i <> lastIndex then item
            else
                let updated = copy item
                updated?text <- suffixText (fieldText item "text") addition
                updated)

let private appendText (content: obj) (addition: string) : obj =
    if isString content then box (suffixText (unbox<string> content) addition)
    elif isArray content then box (appendBlocks (unbox<obj array> content) addition)
    else box [| createObj [ "type" ==> "text"; "text" ==> (Separator + addition) ] |]

let private appendOnce (content: obj) (addition: string) (already: string -> bool) : obj =
    if already (tail content) then content else appendText content addition

let private budgetSuffix (budget: int) = $"[Remaining retention: %d{max 0 budget}]"

let private withContent (message: obj) (updatedContent: obj) : obj =
    let result = copy message
    result?content <- updatedContent
    emitJsStatement result "delete $0.providerPayload"
    result

let private withParts (message: obj) (updatedParts: obj array) : obj =
    let result = copy message
    result?parts <- updatedParts
    emitJsStatement result "delete $0.providerPayload"
    result

let private cloneAndSet (objValue: obj) (key: string) (value: obj) : obj =
    let clone = copy objValue
    emitJsStatement (clone, key, value) "$0[$1] = $2"
    clone

// 两条物理提示线由同一个模块维护。写入采用副本，不修改原始 Host 消息。
let private textPartIndex (parts: obj array) : int option =
    parts
    |> Array.mapi (fun i part ->
        if isString part then Some i
        elif fieldText part "type" = "text" && isString (field part "text") then Some i
        else None)
    |> Array.choose id
    |> Array.tryLast

let private toolField (part: obj) : string option =
    if fieldText part "type" <> "tool" then None
    else
        let state = field part "state"
        match fieldText state "status" with
        | "completed" when isString (field state "output") -> Some "output"
        | "error" when isString (field state "error") -> Some "error"
        | "error" when isString (field state "output") -> Some "output"
        | "error" when isString (field state "errorText") -> Some "errorText"
        | _ -> None

let private hintSuffix (texts: string array) : string =
    texts |> Array.map (fun text -> Separator + text) |> String.concat ""

let private appendHintOnce (original: string) (suffix: string) : string =
    if suffix = "" || original.EndsWith(suffix, StringComparison.Ordinal) then original
    else original + suffix

let private withUserPart (message: obj) (items: obj array) (index: int) (suffix: string) : obj =
    let original = items[index]
    let originalText = if isString original then unbox<string> original else fieldText original "text"
    let updatedText = appendHintOnce originalText suffix
    if updatedText = originalText then message
    else
        let next = Array.copy items
        next[index] <- if isString original then box updatedText else cloneAndSet original "text" (box updatedText)
        if hasParts message then withParts message next else withContent message (box next)

let private writeUserHint (message: obj) (texts: string array) : obj =
    if role message <> "user" || texts.Length = 0 then message
    else
        let content = field message "content"
        let items = blocks message
        let suffix = hintSuffix texts
        match textPartIndex items with
        | Some index -> withUserPart message items index suffix
        | None when isString content ->
            let updated = appendHintOnce (unbox<string> content) suffix
            if updated = unbox<string> content then message else withContent message (box updated)
        | None when isString (field message "text") ->
            let value = fieldText message "text"
            let updated = appendHintOnce value suffix
            if updated = value then message else cloneAndSet message "text" (box updated)
        | None ->
            let next = Array.append items [| createObj [ "type" ==> "text"; "text" ==> suffix ] |]
            if hasParts message then withParts message next else withContent message (box next)

let private writeToolResultHint (message: obj) (texts: string array) : obj =
    if texts.Length = 0 then message
    else
        let suffix = hintSuffix texts
        let items = blocks message
        let next =
            mapIfChanged items (fun part ->
                match toolField part with
                | None -> part
                | Some fieldName ->
                    let state = field part "state"
                    let before = fieldText state fieldName
                    let after = appendHintOnce before suffix
                    if before = after then part
                    else cloneAndSet part "state" (cloneAndSet state fieldName (box after)))
        if sameElements items next then message
        elif hasParts message then withParts message next
        else withContent message (box next)

let private stripHintText (texts: string array) (value: string) =
    (value, texts)
    ||> Array.fold (fun current text -> current.Replace(Separator + text, "", StringComparison.Ordinal))

let private stripUserHint (message: obj) (texts: string array) : obj =
    let items = blocks message
    match textPartIndex items with
    | Some index ->
        let original = items[index]
        let value = if isString original then unbox<string> original else fieldText original "text"
        let updated = stripHintText texts value
        if updated = value then message
        else
            let next = Array.copy items
            next[index] <- if isString original then box updated else cloneAndSet original "text" (box updated)
            if hasParts message then withParts message next else withContent message (box next)
    | None ->
        let content = field message "content"
        if isString content then
            let value = unbox<string> content
            let updated = stripHintText texts value
            if updated = value then message else withContent message (box updated)
        elif isString (field message "text") then
            let value = fieldText message "text"
            let updated = stripHintText texts value
            if updated = value then message else cloneAndSet message "text" (box updated)
        else message

let private stripToolHint (message: obj) (texts: string array) : obj =
    let parts = blocks message
    let next =
        mapIfChanged parts (fun part ->
            match toolField part with
            | None -> part
            | Some key ->
                let state = field part "state"
                let before = fieldText state key
                let after = stripHintText texts before
                if before = after then part else cloneAndSet part "state" (cloneAndSet state key (box after)))
    if sameElements parts next then message
    elif hasParts message then withParts message next
    else withContent message (box next)

let private stripKnownHints (message: obj) (texts: string array) : obj =
    if texts.Length = 0 then message
    elif role message = "user" then stripUserHint message texts
    else stripToolHint message texts

let private userCanCarryHint (message: obj) : bool =
    (textPartIndex (blocks message)).IsSome

let private toolCanCarryHint (message: obj) : bool =
    blocks message |> Array.exists (fun part -> (toolField part).IsSome)

[<Emit("typeof $0 === 'number' && Number.isFinite($0)")>]
let private isFiniteNumber (_value: obj) : bool = jsNative

type private NeutralCall =
    { Part: int
      Id: string
      Tool: string
      Field: string
      ResultFor: string
      /// scope.kind when present (resetScope|keepLast|removeLast|meToo); empty otherwise.
      ScopeKind: string }

type private NeutralMessage =
    { Index: int
      Kind: string
      Operator: bool
      Side: bool
      Key: string
      Stamp: float option
      Calls: NeutralCall array
      Kinds: string array
      PartCount: int
      ResultFor: string
      ResultField: string }

let private trueField (value: obj) (name: string) : bool =
    let raw = field value name
    not (isNull raw) && jsTypeof raw = "boolean" && unbox<bool> raw

[<Emit("(() => { try { return JSON.parse($0) } catch (_) { return null } })()")>]
let private tryParseJson (_raw: string) : obj = jsNative

/// Read scope.kind from a tool part / neutral part. Accepts nested
/// `scope.kind`, `arguments.scope.kind`, `input.scope.kind`,
/// `state.input.scope.kind`, JSON-string arguments, or flat `scopeKind`.
let private scopeKindOf (value: obj) : string =
    if isNull value then ""
    else
        let fromScope (scope: obj) =
            if isNull scope then "" else fieldText scope "kind"

        let fromBag (bag: obj) =
            if isNull bag then ""
            else
                let direct = fromScope (field bag "scope")
                if direct <> "" then direct
                else
                    // Flat equivalent: scopeKind / "scope.kind" key if a host flattened it.
                    let flat = fieldText bag "scopeKind"
                    if flat <> "" then flat
                    else fieldText bag "scope.kind"

        let nested =
            let top = fromBag value
            if top <> "" then top
            else
                let args = field value "arguments"
                let fromArgs =
                    if isNull args then ""
                    elif jsTypeof args = "string" then fromBag (tryParseJson (unbox<string> args))
                    else fromBag args
                if fromArgs <> "" then fromArgs
                else
                    let input = field value "input"
                    let fromInput = fromBag input
                    if fromInput <> "" then fromInput
                    else
                        let state = field value "state"
                        if isNull state then ""
                        else
                            let stateInput = field state "input"
                            let fromState = fromBag stateInput
                            if fromState <> "" then fromState
                            else fromBag state
        nested

let private neutralCall (index: int) (value: obj) : NeutralCall =
    { Part = index
      Id = fieldText value "id"
      Tool = fieldText value "tool"
      Field = fieldText value "terminalField"
      ResultFor = fieldText value "resultFor"
      ScopeKind = scopeKindOf value }

let private neutralMessage (index: int) (value: obj) : NeutralMessage =
    let rawParts = field value "parts"
    let parts = if isArray rawParts then unbox<obj array> rawParts else [||]
    let stamp = field value "timestamp"
    { Index = index
      Kind = fieldText value "kind"
      Operator = trueField value "operator"
      Side = trueField value "sideRequest"
      Key = fieldText value "key"
      Stamp = if isFiniteNumber stamp then Some(unbox<float> stamp) else None
      Calls = parts |> Array.mapi neutralCall |> Array.filter (fun part -> (part.Id <> "" && part.Tool <> "") || part.ResultFor <> "")
      Kinds = parts |> Array.map (fun part -> fieldText part "type")
      PartCount = parts.Length
      ResultFor = fieldText value "resultFor"
      ResultField = fieldText value "resultField" }

let private neutralIsReset (part: NeutralCall) : bool =
    // Transition: legacy standalone tool name still counts; preferred signal is
    // scope.kind=resetScope on any tool call (and its paired result via id).
    part.Tool = ResetTool || part.ScopeKind = "resetScope"

let private isAlwaysRetained (part: NeutralCall) : bool =
    match part.Tool with
    | "resetScope" | "assume" | "negotiate" | "askPreviousScope" | "askPrevious" | "advisor" -> true
    | _ -> part.ScopeKind = "resetScope"

/// Thinking is the model's scratch reasoning for a scope that is now finished;
/// it is retired with that scope. Assistant prose and provider bytes stay.
let private isThinking (kind: string) : bool = kind = "reasoning" || kind = "thinking"

let private retainedPartIndices (parts: NeutralCall array) : int array =
    let retainedIds =
        parts
        |> Array.filter isAlwaysRetained
        |> Array.map _.Id
        |> Set.ofArray
    parts
    |> Array.choose (fun item ->
        if isAlwaysRetained item || (item.ResultFor <> "" && Set.contains item.ResultFor retainedIds) then
            Some item.Part
        else None)

let private latestReset (messages: NeutralMessage array) : (int * int) option =
    let mutable barrier = None
    for message in messages do
        if message.Kind = "assistant" then
            for part in message.Calls do
                if neutralIsReset part then barrier <- Some(message.Index, part.Part)
    barrier

let private neutralSelection (message: NeutralMessage) (barrier: (int * int) option) (retainedIds: Set<string>) : int array option option =
    match barrier with
    | None -> Some None
    | Some(activeMessage, _) when message.Index > activeMessage -> Some None
    | Some(activeMessage, activePart) when message.Index = activeMessage ->
        let retained = retainedPartIndices message.Calls |> Set.ofArray
        let keep = [| for index in 0 .. message.PartCount - 1 do
                           if index >= activePart || Set.contains index retained then yield index |]
        Some(Some keep)
    | Some _ when message.Operator && (message.Kind = "user" || message.Kind = "custom") -> Some None
    | Some _ when message.Kind = "result" -> Some None
    | Some _ when message.Kind = "assistant" ->
        let ordinaryToolParts =
            message.Calls
            |> Array.choose (fun call ->
                if call.Id <> "" && call.Tool <> "" && not (isAlwaysRetained call) then Some call.Part
                elif call.ResultFor <> "" && not (Set.contains call.ResultFor retainedIds) then Some call.Part
                else None)
            |> Set.ofArray
        let retiredThinking =
            message.Kinds |> Array.indexed |> Array.filter (snd >> isThinking) |> Array.map fst |> Set.ofArray
        let preserved =
            [| for part in 0 .. message.PartCount - 1 do
                   if not (Set.contains part ordinaryToolParts) && not (Set.contains part retiredThinking) then
                       yield part |]
        if preserved.Length = 0 then None else Some(Some preserved)
    | _ -> None

let private candidateSelections (messages: NeutralMessage array) (barrier: (int * int) option) =
    let retainedIds =
        messages
        |> Array.collect (fun message -> message.Calls)
        |> Array.filter isAlwaysRetained
        |> Array.map (fun call -> call.Id)
        |> Set.ofArray
    messages |> Array.map (fun m -> m, neutralSelection m barrier retainedIds)

let private allowedCalls (candidates: (NeutralMessage * int array option option) array) : Dictionary<string, string> =
    let known = Dictionary<string, string>()
    for message, selected in candidates do
        if message.Kind = "assistant" then
            match selected with
            | None -> ()
            | Some partIndices ->
                for call in message.Calls do
                    if call.Id <> "" && call.Tool <> "" && (partIndices.IsNone || Array.contains call.Part partIndices.Value) then
                        known[call.Id] <- call.Tool
    known

let private selectResult (known: Dictionary<string, string>) (barrier: (int * int) option) (message: NeutralMessage) =
    if message.Kind <> "result" then true
    else
        match barrier with
        | None -> true
        | Some(active, _) when message.Index < active ->
            message.ResultFor <> "" && known.ContainsKey(message.ResultFor)
        | Some _ -> message.ResultFor = "" || known.ContainsKey(message.ResultFor)

let private isSelected (known: Dictionary<string, string>) barrier (message, partIndices) =
    match partIndices with
    | None -> false
    | Some _ -> selectResult known barrier message

let private slotOf (message: NeutralMessage) (selection: int array option) =
    createObj
        [ "index" ==> message.Index
          "parts" ==> (match selection with Some indexes -> box indexes | None -> null) ]

let private toolHint (scope: ScopeSession) (remember: bool) (identity: string) (index: int) (part: int) (fieldName: string) (proposed: string) =
    let suffix = scope.TerminalTail(identity, proposed, remember)
    createObj
        [ "kind" ==> "tool"
          "index" ==> index
          "part" ==> part
          "field" ==> fieldName
          "tail" ==> suffix ]

let private hintsAt (_scope: ScopeSession) (_remember: bool) (_message: NeutralMessage) (_selectedParts: int array option) =
    [||] : obj array

let private neutralSelections (entries: NeutralMessage array) =
    let barrier = latestReset entries
    let candidates = candidateSelections entries barrier
    let known = allowedCalls candidates
    let retained = candidates |> Array.filter (isSelected known barrier)
    retained, known

let private neutralFilterPlan (messages: obj) : obj =
    let entries = asArray messages |> Array.mapi neutralMessage
    let retained, _ = neutralSelections entries
    retained
    |> Array.choose (fun (message, partIndices) -> partIndices |> Option.map (slotOf message))
    |> box

let private preparedNeutralPlan (scope: ScopeSession) (language: string) (messages: obj) : obj =
    let entries = asArray messages |> Array.mapi neutralMessage
    let lastOperator = entries |> Array.tryFindIndexBack (fun m -> m.Kind = "user" && m.Operator)
    let selected, _known, weak, active, sideRequest =
        match lastOperator with
        | None ->
            let retained = entries |> Array.map (fun m -> m, Some None)
            retained, allowedCalls retained, false, false, false
        | Some latest ->
            let hasReset =
                entries |> Array.exists (fun m -> m.Kind = "assistant" && Array.exists neutralIsReset m.Calls)
            let prompt = entries[latest]
            let sideRequest = entries.Length > 0 && entries[entries.Length - 1].Side
            if not sideRequest then scope.Observe(prompt.Key, prompt.Stamp, hasReset)
            let retained, known = neutralSelections entries
            let alreadySteered = entries.Length > 0 && entries[entries.Length - 1].Kind = "user" && not entries[entries.Length - 1].Operator && not entries[entries.Length - 1].Side
            retained, known, scope.Initialized && scope.BudgetKnown && not scope.IsPending && scope.Budget = 0 && not sideRequest && not alreadySteered, true, sideRequest
    let slots =
        selected |> Array.choose (fun (m, selection) -> selection |> Option.map (slotOf m))
    let tails =
        if not active then [||]
        else
            selected
            |> Array.collect (fun (m, selection) ->
                match selection with
                | Some partIndices -> hintsAt scope (not sideRequest) m partIndices
                | None -> [||])
    createObj
        [ "slots" ==> slots
          "hints" ==> tails
          "strong" ==> (if active && not sideRequest && scope.IsPending then
                               box (match scope.PendingKind with
                                    | "negotiate" -> negotiateReminder language
                                    | "askPreviousScope" -> askPreviousScopeReminder language
                                    | _ -> "")
                           else null)
          "weak" ==> null
          "active" ==> active
          "budget" ==> scope.Budget
          "budgetKnown" ==> scope.BudgetKnown
          "initialized" ==> scope.Initialized
          "negotiationRequired" ==> scope.NegotiationRequired
          "pendingKind" ==> scope.PendingKind
          "previousScopePending" ==> scope.PreviousScopePending ]

let private isResetWirePart (part: obj) =
    let direct = fieldText part "tool"
    let name = if direct <> "" then direct else fieldText part "name"
    let kind = fieldText part "type"
    let toolShape = kind = "tool" || kind = "toolCall" || kind = "tool-call" || kind = "tool_call" || kind = ""
    // Legacy tool name OR any tool call carrying scope.kind=resetScope.
    toolShape && (name = "resetScope" || scopeKindOf part = "resetScope")

let private precedingScopeMessages (messages: obj array) : obj array option =
    let resets =
        messages
        |> Array.mapi (fun i message ->
            if role message <> "assistant" then None
            else blocks message |> Array.tryFindIndexBack isResetWirePart |> Option.map (fun j -> i, j))
        |> Array.choose id
    match Array.tryLast resets with
    | None -> None
    | Some (index, partIndex) ->
        let before = messages |> Array.take index
        let resetMessage = messages[index]
        let earlier = blocks resetMessage |> Array.take partIndex
        let projected =
            if earlier.Length = 0 then before
            elif hasParts resetMessage then Array.append before [| withParts resetMessage earlier |]
            else Array.append before [| withContent resetMessage (box earlier) |]
        if projected.Length = 0 then None else Some projected

[<Emit("structuredClone($0)")>]
let private cloneWire (_value: obj) : obj = jsNative

let PairHint () : PairHintMessages =
    let sessions = Dictionary<string, ScopeSession>()
    let bindings = Dictionary<string, string * int>()
    let questionsByReceipt = Dictionary<string, string * string * int * string>()
    let previousScopeQuestions = Dictionary<string, string * string>()
    let preparedReplies = HashSet<string>()
    let preparedPreviousReplies = HashSet<string>()
    let confirmedPreviousReplies = HashSet<string>()
    let mutable nextGeneration = 0
    let mutable nextReceipt = 0
    let mutable nextAskReceipt = 0
    let temporaryNegotiations = Dictionary<string, obj>()
    let temporaryToolViolations = Dictionary<string, int>()
    // One replaceable view per actual work session; temporary sessions retain only source identity.
    let latestViews = Dictionary<string, obj>()
    let viewFor sessionId =
        match latestViews.TryGetValue sessionId with
        | true, view -> view
        | _ -> createObj []
    let updateView sessionId (updates: (string * obj) list) =
        if not (temporaryNegotiations.ContainsKey sessionId) then
            let view = copy(viewFor sessionId)
            for name, value in updates do view?(name) <- value
            latestViews[sessionId] <- view
    let observedMessages (sessionId: string) (preferInput: bool) : obj array option =
        match latestViews.TryGetValue sessionId with
        | false, _ -> None
        | true, view ->
            let preferred = if preferInput then field view "input" else field view "output"
            if isArray preferred then Some(unbox<obj array> preferred)
            else None


    let rememberSystem (sessionId: string) (system: string array) =
        if not (isNull(box system)) then updateView sessionId [ "system", cloneWire(box system) ]

    let rememberMessages (sessionId: string) (messages: obj array) =
        if not (isNull(box messages)) && messages.Length > 0 then
            updateView sessionId [ "output", cloneWire(box messages); "input", cloneWire(box messages) ]

    let rememberTransform (sessionId: string) (input: obj array) (output: obj array) =
        if not (isNull(box input)) && not (isNull(box output)) && output.Length > 0 then
            updateView sessionId [ "input", cloneWire(box input); "output", cloneWire(box output) ]

    let rememberModel (sessionId: string) (model: obj) =
        if not (isNull model) then updateView sessionId [ "model", cloneWire model ]

    let modelFor (sessionId: string) : obj =
        let model = field (viewFor sessionId) "model"
        if isNull model then null else cloneWire model

    let latestPrevious (sessionId: string) : obj =
        let candidate =
            observedMessages sessionId true
            |> Option.bind precedingScopeMessages
        candidate |> Option.map (fun old -> box(cloneWire(box old))) |> Option.defaultValue null

    let startTemporary (tempId: string) (delegatorId: string) : obj =
        let view = viewFor delegatorId
        let messages = field view "output"
        let system = field view "system"
        let model = field view "model"
        if isArray messages && (unbox<obj array> messages).Length > 0 && isArray system && (unbox<obj array> system).Length > 0 && not (isNull model) then
            // The temporary session keeps an identity link only; read the latest
            // actual delegator provider view on every temporary provider hook.
            temporaryNegotiations[tempId] <- createObj [ "liveDelegator", box delegatorId ]
            createObj [ "ok" ==> true ]
        else
            createObj
                [ "ok" ==> false
                  "reason" ==> "delegator has no complete latest transform view (messages, system and model)" ]

    let startTemporaryPrevious (tempId: string) (sourceSessionId: string) (metadata: obj) : obj =
        let oldModel = if isNull metadata then null else metadata?model
        let oldSystem = if isNull metadata then null else metadata?system
        let oldMessages = if isNull metadata then null else metadata?messages
        // The previous Scope is asked through its own equivalent view: the sealed
        // provider view the old Scope actually sent (already projected, retained
        // and within the window it was accepted under). The raw Host history before
        // the last reset is not that view; it grows with every earlier Scope.
        if isNull oldModel || not (isArray oldSystem) then
            createObj [ "ok" ==> false; "reason" ==> "no verified old Scope system and model evidence" ]
        elif not (isArray oldMessages) || (unbox<obj array> oldMessages).Length = 0 then
            createObj [ "ok" ==> false; "reason" ==> "no verified old Scope equivalent provider view" ]
        else
            temporaryNegotiations[tempId] <-
                createObj [ "previousDelegator", box sourceSessionId
                            "system", cloneWire oldSystem
                            "model", cloneWire oldModel
                            "messages", cloneWire oldMessages ]
            createObj [ "ok" ==> true ]

    let modelForTemporary (tempId: string) : obj =
        match temporaryNegotiations.TryGetValue tempId with
        | true, view when not (isNull view?liveDelegator) -> modelFor (string view?liveDelegator)
        | true, view -> cloneWire view?model
        | _ -> null

    let isTemporary (sessionId: string) : bool =
        temporaryNegotiations.ContainsKey sessionId

    let finishTemporary (tempId: string) =
        temporaryNegotiations.Remove tempId |> ignore
        temporaryToolViolations.Remove tempId |> ignore

    let recordToolViolation (tempId: string) =
        if temporaryNegotiations.ContainsKey tempId then
            match temporaryToolViolations.TryGetValue tempId with
            | true, count -> temporaryToolViolations[tempId] <- count + 1
            | false, _ -> temporaryToolViolations[tempId] <- 1

    let toolViolationCount (tempId: string) : int =
        match temporaryToolViolations.TryGetValue tempId with
        | true, count -> count
        | false, _ -> 0

    let projectSystem (tempId: string) (_system: string array) : obj =
        match temporaryNegotiations.TryGetValue tempId with
        | true, view when not (isNull view?liveDelegator) ->
            let latest = field (viewFor(string view?liveDelegator)) "system"
            if isNull latest then null else cloneWire latest
        | true, view -> cloneWire view?system
        | false, _ -> null

    let projectMessages (tempId: string) (question: obj) : obj =
        let latest =
            match temporaryNegotiations.TryGetValue tempId with
            | true, view when not (isNull view?previousDelegator) -> Some(cloneWire view?messages)
            | true, view when not (isNull view?liveDelegator) ->
                observedMessages (string view?liveDelegator) false
                |> Option.map (fun output -> cloneWire(box output))
            | true, view -> Some(cloneWire view?messages)
            | false, _ -> None
        match latest with
        | Some prefix -> box (Array.append (unbox<obj array> prefix) [| cloneWire question |])
        | None -> null

    let current (sessionId: string) : ScopeSession =
        match sessions.TryGetValue sessionId with
        | true, scope -> scope
        | false, _ ->
            let scope = ScopeSession()
            sessions[sessionId] <- scope
            scope

    let discardForRecipient (recipient: string) =
        let abandoned =
            questionsByReceipt
            |> Seq.choose (fun item ->
                let (owner, _, _, _) = item.Value
                if owner = recipient then Some item.Key else None)
            |> Seq.toArray
        for receipt in abandoned do
            questionsByReceipt.Remove receipt |> ignore
            preparedReplies.Remove receipt |> ignore

    let forgetSession (sessionId: string) =
        sessions.Remove sessionId |> ignore
        bindings.Remove sessionId |> ignore
        discardForRecipient sessionId
        let abandonedAsks =
            previousScopeQuestions
            |> Seq.choose (fun item ->
                let (owner, _) = item.Value
                if owner = sessionId then Some item.Key else None)
            |> Seq.toArray
        for r in abandonedAsks do
            previousScopeQuestions.Remove r |> ignore
            preparedPreviousReplies.Remove r |> ignore
            confirmedPreviousReplies.Remove r |> ignore
        latestViews.Remove sessionId |> ignore
        temporaryNegotiations.Remove sessionId |> ignore
        temporaryToolViolations.Remove sessionId |> ignore

    let bind (recipient: string) (delegator: string) =
        match bindings.TryGetValue recipient with
        | true, (existing, _) when existing = delegator -> ()
        | _ ->
            discardForRecipient recipient
            nextGeneration <- nextGeneration + 1
            bindings[recipient] <- delegator, nextGeneration
            (current recipient).BeginNegotiation()

    let ask (recipient: string) (questions: string) (language: string) : obj =
        match bindings.TryGetValue recipient with
        | false, _ -> createObj [ "ok" ==> false; "reason" ==> (if isChinese language then "不是受委托会话" else "not a delegated session") ]
        | true, (delegator, generation) when String.IsNullOrWhiteSpace questions ->
            createObj [ "ok" ==> false; "reason" ==> (if isChinese language then "questions 不得为空" else "questions must not be blank") ]
        | true, (delegator, generation) ->
            nextReceipt <- nextReceipt + 1
            let receipt = recipient + ":" + string generation + ":" + string nextReceipt
            questionsByReceipt[receipt] <- recipient, delegator, generation, questions
            // 受理即完成：首次协商被受理即解除 pending，时序继续；答复 steer 只是迟到的内容，不再门控 resetScope。
            let scope = current recipient
            let first = scope.NegotiationRequired
            if first then scope.NegotiationReplyAdmitted()
            createObj [ "ok" ==> true; "receipt" ==> receipt; "delegator" ==> delegator; "questions" ==> questions; "first" ==> first ]

    let prepare (receipt: string) (answer: string) (language: string) : obj =
        match questionsByReceipt.TryGetValue receipt with
        | false, _ -> createObj [ "ok" ==> false; "reason" ==> (if isChinese language then "未知或已结算的协商" else "unknown or settled negotiation") ]
        | true, (recipient, delegator, generation, _) ->
            match bindings.TryGetValue recipient with
            | true, (_, activeGeneration) when activeGeneration = generation && not (String.IsNullOrWhiteSpace answer) ->
                preparedReplies.Add receipt |> ignore
                createObj [ "ok" ==> true; "recipient" ==> recipient; "steer" ==> ((if isChinese language then "委托者已回答 negotiate(questions)：\n" else "Delegator answered negotiate(questions):\n") + answer); "first" ==> (current recipient).NegotiationRequired ]
            | _ -> createObj [ "ok" ==> false; "reason" ==> (if isChinese language then "委托代际已过期或答复为空" else "stale delegation or empty reply") ]

    let complete (receipt: string) =
        match questionsByReceipt.TryGetValue receipt with
        | false, _ -> false
        | true, (recipient, delegator, generation, _) ->
            match bindings.TryGetValue recipient with
            | true, (_, activeGeneration) when activeGeneration = generation && preparedReplies.Contains receipt ->
                questionsByReceipt.Remove receipt |> ignore
                preparedReplies.Remove receipt |> ignore
                if (current recipient).NegotiationRequired then (current recipient).NegotiationReplyAdmitted()
                true
            | _ -> false

    let confirm (receipt: string) (recipient: string) =
        match questionsByReceipt.TryGetValue receipt with
        | true, (owner, _, _, _) when owner = recipient && preparedReplies.Contains receipt -> complete receipt
        | _ -> false

    let askPreviousScope (sessionId: string) (questions: string) (providedReceipt: string option) : obj =
        let scope = current sessionId
        if scope.NegotiationRequired then
            createObj [ "ok" ==> false; "reason" ==> "negotiation is required before scope operations" ]
        elif not scope.HasPreviousScope then
            createObj [ "ok" ==> false; "reason" ==> "NoPreviousScope" ]
        elif String.IsNullOrWhiteSpace questions then
            createObj [ "ok" ==> false; "reason" ==> "questions must not be blank" ]
        else
            let receipt =
                match providedReceipt with
                | Some r when not (String.IsNullOrWhiteSpace r) -> r
                | _ ->
                    nextAskReceipt <- nextAskReceipt + 1
                    sessionId + ":ask:" + string nextAskReceipt
            match previousScopeQuestions.TryGetValue receipt with
            | true, (owner, sameQuestions) when owner = sessionId && sameQuestions = questions ->
                createObj [ "ok" ==> true; "receipt" ==> receipt; "replayed" ==> true; "first" ==> false ]
            | true, _ ->
                createObj [ "ok" ==> false; "reason" ==> "receipt already belongs to different questions" ]
            | false, _ ->
                previousScopeQuestions[receipt] <- sessionId, questions
                let first = scope.PreviousScopePending
                if first then scope.AskPreviousScopeAdmitted()
                createObj [ "ok" ==> true; "receipt" ==> receipt; "first" ==> first ]

    let preparePreviousScopeReply (receipt: string) (sessionId: string) (answer: string) (language: string) : obj =
        match previousScopeQuestions.TryGetValue receipt with
        | true, (owner, _) when owner = sessionId && not (String.IsNullOrWhiteSpace answer) && not (confirmedPreviousReplies.Contains receipt) ->
            preparedPreviousReplies.Add receipt |> ignore
            let origin = if isChinese language then "前一 Scope 的答复：\n" else "Previous Scope answered askPreviousScope(questions):\n"
            createObj [ "ok" ==> true; "recipient" ==> sessionId; "steer" ==> (origin + answer) ]
        | _ -> createObj [ "ok" ==> false; "reason" ==> "stale scope inquiry or empty answer" ]

    let confirmPreviousScopeSteer (receipt: string) (sessionId: string) : bool =
        match previousScopeQuestions.TryGetValue receipt with
        | true, (owner, _) when owner = sessionId && preparedPreviousReplies.Contains receipt && not (confirmedPreviousReplies.Contains receipt) ->
            preparedPreviousReplies.Remove receipt |> ignore
            confirmedPreviousReplies.Add receipt |> ignore
            true
        | _ -> false

    { new PairHintMessages with
        member _.isUnchanged(left, right) = sameElements left right
        member _.budgetSuffix(budget) = budgetSuffix budget
        member _.adjustBudgetForKpi(estimatedNextScopeBudget, kpiCompletion) =
            kpiAdjustedBudget estimatedNextScopeBudget kpiCompletion
        member _.turnBudget(sessionId) = (current sessionId).Budget
        member _.setRetention(sessionId, remaining) = (current sessionId).SetRetention remaining
        member _.isInitialized(sessionId) = (current sessionId).Initialized
        member _.startTurn(sessionId) = (current sessionId).StartTurn()
        member _.resetSession(sessionId, budget) = (current sessionId).Reset(budget)
        member _.clearSession(sessionId) = forgetSession sessionId
        member _.writeUserHint(message, texts) = writeUserHint message texts
        member _.writeToolResultHint(message, texts) = writeToolResultHint message texts
        member _.stripKnownHints(message, texts) = stripKnownHints message texts
        member _.userCanCarryHint(message) = userCanCarryHint message
        member _.toolCanCarryHint(message) = toolCanCarryHint message
        member _.planRequest(sessionId, messages, language) = preparedNeutralPlan (current sessionId) language messages
        member _.planFilter(messages) = neutralFilterPlan messages
        member _.bindDelegation(recipient, delegator) = bind recipient delegator
        member _.askNegotiation(recipient, questions, language) = ask recipient questions language
        member _.prepareNegotiationReply(receipt, answer, language) = prepare receipt answer language
        member _.completeNegotiationReply(receipt) = complete receipt
        member _.confirmNegotiationSteer(receipt, recipient) = confirm receipt recipient
        member _.negotiationRequired(recipient) = (current recipient).NegotiationRequired
        member _.rememberSystem(sessionId, system) = rememberSystem sessionId system
        member _.rememberMessages(sessionId, messages) = rememberMessages sessionId messages
        member _.rememberTransform(sessionId, input, output) = rememberTransform sessionId input output
        member _.latestPrevious(sessionId) = latestPrevious sessionId
        member _.rememberModel(sessionId, model) = rememberModel sessionId model
        member _.modelFor(sessionId) = modelFor sessionId
        member _.startTemporary(tempId, delegatorId) = startTemporary tempId delegatorId
        member _.startTemporaryPrevious(tempId, sourceSessionId, metadata) = startTemporaryPrevious tempId sourceSessionId metadata
        member _.projectPreviousMessages(messages) = precedingScopeMessages messages |> Option.map box |> Option.defaultValue null
        member _.modelForTemporary(tempId) = modelForTemporary tempId
        member _.isTemporary(sessionId) = isTemporary sessionId
        member _.finishTemporary(tempId) = finishTemporary tempId
        member _.recordToolViolation(tempId) = recordToolViolation tempId
        member _.toolViolationCount(tempId) = toolViolationCount tempId
        member _.forgetSession(sessionId) = forgetSession sessionId
        member _.projectSystem(tempId, system) = projectSystem tempId system
        member _.projectMessages(tempId, question) = projectMessages tempId question
        member _.appendTailOnce(content, suffix) =
            appendOnce content suffix (fun current -> current.StartsWith(suffix, StringComparison.Ordinal))
        member _.pendingKind(sessionId) = (current sessionId).PendingKind
        member _.isPreviousScopePending(sessionId) = (current sessionId).PreviousScopePending
        member _.hasPreviousScope(sessionId) = (current sessionId).HasPreviousScope
        member _.setHasPreviousScope(sessionId, value) = (current sessionId).HasPreviousScope <- value
        member _.beginAskPreviousScope(sessionId) = (current sessionId).BeginAskPreviousScope()
        member _.askPreviousScope(sessionId, questions, ?receipt) = askPreviousScope sessionId questions receipt
        member _.preparePreviousScopeReply(receipt, sessionId, answer, language) = preparePreviousScopeReply receipt sessionId answer language
        member _.confirmPreviousScopeSteer(receipt, sessionId) = confirmPreviousScopeSteer receipt sessionId }
