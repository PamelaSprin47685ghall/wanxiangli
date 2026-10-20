module Wanxiangli.Degeneration.Degeneration

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// 一个检测器的公开消息。输入是已分词的 token 流；分词器与包络由组合者提供。
[<AllowNullLiteral>]
type DetectorMessages =
    abstract push: tokens: obj -> obj
    abstract evaluate: unit -> obj
    abstract trackedTokenCount: unit -> int
    abstract reset: unit -> unit

[<AllowNullLiteral>]
type DegenerationMessages =
    abstract detector: unit -> DetectorMessages
    abstract classify: weightedDistinctTokens: float -> string
    abstract envelope: unit -> obj

type private Envelope =
    { VocabularySize: int
      Lambda: float
      Normal: float
      Minimum: float
      Maximum: float }

let private fail (message: string) : 'a = raise (ArgumentException message)

[<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
let private descriptorOf (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
let private hasOwn (_value: obj) (_name: string) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("Number.isSafeInteger($0)")>]
let private isSafeInteger (_value: obj) : bool = jsNative

[<Emit("Number.isFinite($0)")>]
let private isFinite (_value: obj) : bool = jsNative

let private isAbsent (value: obj) = isNull value || jsTypeof value = "undefined"

/// 只读数据字段；accessor 在读取前被拒绝。
let private ownField (value: obj) (name: string) : obj =
    if isAbsent value || jsTypeof value <> "object" then
        fail ("Expected an object with field " + name)
    else
        let descriptor = descriptorOf value name

        if isAbsent descriptor || not (hasOwn descriptor "value") then
            fail ("Missing field or accessor: " + name)
        else
            descriptor?value

let private finite (name: string) (value: obj) : float =
    if jsTypeof value = "number" && isFinite value then
        unbox<float> value
    else
        fail (name + " must be a finite number")

let private envelopeOf (value: obj) : Envelope =
    let vocabulary = ownField value "vocabularySize"

    if not (isSafeInteger vocabulary) || unbox<int> vocabulary <= 0 then
        fail "vocabularySize must be a positive integer"

    let envelope =
        { VocabularySize = unbox<int> vocabulary
          Lambda = finite "lambda" (ownField value "lambda")
          Normal = finite "normalWeightedDistinctCount" (ownField value "normalWeightedDistinctCount")
          Minimum = finite "minimumWeightedDistinctCount" (ownField value "minimumWeightedDistinctCount")
          Maximum = finite "maximumWeightedDistinctCount" (ownField value "maximumWeightedDistinctCount") }

    if not (envelope.Lambda > 0.0 && envelope.Lambda < 1.0) then
        fail "lambda must lie strictly between 0 and 1"

    if not (envelope.Minimum <= envelope.Maximum) then
        fail "minimumWeightedDistinctCount must not exceed maximumWeightedDistinctCount"

    envelope

/// 边界及区间内为 Normal（degeneration-guard WHAT[003]）。
let private classify (envelope: Envelope) (count: float) : string =
    if count < envelope.Minimum then "TooRepetitive"
    elif count > envelope.Maximum then "TooRandom"
    else "Normal"

let private evaluation (envelope: Envelope) (count: float) (step: int) : obj =
    let state = classify envelope count

    freeze (
        createObj
            [ "state" ==> state
              "isAnomalous" ==> (state <> "Normal")
              "weightedDistinctTokens" ==> count
              "step" ==> step ]
    )

let private tokensOf (envelope: Envelope) (value: obj) : int array =
    if not (isArray value) then
        fail "tokens must be an array"

    let items: obj array = unbox value

    items
    |> Array.map (fun item ->
        if not (isSafeInteger item) then
            fail "token must be an integer"

        let token = unbox<int> item

        if token < 0 || token >= envelope.VocabularySize then
            fail "token lies outside the vocabulary"

        token)

/// 单个检测器：指数衰减加权相异计数 D_t 与每个已见 token 的最近步数。
/// 每个 token O(1) 更新；状态上限是词表大小，不随输出长度增长（WHAT[005]）。
let private detector (envelope: Envelope) : DetectorMessages =
    let lastSeen = Dictionary<int, int>()
    let mutable step = 0
    let mutable count = envelope.Normal

    let pushToken (token: int) =
        step <- step + 1

        let replacement =
            match lastSeen.TryGetValue token with
            | true, previous -> 1.0 - Math.Pow(envelope.Lambda, float (step - previous))
            | false, _ -> 1.0

        lastSeen[token] <- step
        count <- envelope.Lambda * count + replacement

    { new DetectorMessages with
        member _.push(tokens) =
            // 先整体校验，再提交：坏 token 不会留下半段统计。
            let tokens = tokensOf envelope tokens
            tokens |> Array.iter pushToken
            evaluation envelope count step

        member _.evaluate() = evaluation envelope count step

        member _.trackedTokenCount() = lastSeen.Count

        member _.reset() =
            lastSeen.Clear()
            step <- 0
            count <- envelope.Normal }

/// 以组合者给出的包络建立检测族。包络从哪里派生、多久更新，不归本模块。
let Degeneration (envelope: obj) : DegenerationMessages =
    let envelope = envelopeOf envelope

    let published =
        freeze (
            createObj
                [ "vocabularySize" ==> envelope.VocabularySize
                  "lambda" ==> envelope.Lambda
                  "normalWeightedDistinctCount" ==> envelope.Normal
                  "minimumWeightedDistinctCount" ==> envelope.Minimum
                  "maximumWeightedDistinctCount" ==> envelope.Maximum ]
        )

    { new DegenerationMessages with
        member _.detector() = detector envelope

        member _.classify(weightedDistinctTokens) =
            classify envelope (finite "weightedDistinctTokens" (box weightedDistinctTokens))

        member _.envelope() = published }
