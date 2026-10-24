module Wanxiangli.PairHint.PairHint

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type PairHintMessages =
    abstract isUnchanged: left: obj array * right: obj array -> bool
    abstract budgetSuffix: budget: int -> string
    abstract turnBudget: sessionId: string -> int
    abstract isInitialized: sessionId: string -> bool
    abstract startTurn: sessionId: string -> unit
    abstract resetSession: sessionId: string * budget: int -> unit
    abstract clearSession: sessionId: string -> unit
    abstract writeUserHint: message: obj * texts: string array -> obj
    abstract writeToolResultHint: message: obj * texts: string array -> obj
    abstract stripKnownHints: message: obj * texts: string array -> obj
    abstract userCanCarryHint: message: obj -> bool
    abstract toolCanCarryHint: message: obj -> bool
    abstract planRequest: sessionId: string * neutralMessages: obj -> obj
    abstract planFilter: neutralMessages: obj -> obj
    abstract appendTailOnce: content: obj * tail: string -> obj
    abstract bindDelegation: recipient: string * delegator: string -> unit
    abstract askNegotiation: recipient: string * questions: string -> obj
    abstract prepareNegotiationReply: receipt: string * answer: string -> obj
    abstract completeNegotiationReply: receipt: string -> bool
    abstract confirmNegotiationSteer: receipt: string * recipient: string -> bool
    abstract negotiationRequired: recipient: string -> bool
    abstract rememberModel: sessionId: string * model: obj -> unit
    abstract modelFor: sessionId: string -> obj
    abstract rememberSystem: sessionId: string * system: string array -> unit
    abstract rememberMessages: sessionId: string * messages: obj array -> unit
    abstract startTemporary: temporaryId: string * delegatorId: string -> obj
    abstract finishTemporary: temporaryId: string -> unit
    abstract isTemporary: sessionId: string -> bool
    abstract recordToolViolation: sessionId: string -> unit
    abstract toolViolationCount: sessionId: string -> int
    abstract projectSystem: sessionId: string -> string array
    abstract projectMessages: sessionId: string * question: obj -> obj array

type private ScopeSession() =
    let mutable budget = 0
    let mutable initialized = false
    let mutable promptKey = ""
    let mutable promptTime: float option = None
    let toolTails = Dictionary<string, string>()
    let mutable negotiateFirst = false

    member _.Budget = budget
    member _.Initialized = initialized
    member _.NegotiationRequired = negotiateFirst
    member _.BeginNegotiation() = negotiateFirst <- true; budget <- 0; initialized <- false
    member _.NegotiationReplyAdmitted() = negotiateFirst <- false; budget <- 0; initialized <- false

    member _.StartTurn() = budget <- max 0 (budget - 1)

    member _.Observe(nextKey: string, nextTime: float option, hasReset: bool) =
        if promptKey = nextKey then
            initialized <- initialized || hasReset
        elif promptTime.IsNone || nextTime.IsNone || nextTime.Value >= promptTime.Value then
            promptKey <- nextKey
            promptTime <- nextTime
            initialized <- hasReset
            budget <- 0

    member _.MarkInitialized(value: bool) = initialized <- value

    /// Once displayed, a terminal result is immutable within its prefix epoch.
    member _.TerminalTail(identity: string, proposed: string, remember: bool) =
        match toolTails.TryGetValue identity with
        | true, earlier -> earlier
        | false, _ ->
            if remember then toolTails[identity] <- proposed
            proposed

    member _.Reset(nextBudget: int) =
        budget <- max 0 nextBudget
        initialized <- true
        toolTails.Clear()

[<Literal>]
let private Separator = "\u0000\uFEFF"

[<Literal>]
let private ResetTool = "resetScope"

[<Literal>]
let private InitializeReminder =
    "[System: Estimate the turnBudget for the first fine-grained task block (state closed-loop). Then call resetScope immediately, before doing anything else.]"

