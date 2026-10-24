module Wanxiangli.PairHint.PairHint

open System
open System.Collections.Generic
open System.Text.RegularExpressions
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type PairHintMessages =
    abstract budgetSuffix: budget: int -> string
    abstract appendText: content: obj * addition: string -> obj
    abstract appendUserReminder: content: obj -> obj
    abstract appendBudgetReminder: content: obj * budget: int -> obj
    abstract injectToolResultContent: content: obj * toolName: string * initialized: bool * budget: int -> obj
    abstract initializeUserMessages: messages: obj -> obj array
    abstract injectToolResults: messages: obj * initialized: bool * budget: int -> obj array
    abstract stripContradictions: messages: obj -> obj array
    abstract filter: messages: obj -> obj array
    abstract appendWeakSteer: messages: obj -> obj array
    abstract promptKey: message: obj -> string
    abstract lastPromptIndex: messages: obj -> int
    abstract hasResetSinceLastPrompt: messages: obj -> bool
    abstract isScopePrompt: message: obj -> bool
    abstract endsWithSideRequest: messages: obj -> bool
    abstract isUnchanged: left: obj array * right: obj array -> bool
    abstract turnBudget: sessionId: string -> int
    abstract isInitialized: sessionId: string -> bool
    abstract startTurn: sessionId: string -> unit
    abstract observePrompt: sessionId: string * message: obj * hasReset: bool -> unit
    abstract setInitialized: sessionId: string * initialized: bool -> unit
    abstract resetSession: sessionId: string * budget: int -> unit
    abstract clearSession: sessionId: string -> unit
    abstract prepareRequest: sessionId: string * messages: obj * injectExistingToolResults: bool -> obj array
    abstract toolResultFor: sessionId: string * toolName: string * content: obj -> obj
    abstract writeUserHint: message: obj * texts: string array -> obj
    abstract writeToolResultHint: message: obj * texts: string array -> obj
    abstract stripKnownHints: message: obj * texts: string array -> obj
    abstract userCanCarryHint: message: obj -> bool
    abstract toolCanCarryHint: message: obj -> bool

/// 会话自己持有预算与当前用户身份。外部只发送 turn、prompt 和 reset 消息。
type private ScopeSession() =
    let mutable budget = 0
    let mutable initialized = false
    let mutable promptKey = ""
    let mutable promptTime: float option = None

    member _.Budget = budget
    member _.Initialized = initialized

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

    member _.Reset(nextBudget: int) =
        budget <- max 0 nextBudget
        initialized <- true

[<Literal>]
let private Separator = "\u0000\uFEFF"

[<Literal>]
let private ResetTool = "resetScope"

[<Literal>]
let private InitializeReminder =
    "[System: Estimate the turnBudget for the first fine-grained task block (state closed-loop). Then call resetScope immediately, before doing anything else.]"

[<Literal>]
let private WeakReminder =
    "[System: Weak, optional reminder — this scope's turnBudget is exhausted (0 remaining). If you are not busy and at a natural boundary, consider calling resetScope with a fresh budget. Do not interrupt, pause, or abandon your current work for this reminder. Keep going; reset when convenient.]"

let private BudgetPattern = Regex(@"\[Remaining turnBudget: \d+\]")
let private StripPattern = Regex(Regex.Escape Separator + @"\[Remaining turnBudget: \d+\](?=" + Regex.Escape(Separator + InitializeReminder) + ")")

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

let private attribution (message: obj) : string =
    let direct = fieldText message "attribution"
    if direct <> "" then direct else fieldText (field message "info") "attribution"

let private timestamp (message: obj) : string =
    let direct = field message "timestamp"
    if not (isNull direct) then string direct
    else
        let info = field message "info"
        let own = field info "timestamp"
        if not (isNull own) then string own
        else
            let created = field (field info "time") "created"
            if isNull created then "" else string created

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

let private messageText (message: obj) : string =
    let content = field message "content"
    if not (isNull content) then contentText content
    else contentText (box (blocks message))

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

let private appendUserReminder (content: obj) : obj =
    appendOnce content InitializeReminder (fun current -> current.StartsWith(InitializeReminder, StringComparison.Ordinal))

let private appendBudgetReminder (content: obj) (budget: int) : obj =
    appendOnce content (budgetSuffix budget) (fun current -> BudgetPattern.IsMatch current)

let private resultContent (content: obj) (name: string) (initialized: bool) (budget: int) : obj =
    if initialized || name = ResetTool then appendBudgetReminder content budget
    else appendUserReminder content

let private stripText (text: string) = StripPattern.Replace(text, "")

