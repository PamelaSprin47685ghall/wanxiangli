namespace Wanxiangli.Dispatch

open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBoolean (_value: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isAbsent (_value: obj) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number' && Number.isSafeInteger($0) && $0 >= 0")>]
    let isCount (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number' && Number.isSafeInteger($0) && $0 > 0")>]
    let isPositive (_value: obj) : bool = jsNative

    [<Emit("$0[$1]")>]
    let field (_value: obj) (_name: string) : obj = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    let malformed (what: string) : 'T =
        raise (System.ArgumentException(sprintf "wanxiangli/dispatch: malformed %s" what))

    let text (what: string) (value: obj) : string =
        if isString value then unbox<string> value else malformed what

    let optionalText (what: string) (value: obj) : string option =
        if isAbsent value then None else Some(text what value)

    let flag (what: string) (value: obj) : bool =
        if isBoolean value then unbox<bool> value else malformed what

    let input (what: string) (value: obj) : obj =
        if isObject value then value else malformed what

    let optionalCount (what: string) (value: obj) : int option =
        if isAbsent value then None
        elif isCount value then Some(unbox<int> value)
        else malformed what

    let event (value: obj) =
        match (if isString value then unbox<string> value else "") with
        | "Submit" -> ClaimEvent.Submit
        | "Accept" -> ClaimEvent.Accept
        | "Abandon" -> ClaimEvent.Abandon
        | _ -> malformed "event"

    let editLabel (edit: LedgerEdit) =
        match edit with
        | LedgerEdit.RecordReceipt -> "RecordReceipt"
        | LedgerEdit.DropPending -> "DropPending"
        | LedgerEdit.LandOccasion -> "LandOccasion"
        | LedgerEdit.LandExact -> "LandExact"
        | LedgerEdit.RecordContinuation -> "RecordContinuation"
        | LedgerEdit.ClearOccasion -> "ClearOccasion"

    let sendAnswer (value: obj) =
        match (if isString value then unbox<string> value else "") with
        | "AdmittedWithReceipt" -> SendAnswer.AdmittedWithReceipt
        | "AdmittedWithPhysicalMessage" -> SendAnswer.AdmittedWithPhysicalMessage
        | "Retryable" -> SendAnswer.Retryable
        | "Fatal" -> SendAnswer.Fatal
        | "AcceptanceUnknown" -> SendAnswer.AcceptanceUnknown
        | _ -> malformed "send answer"

    let ledgerLabel (ledger: SendLedger) =
        match ledger with
        | SendLedger.Submit -> "Submit"
        | SendLedger.SubmitThenAccept -> "SubmitThenAccept"
        | SendLedger.Abandon -> "Abandon"
        | SendLedger.KeepPending -> "KeepPending"

    let detachedLabel (verdict: DetachedVerdict) =
        match verdict with
        | DetachedVerdict.OwnedSettled -> "OwnedSettled"
        | DetachedVerdict.Refused -> "Refused"
        | DetachedVerdict.OutcomeUnknown -> "OutcomeUnknown"

    let message (value: obj) : RecoveryMessage =
        let value = input "message" value

        { Role = text "message.role" (field value "role")
          PromptKey = optionalText "message.promptKey" (field value "promptKey")
          Id = text "message.id" (field value "id") }

/// wanxiangli/dispatch 公开入口：派发认领账的纯规则（CUT-11）。
/// 认领作用域与 PromptKey 原文、ClaimSequence 消费、四态结算的投影编辑、精确 occasion 准入、
/// 崩溃恢复的物理证据核对都在这里裁决。无状态；投影记录、哈希函数、journal 与 Host 发送归宿主。
/// 畸形输入是调用方缺陷，直接抛 ArgumentException，不猜测。
[<AttachMembers>]
type Dispatch() =

    member _.contractVersion = 1
    member _.recoveryTailWindow = ClaimLaw.recoveryTailWindow

    /// { sessionId, logicalRunId?: string|null, origin, payloadDigest } → 作用域字符串。
    member _.claimScope(value: obj) : string =
        let value = Wire.input "scope input" value

        ClaimLaw.claimScope
            (Wire.text "sessionId" (Wire.field value "sessionId"))
            (Wire.optionalText "logicalRunId" (Wire.field value "logicalRunId"))
            (Wire.text "origin" (Wire.field value "origin"))
            (Wire.text "payloadDigest" (Wire.field value "payloadDigest"))

    /// { sessionId, logicalRunId?, authorityRoot?, origin, payloadDigest, claimSequence ≥ 1 } → 待哈希原文。
    member _.promptKeyMaterial(value: obj) : string =
        let value = Wire.input "key input" value
        let sequence = Wire.field value "claimSequence"

        if not (Wire.isPositive sequence) then
            Wire.malformed "claimSequence"

        ClaimLaw.promptKeyMaterial
            (Wire.text "sessionId" (Wire.field value "sessionId"))
            (Wire.optionalText "logicalRunId" (Wire.field value "logicalRunId"))
            (Wire.optionalText "authorityRoot" (Wire.field value "authorityRoot"))
            (Wire.text "origin" (Wire.field value "origin"))
            (Wire.text "payloadDigest" (Wire.field value "payloadDigest"))
            (unbox<int> sequence)

    /// consumed: 该作用域已消费的计数（null = 从未认领）→ 下一个序号。
    member _.nextClaimSequence(consumed: obj) : int =
        ClaimLaw.nextClaimSequence (Wire.optionalCount "consumed" consumed)

    member _.alreadyClaimed(consumed: obj) : bool =
        ClaimLaw.alreadyClaimed (Wire.optionalCount "consumed" consumed)

    /// { event: 'Submit'|'Accept'|'Abandon', pending: boolean, continuation: boolean } → 冻结的编辑标签数组。
    member _.settle(value: obj) : obj =
        let value = Wire.input "settle input" value

        ClaimLaw.settle
            (Wire.event (Wire.field value "event"))
            (Wire.flag "pending" (Wire.field value "pending"))
            (Wire.flag "continuation" (Wire.field value "continuation"))
        |> List.map Wire.editLabel
        |> List.toArray
        |> box
        |> Wire.freeze

    /// { pendingSameOccasion: boolean, landedOrigin?: string|null, origin } → boolean。
    member _.occasionAdmitted(value: obj) : bool =
        let value = Wire.input "occasion input" value

        ClaimLaw.occasionAdmitted
            (Wire.flag "pendingSameOccasion" (Wire.field value "pendingSameOccasion"))
            (Wire.optionalText "landedOrigin" (Wire.field value "landedOrigin"))
            (Wire.text "origin" (Wire.field value "origin"))

    /// 运行边界重置。input = { sessionId, claims: [{ key, logicalRunId? }], counters: [{ scope, sessionId, logicalRunId? }] }
    /// → 冻结的 { keepClaims, keepCounters, clearContinuations, clearQuestions }（保持输入顺序）。
    member _.reset(value: obj) : obj =
        let value = Wire.input "reset input" value
        let claims = Wire.field value "claims"
        let counters = Wire.field value "counters"

        if not (Wire.isArray claims) then
            Wire.malformed "claims"

        if not (Wire.isArray counters) then
            Wire.malformed "counters"

        let claim (item: obj) =
            let item = Wire.input "claim" item
            Wire.text "claim.key" (Wire.field item "key"), Wire.optionalText "claim.logicalRunId" (Wire.field item "logicalRunId")

        let counter (item: obj) =
            let item = Wire.input "counter" item

            Wire.text "counter.scope" (Wire.field item "scope"),
            Wire.text "counter.sessionId" (Wire.field item "sessionId"),
            Wire.optionalText "counter.logicalRunId" (Wire.field item "logicalRunId")

        let verdict =
            ClaimLaw.reset
                (Wire.text "sessionId" (Wire.field value "sessionId"))
                (unbox<obj array> claims |> Array.map claim |> Array.toList)
                (unbox<obj array> counters |> Array.map counter |> Array.toList)

        createObj
            [ "keepClaims" ==> Wire.freeze (box (List.toArray verdict.KeepClaims))
              "keepCounters" ==> Wire.freeze (box (List.toArray verdict.KeepCounters))
              "clearContinuations" ==> verdict.ClearContinuations
              "clearQuestions" ==> verdict.ClearQuestions ]
        |> Wire.freeze

    /// Host 的发送回答（'AdmittedWithReceipt' | 'AdmittedWithPhysicalMessage' | 'Retryable' | 'Fatal' |
    /// 'AcceptanceUnknown'）→ 冻结的 { ledger, definitelyNotSent, detached }。
    member _.answer(sent: obj) : obj =
        let verdict = ClaimLaw.answer (Wire.sendAnswer sent)

        createObj
            [ "ledger" ==> Wire.ledgerLabel verdict.Ledger
              "definitelyNotSent" ==> verdict.DefinitelyNotSent
              "detached" ==> Wire.detachedLabel verdict.Detached ]
        |> Wire.freeze

    /// { promptKey, hasReceipt, messages: [{ role, promptKey?, id }] }（按时间先后）→
    /// { kind: 'Proven', physicalUserMessageId } | { kind: 'StillPending', hasReceipt }。
    member _.recover(value: obj) : obj =
        let value = Wire.input "recover input" value
        let messages = Wire.field value "messages"

        if not (Wire.isArray messages) then
            Wire.malformed "messages"

        let verdict =
            ClaimLaw.recover
                (Wire.text "promptKey" (Wire.field value "promptKey"))
                (Wire.flag "hasReceipt" (Wire.field value "hasReceipt"))
                (unbox<obj array> messages |> Array.map Wire.message |> Array.toList)

        match verdict with
        | Recovery.Proven physical -> createObj [ "kind" ==> "Proven"; "physicalUserMessageId" ==> physical ]
        | Recovery.StillPending receipt -> createObj [ "kind" ==> "StillPending"; "hasReceipt" ==> receipt ]
        |> Wire.freeze