[<Literal>]
let private NegotiateReminder =
    "[System: Before any resetScope initialization, call negotiate(questions: string) NOW. Ask the delegator all questions needed to clarify this assignment. Group related questions into the single plural questions argument. The call acknowledges sending immediately; continue your work without waiting. Until the delegator’s answer arrives as a user steer, do not call resetScope. After that answer, call resetScope promptly. You may negotiate again at any time; later calls never delay resetScope.]"

[<Literal>]
let private WeakReminder =
    "[System: Weak, optional reminder — this scope's turnBudget is exhausted (0 remaining). If you are not busy and at a natural boundary, consider calling resetScope with a fresh budget. Do not interrupt, pause, or abandon your current work for this reminder. Keep going; reset when convenient.]"

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

let private budgetSuffix (budget: int) = $"[Remaining turnBudget: %d{max 0 budget}]"

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

[<Emit("structuredClone($0)")>]
let private deepCopy (_value: obj) : obj = jsNative

/// Provider-wire snapshot of the delegator that a temporary negotiation may reuse.
type private NegotiationView =
    { Delegator: string
      Messages: obj array
      System: string array }

/// 临时协商会话的物理载体快照：只保存委托者最后一次出站请求的只读副本。
type private NegotiationWire() =
    let observedMessages = Dictionary<string, obj array>()
    let observedSystems = Dictionary<string, string array>()
    let observedModels = Dictionary<string, obj>()
    let temporaries = Dictionary<string, NegotiationView>()
    let violations = Dictionary<string, int>()

    member _.RememberModel(sessionId: string, model: obj) =
        if not (temporaries.ContainsKey sessionId) then
            observedModels[sessionId] <- deepCopy model

    member _.ModelFor(sessionId: string) : obj =
        match observedModels.TryGetValue sessionId with
        | true, model -> deepCopy model
        | false, _ -> null

    member _.RememberSystem(sessionId: string, system: string array) =
        if not (temporaries.ContainsKey sessionId) then
            observedSystems[sessionId] <- unbox<string array> (deepCopy (box system))

    member _.RememberMessages(sessionId: string, messages: obj array) =
        if not (temporaries.ContainsKey sessionId) then
            observedMessages[sessionId] <- unbox<obj array> (deepCopy (box messages))

    member _.StartTemporary(temporaryId: string, delegatorId: string) : obj =
        match
            observedMessages.TryGetValue delegatorId,
            observedSystems.TryGetValue delegatorId,
            observedModels.TryGetValue delegatorId
        with
        | (true, messages), (true, system), (true, _) when messages.Length > 0 && system.Length > 0 ->
            temporaries[temporaryId] <-
                { Delegator = delegatorId
                  Messages = unbox<obj array> (deepCopy (box messages))
                  System = unbox<string array> (deepCopy (box system)) }

            createObj [ "ok" ==> true ]
        | _ ->
            createObj [ "ok" ==> false; "reason" ==> "delegator has no complete provider-wire snapshot (messages, system and actual model) to reuse" ]

    member _.FinishTemporary(temporaryId: string) =
        temporaries.Remove temporaryId |> ignore
        violations.Remove temporaryId |> ignore

    member _.IsTemporary(sessionId: string) : bool = temporaries.ContainsKey sessionId

    member _.RecordToolViolation(sessionId: string) =
        if temporaries.ContainsKey sessionId then
            violations[sessionId] <- (match violations.TryGetValue sessionId with
                                      | true, seen -> seen + 1
                                      | false, _ -> 1)

    member _.ToolViolationCount(sessionId: string) : int =
        match violations.TryGetValue sessionId with
        | true, seen -> seen
        | false, _ -> 0

    member _.ProjectSystem(sessionId: string) : string array =
        match temporaries.TryGetValue sessionId with
        | true, view -> unbox<string array> (deepCopy (box view.System))
        | false, _ -> [||]

    /// 被复用的委托者前缀 + 唯一实际提问，作为临时会话发往模型的完整消息。
    member _.ProjectMessages(sessionId: string, question: obj) : obj array =
        match temporaries.TryGetValue sessionId with
        | true, view -> Array.append (unbox<obj array> (deepCopy (box view.Messages))) [| deepCopy question |]
        | false, _ -> [||]

    member _.ForgetSession(sessionId: string) =
        observedMessages.Remove sessionId |> ignore
        observedSystems.Remove sessionId |> ignore
        observedModels.Remove sessionId |> ignore
        temporaries.Remove sessionId |> ignore
        violations.Remove sessionId |> ignore