let private stripContent (content: obj) : obj =
    if isString content then
        let value = unbox<string> content
        if StripPattern.IsMatch value then box (stripText value) else content
    elif isArray content then
        let items = unbox<obj array> content
        let next = mapIfChanged items (fun item ->
            if not (textBlock item) then item
            else
                let value = fieldText item "text"
                if not (StripPattern.IsMatch value) then item
                else
                    let updated = copy item
                    updated?text <- stripText value
                    updated)
        if sameElements items next then content else box next
    else content

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

let private rewriteAssistant (message: obj) (items: obj array) : obj =
    let changed =
        if hasParts message then withParts message items
        else withContent message (box items)
    emitJsStatement changed "delete $0.providerPayload; delete $0.responseId"
    changed

let private isScopePrompt (message: obj) : bool =
    role message = "user" && attribution message <> "agent"

let private isPreservedUserMessage (message: obj) : bool =
    role message = "user" || (role message = "custom" && attribution message = "user")

let private isToolRole (value: string) : bool =
    value = "toolResult" || value = "tool" || value = "tool_result" || value = "tool-result"

let private isToolBlock (part: obj) : bool =
    match fieldText part "type" with
    | "tool" | "toolCall" | "tool-call" | "tool_call" -> true
    | _ -> false

let private toolName (part: obj) : string =
    let direct = fieldText part "name"
    if direct <> "" then direct
    else
        let opencode = fieldText part "tool"
        if opencode <> "" then opencode else fieldText part "toolName"

let private isResetCall (part: obj) : bool = isToolBlock part && toolName part = ResetTool

let private callId (part: obj) : string option =
    [ "id"; "toolCallId"; "callID"; "callId" ]
    |> List.tryPick (fun key ->
        let value = field part key
        if isString value && not (String.IsNullOrEmpty(unbox<string> value)) then Some(unbox<string> value) else None)

let private resultId (message: obj) : string option =
    let named =
        [ "toolCallId"; "callID"; "callId" ]
        |> List.tryPick (fun key ->
            let v = field message key
            if isString v then Some(unbox<string> v) else None)
    match named with
    | Some value -> Some value
    | None -> blocks message |> Array.tryPick (fun part -> if isToolRole (fieldText part "type") then callId part else None)

let private lastReset (messages: obj array) : (int * int) option =
    let mutable found = None
    for i = 0 to messages.Length - 1 do
        if role messages.[i] = "assistant" then
            let items = blocks messages.[i]
            for j = 0 to items.Length - 1 do
                if isResetCall items.[j] then found <- Some(i, j)
    found

let private filterMessages (messages: obj) : obj array =
    let source = asArray messages
    match lastReset source with
    | None -> source
    | Some(activeMessage, activePart) ->
        let rewritten = Dictionary<int, obj>()
        for i = 0 to activeMessage - 1 do
            let message = source.[i]
            if role message = "assistant" then
                let kept = blocks message |> Array.filter isResetCall
                if kept.Length > 0 then rewritten.[i] <- rewriteAssistant message kept
        let boundary = source.[activeMessage]
        let part = blocks boundary
        let retained = part |> Array.mapi (fun index value -> index, value)
                            |> Array.filter (fun (index, value) -> isResetCall value || index >= activePart)
                            |> Array.map snd
        rewritten.[activeMessage] <- rewriteAssistant boundary retained

        let calls = HashSet<string>()
        for i = 0 to source.Length - 1 do
            let message = source.[i]
            if role message = "assistant" then
                let items =
                    if rewritten.ContainsKey i then blocks rewritten.[i]
                    elif i > activeMessage then blocks message
                    else [||]
                for item in items do
                    if isToolBlock item then
                        match callId item with
                        | Some id -> calls.Add id |> ignore
                        | None -> ()

        let result = ResizeArray<obj>()
        for i = 0 to source.Length - 1 do
            let message = source.[i]
            if i < activeMessage then
                if isPreservedUserMessage message then result.Add message
                elif rewritten.ContainsKey i then result.Add rewritten.[i]
                elif isToolRole (role message) then
                    match resultId message with
                    | Some id when calls.Contains id -> result.Add message
                    | _ -> ()
            elif i = activeMessage then
                result.Add rewritten.[i]
            elif isToolRole (role message) then
                match resultId message with
                | Some id when not (calls.Contains id) -> ()
                | _ -> result.Add message
            else result.Add message
        result.ToArray()

let private promptKey (message: obj) : string =
    timestamp message + ":" + messageText message

let private lastPromptIndex (messages: obj) : int =
    asArray messages |> Array.tryFindIndexBack isScopePrompt |> Option.defaultValue -1

