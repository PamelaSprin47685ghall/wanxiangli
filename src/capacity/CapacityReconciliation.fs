namespace Wanxiangli.Capacity

open System
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number' && Number.isSafeInteger($0)")>]
    let isInteger (_value: obj) : bool = jsNative

    [<Emit("$0 == null")>]
    let isNullish (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    let fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: capacity reconciliation " + message))

    let array (name: string) (value: obj) : obj array =
        if isArray value then
            unbox<obj array> value
        else
            fail (sprintf "requires array %s" name)

    let integer (name: string) (value: obj) : int64 =
        if isInteger value then
            int64 (unbox<float> value)
        else
            fail (sprintf "requires integer %s" name)

    let text (name: string) (value: obj) : string =
        if isString value then
            unbox<string> value
        else
            fail (sprintf "requires string %s" name)

    let optionalText (name: string) (value: obj) : string option =
        if isNullish value then None
        elif isString value then Some(unbox<string> value)
        else fail (sprintf "requires string or null %s" name)

/// 精确 owner：会话、物理用户消息、角色（可缺）、参与者（可缺）。按值比较。
type internal OwnerKey = string * string * string option * string option

module internal OwnerKey =

    let decode (name: string) (value: obj) : OwnerKey =
        if Wire.isNullish value then
            Wire.fail (sprintf "requires owner %s" name)

        Wire.text (name + ".sessionId") (value?sessionId: obj),
        Wire.text (name + ".physicalUserMessageId") (value?physicalUserMessageId: obj),
        Wire.optionalText (name + ".role") (value?role: obj),
        Wire.optionalText (name + ".participant") (value?participant: obj)

/// 失败名的固定次序就是报告次序。
module internal FailureName =
    [<Literal>]
    let ActiveOutsideLedgerBounds = "ActiveOutsideLedgerBounds"

    [<Literal>]
    let TokenStateCountMismatch = "TokenStateCountMismatch"

    [<Literal>]
    let MapLedgerDivergence = "MapLedgerDivergence"

    [<Literal>]
    let UntraceableTokenOwner = "UntraceableTokenOwner"

    [<Literal>]
    let UntraceableWaiterOwner = "UntraceableWaiterOwner"

    [<Literal>]
    let UntraceableExecutionCustody = "UntraceableExecutionCustody"

    [<Literal>]
    let CounterRegression = "CounterRegression"

/// 容量不变量对账律：给定一次一致快照，回答 NoOp 或 FailClosed（附全部失败，按固定次序）。
/// 不读账本、不改状态、不修复；修复与关停是调用方的事。
[<AttachMembers>]
type CapacityReconciliation() =

    member _.decide(evidence: obj) : obj =
        if Wire.isNullish evidence then
            Wire.fail "requires evidence"

        let ledger = Wire.array "ledgerEntries" (evidence?ledgerEntries: obj)
        let tokens = Wire.array "tokens" (evidence?tokens: obj)
        let custodies = Wire.array "custodies" (evidence?custodies: obj)
        let executions = Wire.array "executions" (evidence?executions: obj)
        let waiters = Wire.array "waiters" (evidence?waiters: obj)
        let owners = Wire.array "owners" (evidence?owners: obj)
        let idleCount = Wire.integer "idleCount" (evidence?idleCount: obj)
        let inFlightCount = Wire.integer "inFlightCount" (evidence?inFlightCount: obj)
        let retiringCount = Wire.integer "retiringCount" (evidence?retiringCount: obj)
        let activeCount = Wire.integer "activeCount" (evidence?activeCount: obj)
        let counters: obj = evidence?counters

        if Wire.isNullish counters then
            Wire.fail "requires counters"

        let duplicate = Wire.integer "counters.duplicate" (counters?duplicate: obj)
        let stale = Wire.integer "counters.stale" (counters?stale: obj)
        let conflict = Wire.integer "counters.conflict" (counters?conflict: obj)

        let ownerSet =
            owners |> Array.map (OwnerKey.decode "owners[]") |> Set.ofArray

        let custodySet =
            custodies
            |> Array.map (fun custody -> OwnerKey.decode "custodies[].owner" (custody?owner: obj))
            |> Set.ofArray

        let ledgerCredits =
            ledger |> Array.map (fun entry -> Wire.integer "ledgerEntries[].credit" (entry?credit: obj)) |> Set.ofArray

        let tokenStates =
            tokens |> Array.map (fun token -> Wire.text "tokens[].state" (token?state: obj))

        let tokenCredits =
            tokens |> Array.map (fun token -> Wire.integer "tokens[].credit" (token?credit: obj)) |> Set.ofArray

        let tokenOwners =
            tokens |> Array.map (fun token -> OwnerKey.decode "tokens[].owner" (token?owner: obj))

        let waiterOwners =
            waiters |> Array.map (fun waiter -> OwnerKey.decode "waiters[].owner" (waiter?owner: obj))

        let executionOwners = executions |> Array.map (OwnerKey.decode "executions[]")

        let count state =
            tokenStates |> Array.sumBy (fun value -> if value = state then 1L else 0L)

        let idle = count "Idle"
        let inFlight = count "InFlight"
        let retiring = count "Retiring"
        let tokenCount = int64 tokens.Length

        let failures =
            [| if
                   activeCount < 0L
                   || activeCount > int64 ledger.Length
                   || activeCount <> inFlight + retiring
               then
                   FailureName.ActiveOutsideLedgerBounds
               if
                   idleCount <> idle
                   || inFlightCount <> inFlight
                   || retiringCount <> retiring
                   || idle + inFlight + retiring <> tokenCount
               then
                   FailureName.TokenStateCountMismatch
               if ledgerCredits <> tokenCredits || ledger.Length <> tokens.Length then
                   FailureName.MapLedgerDivergence
               if tokenOwners |> Array.exists (fun owner -> not (Set.contains owner ownerSet)) then
                   FailureName.UntraceableTokenOwner
               if waiterOwners |> Array.exists (fun owner -> not (Set.contains owner ownerSet)) then
                   FailureName.UntraceableWaiterOwner
               if executionOwners |> Array.exists (fun owner -> not (Set.contains owner custodySet)) then
                   FailureName.UntraceableExecutionCustody
               if duplicate < 0L || stale < 0L || conflict < 0L then
                   FailureName.CounterRegression |]

        if failures.Length = 0 then
            Wire.freeze (createObj [ "decision" ==> "NoOp" ])
        else
            Wire.freeze (createObj [ "decision" ==> "FailClosed"; "failures" ==> Wire.freeze (box failures) ])