type private NeutralCall =
    { Part: int
      Id: string
      Tool: string
      Field: string
      ResultFor: string }

type private NeutralMessage =
    { Index: int
      Kind: string
      Operator: bool
      Side: bool
      Key: string
      Stamp: float option
      Calls: NeutralCall array
      PartCount: int
      ResultFor: string
      ResultField: string }

let private trueField (value: obj) (name: string) : bool =
    let raw = field value name
    not (isNull raw) && jsTypeof raw = "boolean" && unbox<bool> raw

let private neutralCall (index: int) (value: obj) : NeutralCall =
    { Part = index
      Id = fieldText value "id"
      Tool = fieldText value "tool"
      Field = fieldText value "terminalField"
      ResultFor = fieldText value "resultFor" }

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
      PartCount = parts.Length
      ResultFor = fieldText value "resultFor"
      ResultField = fieldText value "resultField" }

let private neutralIsReset (part: NeutralCall) : bool = part.Tool = ResetTool

let private resetPartIndices (parts: NeutralCall array) : int array =
    let resets = parts |> Array.filter neutralIsReset
    let resetIds = resets |> Array.map _.Id |> Set.ofArray
    parts
    |> Array.choose (fun item ->
        if neutralIsReset item || (item.ResultFor <> "" && Set.contains item.ResultFor resetIds) then
            Some item.Part
        else None)

let private latestReset (messages: NeutralMessage array) : (int * int) option =
    let mutable barrier = None
    for message in messages do
        if message.Kind = "assistant" then
            for part in message.Calls do
                if neutralIsReset part then barrier <- Some(message.Index, part.Part)
    barrier

let private neutralSelection (message: NeutralMessage) (barrier: (int * int) option) : int array option option =
    match barrier with
    | None -> Some None
    | Some(activeMessage, activePart) when message.Index > activeMessage -> Some None
    | Some(activeMessage, activePart) when message.Index = activeMessage ->
        let resetIndices = resetPartIndices message.Calls |> Set.ofArray
        let keep = [| for index in 0 .. message.PartCount - 1 do
                           if index >= activePart || Set.contains index resetIndices then yield index |]
        Some(Some keep)
    | Some _ when message.Kind = "user" || (message.Kind = "custom" && message.Operator) -> Some None
    | Some _ when message.Kind = "result" -> Some None
    | Some _ when message.Kind = "assistant" ->
        let resetParts = resetPartIndices message.Calls
        if resetParts.Length = 0 then None else Some(Some resetParts)
    | _ -> None

let private candidateSelections (messages: NeutralMessage array) (barrier: (int * int) option) =
    messages |> Array.map (fun m -> m, neutralSelection m barrier)

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

let private tailForTool (initialized: bool) (budget: int) (toolName: string) =
    if initialized || toolName = ResetTool then budgetSuffix budget else InitializeReminder

let private toolHint (scope: ScopeSession) (remember: bool) (identity: string) (index: int) (part: int) (fieldName: string) (proposed: string) =
    let suffix = scope.TerminalTail(identity, proposed, remember)
    createObj
        [ "kind" ==> "tool"
          "index" ==> index
          "part" ==> part
          "field" ==> fieldName
          "tail" ==> suffix ]

let private userHint (scope: ScopeSession) (index: int) (key: string) (remember: bool) =
    let proposed = if scope.NegotiationRequired then NegotiateReminder else InitializeReminder
    let suffix = scope.TerminalTail("prompt:" + key, proposed, remember)
    createObj
        [ "kind" ==> "user"
          "index" ==> index
          "part" ==> -1
          "field" ==> ""
          "tail" ==> suffix ]