let private hasResetSinceLastPrompt (messages: obj) : bool =
    let items = asArray messages
    let start = lastPromptIndex (box items)
    if start < 0 then false
    else items |> Array.skip (start + 1) |> Array.exists (fun message ->
        role message = "assistant" && blocks message |> Array.exists isResetCall)

let private endsWithSideRequest (messages: obj) : bool =
    let items = asArray messages
    if items.Length = 0 then false
    else
        let last = items.[items.Length - 1]
        role last = "user" && attribution last = "agent" && field last "steering" <> box true

let private injectUserMessage (message: obj) : obj =
    if not (isScopePrompt message) then message
    elif hasParts message then
        let items = blocks message
        let next = appendUserReminder (box items)
        if obj.ReferenceEquals(next, box items) then message else withParts message (unbox<obj array> next)
    else
        let original = field message "content"
        let next = appendUserReminder original
        if obj.ReferenceEquals(original, next) then message else withContent message next

let private initializeUserMessages (messages: obj) : obj array =
    asArray messages |> fun items -> mapIfChanged items injectUserMessage

let private cloneAndSet (objValue: obj) (key: string) (value: obj) : obj =
    let clone = copy objValue
    emitJsStatement (clone, key, value) "$0[$1] = $2"
    clone

let private suffixState (name: string) (initialized: bool) (budget: int) (state: obj) : obj =
    let status = fieldText state "status"
    if status <> "completed" && status <> "error" then state
    else
        let key =
            if isString (field state "output") then "output"
            elif isString (field state "errorText") then "errorText"
            elif isString (field state "error") then "error"
            elif status = "completed" then "output"
            else "error"
        let current = field state key
        let source = if isString current then current else box ""
        let updated = resultContent source name initialized budget
        if obj.ReferenceEquals(source, updated) then state else cloneAndSet state key updated

let private suffixToolPart (initialized: bool) (budget: int) (part: obj) : obj =
    let kind = fieldText part "type"
    if kind = "tool" && not (isNull (field part "state")) then
        let state = field part "state"
        let newState = suffixState (toolName part) initialized budget state
        if obj.ReferenceEquals(state, newState) then part else cloneAndSet part "state" newState
    elif isToolRole kind && isString (field part "text") then
        let content = field part "text"
        let updated = resultContent content (toolName part) initialized budget
        if obj.ReferenceEquals(content, updated) then part else cloneAndSet part "text" updated
    else part

let private stripToolPart (part: obj) : obj =
    let kind = fieldText part "type"
    if kind = "tool" && not (isNull (field part "state")) then
        let state = field part "state"
        let stripped =
            [ "output"; "error"; "errorText" ]
            |> List.fold (fun current key ->
                let value = field current key
                if not (isString value) || not (StripPattern.IsMatch(unbox<string> value)) then current
                else cloneAndSet current key (box (stripText (unbox<string> value)))) state
        if obj.ReferenceEquals(state, stripped) then part else cloneAndSet part "state" stripped
    elif isToolRole kind && isString (field part "text") then
        let value = fieldText part "text"
        if not (StripPattern.IsMatch value) then part else cloneAndSet part "text" (box (stripText value))
    else part

let private injectToolResultMessage (initialized: bool) (budget: int) (message: obj) : obj =
    let msgRole = role message
    let original = field message "content"
    let next =
        if isToolRole msgRole && not (isNull original) then
            resultContent original (toolName message) initialized budget
        else original
    let baseMessage =
        if obj.ReferenceEquals(original, next) then message else withContent message next
    let parts = field baseMessage "parts"
    if isArray parts then
        let current = unbox<obj array> parts
        let mapped = mapIfChanged current (suffixToolPart initialized budget)
        if sameElements current mapped then baseMessage else withParts baseMessage mapped
    else baseMessage

let private stripContradictoryMessage (message: obj) : obj =
    let source = field message "content"
    let content = if isToolRole (role message) then stripContent source else source
    let baseMessage = if obj.ReferenceEquals(source, content) then message else withContent message content
    let parts = field baseMessage "parts"
    if not (isArray parts) then baseMessage
    else
        let current = unbox<obj array> parts
        let mapped = mapIfChanged current stripToolPart
        if sameElements current mapped then baseMessage else withParts baseMessage mapped

