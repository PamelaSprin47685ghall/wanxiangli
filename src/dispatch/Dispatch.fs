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