let private hintsAt (scope: ScopeSession) (known: Dictionary<string, string>) (remember: bool) (message: NeutralMessage) (selectedParts: int array option) =
    let initialized, budget = scope.Initialized, scope.Budget
    if message.Kind = "user" && message.Operator then
        [| userHint scope message.Index message.Key remember |]
    elif scope.NegotiationRequired then [||]
    elif message.Kind = "result" && message.ResultField <> "" then
        let name =
            if known.ContainsKey(message.ResultFor) then known[message.ResultFor] else ""
        let identity = if message.ResultFor <> "" then "call:" + message.ResultFor else "message:" + string message.Index + ":result"
        [| toolHint scope remember identity message.Index -1 message.ResultField (tailForTool initialized budget name) |]
    elif message.Kind = "assistant" then
        [| for part in message.Calls do
               if part.Field <> "" && (selectedParts.IsNone || Array.contains part.Part selectedParts.Value) then
                   let identity = if part.Id <> "" then "call:" + part.Id else "message:" + string message.Index + ":part:" + string part.Part
                   yield toolHint scope remember identity message.Index part.Part part.Field (tailForTool initialized budget part.Tool) |]
    else [||]

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

let private preparedNeutralPlan (scope: ScopeSession) (messages: obj) : obj =
    let entries = asArray messages |> Array.mapi neutralMessage
    let lastOperator = entries |> Array.tryFindIndexBack (fun m -> m.Kind = "user" && m.Operator)
    let selected, known, weak, active, sideRequest =
        match lastOperator with
        | None ->
            let retained = entries |> Array.map (fun m -> m, Some None)
            retained, allowedCalls retained, false, false, false
        | Some latest ->
            let hasReset =
                entries |> Array.skip (latest + 1)
                |> Array.exists (fun m -> m.Kind = "assistant" && Array.exists neutralIsReset m.Calls)
            let prompt = entries[latest]
            let sideRequest = entries.Length > 0 && entries[entries.Length - 1].Side
            if not sideRequest then scope.Observe(prompt.Key, prompt.Stamp, hasReset)
            let retained, known = neutralSelections entries
            let alreadySteered = entries.Length > 0 && entries[entries.Length - 1].Kind = "user" && not entries[entries.Length - 1].Operator && not entries[entries.Length - 1].Side
            retained, known, scope.Initialized && not scope.NegotiationRequired && scope.Budget = 0 && not sideRequest && not alreadySteered, true, sideRequest
    let slots =
        selected |> Array.choose (fun (m, selection) -> selection |> Option.map (slotOf m))
    let tails =
        if not active then [||]
        else
            selected
            |> Array.collect (fun (m, selection) ->
                match selection with
                | Some partIndices -> hintsAt scope known (not sideRequest) m partIndices
                | None -> [||])
    createObj
        [ "slots" ==> slots
          "hints" ==> tails
          "weak" ==> (if weak then box WeakReminder else null)
          "active" ==> active
          "budget" ==> scope.Budget
          "initialized" ==> scope.Initialized
          "negotiationRequired" ==> scope.NegotiationRequired ]