let private appendWeakSteer (messages: obj) : obj array =
    let items = asArray messages
    let last = if items.Length > 0 then items.[items.Length - 1] else null
    let envelope = not (isNull (field last "info"))
    let steer =
        if envelope then
            let info = field last "info"
            let session = field info "sessionID"
            let freshInfo = createObj [ "role" ==> "user"; "sessionID" ==> session ]
            createObj [ "info" ==> freshInfo
                        "parts" ==> [| createObj [ "type" ==> "text"; "text" ==> WeakReminder ] |]
                        "steering" ==> true; "attribution" ==> "agent" ]
        else
            createObj [ "role" ==> "user"; "content" ==> [| createObj [ "type" ==> "text"; "text" ==> WeakReminder ] |]
                        "steering" ==> true; "attribution" ==> "agent" ]
    Array.append items [| steer |]

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

let private numericTimestamp (message: obj) : float option =
    let direct = field message "timestamp"
    let info = field message "info"
    let nested = field info "timestamp"
    let created = field (field info "time") "created"
    [ direct; nested; created ]
    |> List.tryPick (fun value -> if isFiniteNumber value then Some(unbox<float> value) else None)

let PairHint () : PairHintMessages =
    let sessions = Dictionary<string, ScopeSession>()

    let current (sessionId: string) : ScopeSession =
        match sessions.TryGetValue sessionId with
        | true, scope -> scope
        | false, _ ->
            let scope = ScopeSession()
            sessions[sessionId] <- scope
            scope

    let observe (sessionId: string) (message: obj) (hasReset: bool) : unit =
        let scope = current sessionId
        scope.Observe(promptKey message, numericTimestamp message, hasReset)

    let request (sessionId: string) (messages: obj) (injectExisting: bool) : obj array =
        let original = asArray messages
        let filtered = original |> filterMessages |> fun items -> mapIfChanged items stripContradictoryMessage
        let index = lastPromptIndex (box filtered)
        if index < 0 then original
        else
            if not (endsWithSideRequest (box original)) then
                observe sessionId filtered[index] (hasResetSinceLastPrompt (box filtered))
            let injected = initializeUserMessages (box filtered)
            let active = current sessionId
            let withSteer =
                if active.Initialized && active.Budget = 0 && not (endsWithSideRequest (box injected)) then
                    appendWeakSteer (box injected)
                else injected
            if injectExisting then
                mapIfChanged withSteer (injectToolResultMessage active.Initialized active.Budget)
            else withSteer

    { new PairHintMessages with
        member _.budgetSuffix(budget) = budgetSuffix budget
        member _.appendText(content, addition) = appendText content addition
        member _.appendUserReminder(content) = appendUserReminder content
        member _.appendBudgetReminder(content, budget) = appendBudgetReminder content budget
        member _.injectToolResultContent(content, name, initialized, budget) = resultContent content name initialized budget
        member _.initializeUserMessages(messages) = initializeUserMessages messages
        member _.injectToolResults(messages, initialized, budget) =
            asArray messages |> fun items -> mapIfChanged items (injectToolResultMessage initialized budget)
        member _.stripContradictions(messages) =
            asArray messages |> fun items -> mapIfChanged items stripContradictoryMessage
        member _.filter(messages) = filterMessages messages
        member _.appendWeakSteer(messages) = appendWeakSteer messages
        member _.promptKey(message) = promptKey message
        member _.lastPromptIndex(messages) = lastPromptIndex messages
        member _.hasResetSinceLastPrompt(messages) = hasResetSinceLastPrompt messages
        member _.isScopePrompt(message) = isScopePrompt message
        member _.endsWithSideRequest(messages) = endsWithSideRequest messages
        member _.isUnchanged(left, right) = sameElements left right
        member _.turnBudget(sessionId) = (current sessionId).Budget
        member _.isInitialized(sessionId) = (current sessionId).Initialized
        member _.startTurn(sessionId) = (current sessionId).StartTurn()
        member _.observePrompt(sessionId, message, hasReset) = observe sessionId message hasReset
        member _.setInitialized(sessionId, initialized) = (current sessionId).MarkInitialized(initialized)
        member _.resetSession(sessionId, budget) = (current sessionId).Reset(budget)
        member _.clearSession(sessionId) = sessions.Remove sessionId |> ignore
        member _.prepareRequest(sessionId, messages, injectExistingToolResults) =
            request sessionId messages injectExistingToolResults
        member _.toolResultFor(sessionId, name, content) =
            let active = current sessionId
            resultContent content name active.Initialized active.Budget
        member _.writeUserHint(message, texts) = writeUserHint message texts
        member _.writeToolResultHint(message, texts) = writeToolResultHint message texts
        member _.stripKnownHints(message, texts) = stripKnownHints message texts
        member _.userCanCarryHint(message) = userCanCarryHint message
        member _.toolCanCarryHint(message) = toolCanCarryHint message }
