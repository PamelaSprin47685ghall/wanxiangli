module Wanxiangli.Quarantine.RuleQuarantine

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isPlainObject (value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBoolean (value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (item: obj) (name: string) : obj = jsNative

let private requireText (name: string) (value: obj) : string =
    if isString value then unbox<string> value
    else raise (System.ArgumentException(name + " must be a string"))

/// 一条隔离：哪个事件让该 (rule, scope) 失败、规则给的原因。
type Fault = { failedEventId: string; reason: string }

/// 隔离账：(rule, scope) → Fault。持久不可变；每次登记或解除都返回新账，旧账不变。
type Ledger = private Ledger of Map<string * string, Fault>

/// ProjectionCutTail 载荷的四个字段（camelCase 是 JS 面，线上字节用 snake_case）。
type Cut =
    { rule: string
      failedEventId: string
      reason: string
      resetJson: string }

let private cutOf (value: obj) : Cut =
    if not (isPlainObject value) then raise (System.ArgumentException "cut must be an object")
    { rule = requireText "rule" (field value "rule")
      failedEventId = requireText "failedEventId" (field value "failedEventId")
      reason = requireText "reason" (field value "reason")
      resetJson = requireText "resetJson" (field value "resetJson") }

let private ledgerOf (value: obj) : Map<string * string, Fault> =
    match value with
    | :? Ledger as ledger -> let (Ledger map) = ledger in map
    | _ -> raise (System.ArgumentException "ledger must come from RuleQuarantine")

[<AttachMembers>]
type RuleQuarantine() =
    /// 截尾事实的事件类型。
    member _.cutTailType: string = "ProjectionCutTail"

    member _.empty() : Ledger = Ledger Map.empty

    member _.isQuarantined(ledger: obj, rule: obj, scope: obj) : bool =
        Map.containsKey (requireText "rule" rule, requireText "scope" scope) (ledgerOf ledger)

    member _.fault(ledger: obj, rule: obj, scope: obj) : obj =
        match Map.tryFind (requireText "rule" rule, requireText "scope" scope) (ledgerOf ledger) with
        | Some fault -> box fault
        | None -> null

    /// 规则在某事件上失败：登记（同键覆盖）。隔离期间该 (rule, scope) 的后续事件一律跳过，Current 停在最后一次成功。
    member _.quarantine(ledger: obj, rule: obj, scope: obj, failedEventId: obj, reason: obj) : Ledger =
        let fault =
            { failedEventId = requireText "failedEventId" failedEventId
              reason = requireText "reason" reason }
        Ledger(Map.add (requireText "rule" rule, requireText "scope" scope) fault (ledgerOf ledger))

    /// 解除；不存在的键是空操作。
    member _.release(ledger: obj, rule: obj, scope: obj) : Ledger =
        Ledger(Map.remove (requireText "rule" rule, requireText "scope" scope) (ledgerOf ledger))

    member _.size(ledger: obj) : int = Map.count (ledgerOf ledger)

    /// 线上载荷：键序固定 rule, failed_event_id, reason, reset_json。
    member _.encodeCut(cut: obj) : obj =
        let c = cutOf cut
        createObj [ "rule" ==> c.rule; "failed_event_id" ==> c.failedEventId; "reason" ==> c.reason; "reset_json" ==> c.resetJson ]

    /// 只有事件类型恰为 ProjectionCutTail、载荷是对象且四个字段都是字符串时才是截尾；其余（含畸形截尾）为 null，按普通事件处理。
    member this.decodeCut(eventType: obj, payload: obj) : obj =
        if not (isString eventType) || unbox<string> eventType <> this.cutTailType || not (isPlainObject payload) then null
        else
            let text name = let v = field payload name in if isString v then Some(unbox<string> v) else None
            match text "rule", text "failed_event_id", text "reason", text "reset_json" with
            | Some rule, Some failed, Some reason, Some reset -> box { rule = rule; failedEventId = failed; reason = reason; resetJson = reset }
            | _ -> null

    /// 截尾是否生效：规则在程序里且它点名的失败事件已整合时才应用 reset；
    /// 解除的键是 (cut.rule, 失败事件自己的 scope)。reset 成功后才可 release；reset 失败则隔离保留。
    member _.cutVerdict(ruleKnown: obj, failedEventScope: obj) : bool =
        if not (isBoolean ruleKnown) then raise (System.ArgumentException "ruleKnown must be a boolean")
        unbox<bool> ruleKnown && isString failedEventScope