let PairHint () : PairHintMessages =
    let sessions = Dictionary<string, ScopeSession>()
    let wire = NegotiationWire()
    let bindings = Dictionary<string, string * int>()
    let questionsByReceipt = Dictionary<string, string * string * int * string>()
    let preparedReplies = HashSet<string>()
    let mutable nextGeneration = 0
    let mutable nextReceipt = 0

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

    let bind (recipient: string) (delegator: string) =
        match bindings.TryGetValue recipient with
        | true, (existing, _) when existing = delegator -> ()
        | _ ->
            discardForRecipient recipient
            nextGeneration <- nextGeneration + 1
            bindings[recipient] <- delegator, nextGeneration
            (current recipient).BeginNegotiation()

    let ask (recipient: string) (questions: string) : obj =
        match bindings.TryGetValue recipient with
        | false, _ -> createObj [ "ok" ==> false; "reason" ==> "not a delegated session" ]
        | true, (delegator, generation) when String.IsNullOrWhiteSpace questions ->
            createObj [ "ok" ==> false; "reason" ==> "questions must not be blank" ]
        | true, (delegator, generation) ->
            nextReceipt <- nextReceipt + 1
            let receipt = recipient + ":" + string generation + ":" + string nextReceipt
            questionsByReceipt[receipt] <- recipient, delegator, generation, questions
            createObj [ "ok" ==> true; "receipt" ==> receipt; "delegator" ==> delegator; "questions" ==> questions ]

    let prepare (receipt: string) (answer: string) : obj =
        match questionsByReceipt.TryGetValue receipt with
        | false, _ -> createObj [ "ok" ==> false; "reason" ==> "unknown or settled negotiation" ]
        | true, (recipient, delegator, generation, _) ->
            match bindings.TryGetValue recipient with
            | true, (_, activeGeneration) when activeGeneration = generation && not (String.IsNullOrWhiteSpace answer) ->
                preparedReplies.Add receipt |> ignore
                createObj [ "ok" ==> true; "recipient" ==> recipient; "steer" ==> ("Delegator answered negotiate(questions):\n" + answer); "first" ==> (current recipient).NegotiationRequired ]
            | _ -> createObj [ "ok" ==> false; "reason" ==> "stale delegation or empty reply" ]

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

    { new PairHintMessages with
        member _.isUnchanged(left, right) = sameElements left right
        member _.budgetSuffix(budget) = budgetSuffix budget
        member _.turnBudget(sessionId) = (current sessionId).Budget
        member _.isInitialized(sessionId) = (current sessionId).Initialized
        member _.startTurn(sessionId) = (current sessionId).StartTurn()
        member _.resetSession(sessionId, budget) = (current sessionId).Reset(budget)
        member _.clearSession(sessionId) =
            sessions.Remove sessionId |> ignore
            bindings.Remove sessionId |> ignore
            discardForRecipient sessionId
            wire.ForgetSession sessionId
        member _.writeUserHint(message, texts) = writeUserHint message texts
        member _.writeToolResultHint(message, texts) = writeToolResultHint message texts
        member _.stripKnownHints(message, texts) = stripKnownHints message texts
        member _.userCanCarryHint(message) = userCanCarryHint message
        member _.toolCanCarryHint(message) = toolCanCarryHint message
        member _.planRequest(sessionId, messages) = preparedNeutralPlan (current sessionId) messages
        member _.planFilter(messages) = neutralFilterPlan messages
        member _.bindDelegation(recipient, delegator) = bind recipient delegator
        member _.askNegotiation(recipient, questions) = ask recipient questions
        member _.prepareNegotiationReply(receipt, answer) = prepare receipt answer
        member _.completeNegotiationReply(receipt) = complete receipt
        member _.confirmNegotiationSteer(receipt, recipient) = confirm receipt recipient
        member _.negotiationRequired(recipient) = (current recipient).NegotiationRequired
        member _.rememberModel(sessionId, model) = wire.RememberModel(sessionId, model)
        member _.modelFor(sessionId) = wire.ModelFor sessionId
        member _.rememberSystem(sessionId, system) = wire.RememberSystem(sessionId, system)
        member _.rememberMessages(sessionId, messages) = wire.RememberMessages(sessionId, messages)
        member _.startTemporary(temporaryId, delegatorId) = wire.StartTemporary(temporaryId, delegatorId)
        member _.finishTemporary(temporaryId) = wire.FinishTemporary temporaryId
        member _.isTemporary(sessionId) = wire.IsTemporary sessionId
        member _.recordToolViolation(sessionId) = wire.RecordToolViolation sessionId
        member _.toolViolationCount(sessionId) = wire.ToolViolationCount sessionId
        member _.projectSystem(sessionId) = wire.ProjectSystem sessionId
        member _.projectMessages(sessionId, question) = wire.ProjectMessages(sessionId, question)
        member _.appendTailOnce(content, suffix) =
            appendOnce content suffix (fun current -> current.StartsWith(suffix, StringComparison.Ordinal)) }
