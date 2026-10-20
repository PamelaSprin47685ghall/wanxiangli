namespace Wanxiangli.Borrowing

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'function'")>]
    let isFunction (_value: obj) : bool = jsNative

    [<Emit("$0 == null")>]
    let isNullish (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("$0($1)")>]
    let call1 (_f: obj) (_a: obj) : obj = jsNative

    [<Emit("$0($1, $2)")>]
    let call2 (_f: obj) (_a: obj) (_b: obj) : obj = jsNative

    [<Emit("$0 === true")>]
    let isTrue (_value: obj) : bool = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    [<Emit("Object.freeze($0)")>]
    let freezeArray (_value: obj array) : obj array = jsNative

    [<Emit("$0.slice()")>]
    let copy (_value: obj array) : obj array = jsNative

module internal Fail =
    let op (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

type internal Step =
    { SessionId: string
      PhysicalUserMessageId: string
      Fence: Set<string>
      RequestKey: string option }

[<RequireQualifiedAccess>]
type internal TokenState =
    | Idle
    | InFlight of Step
    | Retiring of Step

/// 一枚真实容量 token（一次 scheduler `running` 占位）及其所有者执行。
type internal Token =
    { Credit: float
      // DSL-MUTABLE: state — the execution that currently owns this token
      mutable OwnerKey: string
      OwnerSessionId: string
      Provider: string
      mutable OwnerTarget: obj
      mutable State: TokenState }

/// 借用执行 → 出借方 token。
type internal Source =
    { Credit: float
      LenderSessionId: string
      Distance: int }

type internal Demand =
    { Sequence: float
      SessionId: string
      PhysicalUserMessageId: string
      Target: obj
      Fence: Set<string>
      RequestKey: string option
      TryOrdinary: obj
      Completion: TaskCompletionSource<unit> }

/// wanxiangli/borrowing 公开入口：容量账本、执行托管与 provider-step 借用的 owner（CUT-10）。
/// 一枚 token = scheduler `running` 里的一次真实占位；借用只改变谁可以用 token，从不改变真实 token 的数量。
/// 选 target 的策略（route / tryOrdinary）与 target 的 provider、相等判定都由调用方给出；本对象不调用模型、
/// 不签发许可、不排执行准入队列。
[<AttachMembers>]
type CapacityBorrowing(options: obj) =
    let providerOf: obj =
        if Wire.isNullish options || not (Wire.isFunction (options?providerOf: obj)) then
            Fail.op "capacity borrowing requires options.providerOf(target)"
        else
            options?providerOf

    let sameTargetFn: obj =
        if not (Wire.isFunction (options?sameTarget: obj)) then
            Fail.op "capacity borrowing requires options.sameTarget(left, right)"
        else
            options?sameTarget

    let maximumPendingSteps = 32

    // ---- ledger: one opaque credit = one physical occurrence in scheduler `running`
    let ledger = Dictionary<float, obj>()
    // DSL-MUTABLE: resource — monotonic opaque capacity-credit identity
    let mutable nextCredit = 0.0

    let ledgerAcquire (target: obj) =
        nextCredit <- nextCredit + 1.0
        ledger[nextCredit] <- target
        nextCredit

    let ledgerRetarget (credit: float) (target: obj) =
        if ledger.ContainsKey credit then
            ledger[credit] <- target

    let ledgerRelease (credit: float) = ledger.Remove credit |> ignore

    let ledgerEntries () =
        ledger |> Seq.map (fun (KeyValue(credit, target)) -> credit, target) |> Seq.toArray

    let ledgerSnapshot () =
        ledgerEntries () |> Array.map snd |> Wire.freezeArray

    // ---- custody
    let creditSourceByExecution = Dictionary<string, Source>()
    let ownedTokenByExecution = Dictionary<string, float>()
    let tokens = Dictionary<float, Token>()

    // ---- provider-step waiters
    let waiters = ResizeArray<Demand>()
    // DSL-MUTABLE: resource
    let mutable nextStepSequence = 0.0

    let sameTarget (left: obj) (right: obj) = Wire.isTrue (Wire.call2 sameTargetFn left right)

    let route (policy: obj) (running: obj array) : obj option =
        let chosen = Wire.call1 policy (box running)
        if Wire.isNullish chosen then None else Some chosen

    let executionKey sessionId (physicalUserMessageId: string option) =
        sessionId + "\u001f" + (physicalUserMessageId |> Option.defaultValue "")

    let executionPrefix sessionId = sessionId + "\u001f"

    let executionOwner (key: string) : obj =
        let separator = key.IndexOf('\u001f')

        Wire.freeze (
            createObj
                [ "sessionId" ==> key.Substring(0, separator)
                  "physicalUserMessageId" ==> key.Substring(separator + 1) ]
        )

    let tokenStateName =
        function
        | TokenState.Idle -> "Idle"
        | TokenState.InFlight _ -> "InFlight"
        | TokenState.Retiring _ -> "Retiring"

    let clearCreditSource key =
        creditSourceByExecution.Remove key |> ignore

    let clearCreditSourcesForToken (tokenId: float) =
        creditSourceByExecution
        |> Seq.choose (fun (KeyValue(key, source)) -> if source.Credit = tokenId then Some key else None)
        |> Seq.toArray
        |> Array.iter clearCreditSource

    let clearCreditSourcesForSession sessionId =
        creditSourceByExecution.Keys
        |> Seq.filter (fun key -> key.StartsWith(executionPrefix sessionId, StringComparison.Ordinal))
        |> Seq.toArray
        |> Array.iter clearCreditSource

    let rememberCreditSource key borrowerSessionId (token: Token) distance =
        if distance <= 0 || token.OwnerSessionId = borrowerSessionId then
            clearCreditSource key
        else
            creditSourceByExecution[key] <-
                { Credit = token.Credit
                  LenderSessionId = token.OwnerSessionId
                  Distance = distance }

    let moveCreditSource oldKey newKey =
        match creditSourceByExecution.TryGetValue oldKey with
        | true, source ->
            clearCreditSource oldKey
            creditSourceByExecution[newKey] <- source
        | false, _ -> ()

    let normalizeProvider (target: obj) =
        let provider = Wire.call1 providerOf target

        if not (Wire.isString provider) || String.IsNullOrWhiteSpace(unbox<string> provider) then
            Fail.op "capacity target has no provider"

        (unbox<string> provider).Trim()

    let isRetiring (token: Token) =
        match token.State with
        | TokenState.Retiring _ -> true
        | TokenState.Idle
        | TokenState.InFlight _ -> false

    let releaseToken (token: Token) =
        clearCreditSourcesForToken token.Credit
        ledgerRelease token.Credit
        tokens.Remove token.Credit |> ignore

        match ownedTokenByExecution.TryGetValue token.OwnerKey with
        | true, current when current = token.Credit -> ownedTokenByExecution.Remove token.OwnerKey |> ignore
        | _ -> ()

    let retireToken (token: Token) =
        match token.State with
        | TokenState.Idle -> releaseToken token
        | TokenState.InFlight step -> token.State <- TokenState.Retiring step
        | TokenState.Retiring _ -> ()

    let retireTokenId tokenId =
        match tokens.TryGetValue tokenId with
        | true, token -> retireToken token
        | false, _ -> ()

    let retireExecution key =
        clearCreditSource key

        match ownedTokenByExecution.TryGetValue key with
        | true, tokenId ->
            ownedTokenByExecution.Remove key |> ignore
            retireTokenId tokenId
        | false, _ -> ()

    let creditPair lender (token: Token) =
        match isRetiring token, token.OwnerSessionId = lender with
        | true, _
        | _, false -> None
        | false, true -> Some(token, 1)

    let cheapestPerProvider (provider: string, candidates: (Token * int) seq) =
        let token, _ =
            candidates |> Seq.sortBy (fun (token, distance) -> distance, token.Credit) |> Seq.head

        provider, token

    let creditTokens (lenderSessionId: string option) =
        match lenderSessionId with
        | None -> Map.empty
        | Some lender ->
            tokens.Values
            |> Seq.choose (creditPair lender)
            |> Seq.groupBy (fun (token, _) -> token.Provider)
            |> Seq.map cheapestPerProvider
            |> Map.ofSeq

    let withoutTokens (tokenIds: Set<float>) =
        ledgerEntries ()
        |> Array.choose (fun (token, target) -> if Set.contains token tokenIds then None else Some target)
        |> Wire.freezeArray

    let schedulingView (lenderSessionId: string option) =
        let credits = creditTokens lenderSessionId
        let hidden = credits |> Seq.map (fun (KeyValue(_, token)) -> token.Credit) |> Set.ofSeq
        withoutTokens hidden, credits

    let ordinaryDecision policy : (obj * Token option) option =
        route policy (ledgerSnapshot ()) |> Option.map (fun target -> target, None)

    let attributedDecision target (credit: Token) policy =
        match route policy (withoutTokens (Set.singleton credit.Credit)) with
        | Some attributable when sameTarget attributable target -> Some(target, Some credit)
        | _ -> ordinaryDecision policy

    let matchingCreditDecision target (credits: Map<string, Token>) policy =
        match Map.tryFind (normalizeProvider target) credits with
        | None -> ordinaryDecision policy
        | Some credit when credits.Count = 1 -> Some(target, Some credit)
        | Some credit -> attributedDecision target credit policy

    /// 合并的借用视图只是试探：隐藏了多个 provider 的 credit 时，选中的 target 必须在只隐藏它自己
    /// provider 的那枚 token 时仍可复现，否则没有一枚 token 能合法地为这次决定付费。
    let routeDecision (lenderSessionId: string option) policy : (obj * Token option) option =
        let borrowedView, credits = schedulingView lenderSessionId
        let borrowed = route policy borrowedView

        match Map.isEmpty credits, borrowed with
        | true, target -> target |> Option.map (fun selected -> selected, None)
        | false, None -> ordinaryDecision policy
        | false, Some target -> matchingCreditDecision target credits policy

    let acquireOwnedToken sessionId physicalUserMessageId target =
        let key = executionKey sessionId physicalUserMessageId

        if ownedTokenByExecution.ContainsKey key then
            Fail.op "one execution cannot own two capacity tokens"

        let provider = normalizeProvider target
        let tokenId = ledgerAcquire target

        let token =
            { Credit = tokenId
              OwnerKey = key
              OwnerSessionId = sessionId
              Provider = provider
              OwnerTarget = target
              State = TokenState.Idle }

        tokens[tokenId] <- token
        ownedTokenByExecution[key] <- tokenId
        token

    let moveOwnedToken oldKey newKey target (token: Token) =
        ownedTokenByExecution.Remove oldKey |> ignore
        token.OwnerKey <- newKey
        token.OwnerTarget <- target
        ownedTokenByExecution[newKey] <- token.Credit

        match token.State with
        | TokenState.Idle -> ledgerRetarget token.Credit target
        | TokenState.InFlight step when step.SessionId = token.OwnerSessionId ->
            token.State <- TokenState.Idle
            ledgerRetarget token.Credit target
        | TokenState.InFlight _ -> ()
        | TokenState.Retiring _ -> ()

    let finishStep (token: Token) =
        match token.State with
        | TokenState.Idle -> ()
        | TokenState.InFlight _ ->
            token.State <- TokenState.Idle
            ledgerRetarget token.Credit token.OwnerTarget
        | TokenState.Retiring _ -> releaseToken token

    let tryValue (table: Dictionary<'key, 'value>) (key: 'key) =
        match table.TryGetValue key with
        | true, value -> Some value
        | false, _ -> None

    let stepBelongsTo sessionId physicalUserMessageId (step: Step) =
        step.SessionId = sessionId && step.PhysicalUserMessageId = physicalUserMessageId

    let foreignBorrowedStepToken sessionId physicalUserMessageId (token: Token) =
        match token.State with
        | TokenState.InFlight step
        | TokenState.Retiring step when not (stepBelongsTo sessionId physicalUserMessageId step) -> Some token
        | _ -> None

    let reconcileFence sessionId physicalUserMessageId fence =
        // 自己的 step 推进：新 transform fence 严格超出在途 fence 时结束当前 step。
        tokens.Values
        |> Seq.tryFind (fun token ->
            match token.State with
            | TokenState.InFlight step
            | TokenState.Retiring step -> stepBelongsTo sessionId physicalUserMessageId step
            | TokenState.Idle -> false)
        |> Option.iter (fun token ->
            match token.State with
            | TokenState.InFlight step
            | TokenState.Retiring step when not (Set.isEmpty (Set.difference fence step.Fence)) -> finishStep token
            | _ -> ())

        // 所有者重新进入 transform：从别人的在途/退休 step（后代借用）收回自己拥有的 credit。
        executionKey sessionId (Some physicalUserMessageId)
        |> tryValue ownedTokenByExecution
        |> Option.bind (tryValue tokens)
        |> Option.bind (foreignBorrowedStepToken sessionId physicalUserMessageId)
        |> Option.iter finishStep

    let grant (token: Token) (demand: Demand) =
        match token.State with
        | TokenState.Idle ->
            ledgerRetarget token.Credit demand.Target

            token.State <-
                TokenState.InFlight
                    { SessionId = demand.SessionId
                      PhysicalUserMessageId = demand.PhysicalUserMessageId
                      Fence = demand.Fence
                      RequestKey = demand.RequestKey }

            waiters.Remove demand |> ignore

            try
                demand.Completion.SetResult(())
            with _ ->
                ()
        | _ -> Fail.op "non-idle capacity token was granted"

    let cancelWaiters predicate =
        waiters.ToArray()
        |> Array.filter predicate
        |> Array.iter (fun demand ->
            waiters.Remove demand |> ignore

            try
                demand.Completion.SetException(OperationCanceledException())
            with _ ->
                ())

    let isOwnedGrant (demand: Demand) (token: Token) =
        token.State = TokenState.Idle && sameTarget token.OwnerTarget demand.Target

    let tryGrantOwned (demand: Demand) =
        executionKey demand.SessionId (Some demand.PhysicalUserMessageId)
        |> tryValue ownedTokenByExecution
        |> Option.bind (tryValue tokens)
        |> Option.filter (isOwnedGrant demand)
        |> Option.map (fun token ->
            grant token demand
            true)
        |> Option.defaultValue false

    let tryExecutionSource (demand: Demand) =
        tryValue creditSourceByExecution (executionKey demand.SessionId (Some demand.PhysicalUserMessageId))

    let isBorrowGrant provider (token: Token) (source: Source) =
        source.Credit = token.Credit
        && token.OwnerSessionId = source.LenderSessionId
        && token.Provider = provider

    let borrowPair (demand: Demand) (token: Token) =
        let provider = normalizeProvider demand.Target

        match token.State, tryExecutionSource demand with
        | TokenState.Idle, Some source when isBorrowGrant provider token source -> Some(source.Distance, token)
        | _ -> None

    let tryGrantBorrowed (demand: Demand) =
        tokens.Values
        |> Seq.choose (borrowPair demand)
        |> Seq.sortBy (fun (distance, token) -> distance, token.Credit)
        |> Seq.tryHead
        |> Option.map (fun (_, token) ->
            grant token demand
            true)
        |> Option.defaultValue false

    let demandOwnsToken (demand: Demand) =
        ownedTokenByExecution.ContainsKey(executionKey demand.SessionId (Some demand.PhysicalUserMessageId))

    let tryGrantOrdinary (demand: Demand) =
        if demandOwnsToken demand then
            false
        elif not (Wire.isTrue (Wire.call1 demand.TryOrdinary (box (ledgerSnapshot ())))) then
            false
        else
            let token = acquireOwnedToken demand.SessionId (Some demand.PhysicalUserMessageId) demand.Target
            grant token demand
            true

    let tryGrantDemand demand =
        tryGrantOwned demand || tryGrantBorrowed demand || tryGrantOrdinary demand

    let rec drain () =
        let granted =
            waiters.ToArray()
            |> Array.sortBy _.Sequence
            |> Array.tryFind tryGrantDemand
            |> Option.isSome

        if granted then drain ()

    let recordCredit failure sessionId key (lenderSessionId: string option) (credit: Token option) =
        match credit, lenderSessionId with
        | None, _ -> clearCreditSource key
        | Some token, Some lender when lender = token.OwnerSessionId -> rememberCreditSource key sessionId token 1
        | Some _, _ -> Fail.op failure

    let commitRoutedTarget sessionId oldKey newKey newPhysicalUserMessageId target lenderSessionId credit =
        match oldKey, credit with
        | Some previousKey, Some(token: Token) when token.OwnerKey = previousKey ->
            moveOwnedToken previousKey newKey target token
        | _ ->
            match credit with
            | Some _ -> ()
            | None -> acquireOwnedToken sessionId (Some newPhysicalUserMessageId) target |> ignore

            oldKey |> Option.iter retireExecution

        oldKey |> Option.iter clearCreditSource
        recordCredit "routed credit is not legal for requester" sessionId newKey lenderSessionId credit
        target

    let adoptOwnedToken oldKey newKey target tokenId =
        match tokens.TryGetValue tokenId with
        | true, token -> moveOwnedToken oldKey newKey target token
        | false, _ -> ownedTokenByExecution.Remove oldKey |> ignore

    let tryReuseExistingStep sessionId physicalUserMessageId fence (requestKey: string option) =
        let tryFindStep key =
            let waiterTask =
                waiters.ToArray()
                |> Array.tryFind (fun d ->
                    d.SessionId = sessionId
                    && d.PhysicalUserMessageId = physicalUserMessageId
                    && d.RequestKey = Some key
                    && d.Fence = fence)
                |> Option.map (fun d -> d.Completion.Task :> Task)

            let inFlight =
                tokens.Values
                |> Seq.exists (fun token ->
                    match token.State with
                    | TokenState.InFlight step
                    | TokenState.Retiring step ->
                        step.SessionId = sessionId
                        && step.PhysicalUserMessageId = physicalUserMessageId
                        && step.RequestKey = Some key
                        && step.Fence = fence
                    | TokenState.Idle -> false)

            waiterTask
            |> Option.orElse (if inFlight then Some(Task.FromResult(()) :> Task) else None)

        requestKey
        |> Option.filter (String.IsNullOrWhiteSpace >> not)
        |> Option.bind tryFindStep

    let enqueueStep sessionId physicalUserMessageId target fence requestKey tryOrdinary =
        let completion =
            TaskCompletionSource<unit>(TaskCreationOptions.RunContinuationsAsynchronously)

        nextStepSequence <- nextStepSequence + 1.0

        let demand =
            { Sequence = nextStepSequence
              SessionId = sessionId
              PhysicalUserMessageId = physicalUserMessageId
              Target = target
              Fence = fence
              RequestKey = requestKey
              TryOrdinary = tryOrdinary
              Completion = completion }

        if waiters.Count < maximumPendingSteps then
            waiters.Add demand
            drain ()
        else
            completion.SetException(
                InvalidOperationException "execution-model-routing: provider-step capacity queue full"
            )

        completion.Task :> Task

    let text (owner: string) (name: string) (value: obj) =
        if Wire.isString value then
            unbox<string> value
        else
            Fail.op (sprintf "%s requires string %s" owner name)

    let optionalText (owner: string) (name: string) (value: obj) =
        if Wire.isNullish value then None else Some(text owner name value)

    let policy (owner: string) (value: obj) =
        if Wire.isFunction value then value else Fail.op (sprintf "%s requires a route function" owner)

    let fenceOf (value: obj) : Set<string> =
        if not (Wire.isArray value) then
            Fail.op "provider step requires a fence array"

        unbox<obj array> value |> Array.map (text "provider step" "fence entry") |> Set.ofArray

    let targetOrNull (value: obj option) : obj =
        match value with
        | Some target -> target
        | None -> null

    let outcome existed =
        if existed then "Applied" else "AlreadyApplied"

    /// 为一次新的物理执行选 target 并托管容量：借用出借方 token、移交旧执行拥有的 token，或取一枚新 token。
    /// 无可用 target 时交还 null，并（除非 retireOnUnavailable === false）退休旧执行的托管。
    member _.routeFresh
        (
            sessionId: obj,
            oldPhysicalUserMessageId: obj,
            newPhysicalUserMessageId: obj,
            lenderSessionId: obj,
            routePolicy: obj,
            retireOnUnavailable: obj
        ) : obj =
        let sessionId = text "route" "sessionId" sessionId
        let oldPhysical = optionalText "route" "oldPhysicalUserMessageId" oldPhysicalUserMessageId
        let newPhysical = text "route" "newPhysicalUserMessageId" newPhysicalUserMessageId
        let lender = optionalText "route" "lenderSessionId" lenderSessionId
        let routePolicy = policy "route" routePolicy
        let oldKey = oldPhysical |> Option.map (fun physical -> executionKey sessionId (Some physical))
        let newKey = executionKey sessionId (Some newPhysical)

        match routeDecision lender routePolicy with
        | None ->
            if not (Wire.isNullish retireOnUnavailable) && not (Wire.isTrue retireOnUnavailable) then
                ()
            else
                oldKey |> Option.iter retireExecution

            null
        | Some(target, credit) -> commitRoutedTarget sessionId oldKey newKey newPhysical target lender credit

    /// 尚无物理消息时预留：同样的借用规则，托管记在该会话的“无物理消息”键下。
    member _.reserveFresh(sessionId: obj, lenderSessionId: obj, routePolicy: obj) : obj =
        let sessionId = text "reserve" "sessionId" sessionId
        let lender = optionalText "reserve" "lenderSessionId" lenderSessionId
        let routePolicy = policy "reserve" routePolicy

        match routeDecision lender routePolicy with
        | None -> null
        | Some(target, credit) ->
            match credit with
            | Some _ -> ()
            | None -> acquireOwnedToken sessionId None target |> ignore

            recordCredit "reserved credit is not legal for requester" sessionId (executionKey sessionId None) lender credit
            target

    /// 预留被物理消息采用：托管从“无物理消息”键移到该物理执行。
    member _.adoptReservation(sessionId: obj, physicalUserMessageId: obj, target: obj) : unit =
        let sessionId = text "adopt" "sessionId" sessionId
        let physical = text "adopt" "physicalUserMessageId" physicalUserMessageId
        let oldKey = executionKey sessionId None
        let newKey = executionKey sessionId (Some physical)

        match ownedTokenByExecution.TryGetValue oldKey with
        | true, tokenId -> adoptOwnedToken oldKey newKey target tokenId
        | false, _ -> ()

        moveCreditSource oldKey newKey

    /// 同一执行的续接：托管从上一物理消息移到下一物理消息；续接方已有托管或前者没有托管时抛出。
    member _.continueExecution(sessionId: obj, previousPhysicalId: obj, physicalId: obj, target: obj) : obj =
        let sessionId = text "continue" "sessionId" sessionId
        let oldKey = executionKey sessionId (Some(text "continue" "previousPhysicalId" previousPhysicalId))
        let newKey = executionKey sessionId (Some(text "continue" "physicalId" physicalId))

        if ownedTokenByExecution.ContainsKey newKey || creditSourceByExecution.ContainsKey newKey then
            Fail.op "continuation already owns capacity"

        match ownedTokenByExecution.TryGetValue oldKey with
        | true, tokenId -> adoptOwnedToken oldKey newKey target tokenId
        | false, _ when creditSourceByExecution.ContainsKey oldKey -> ()
        | _ -> Fail.op "continuation has no previous capacity"

        moveCreditSource oldKey newKey
        target

    /// 释放会话的全部托管与 provider-step 等待者；交还 Applied 或 AlreadyApplied。
    member _.releaseSession(sessionId: obj) : string =
        let sessionId = text "release" "sessionId" sessionId
        let prefix = executionPrefix sessionId

        let existed =
            waiters |> Seq.exists (fun demand -> demand.SessionId = sessionId)
            || (ownedTokenByExecution.Keys |> Seq.exists (fun key -> key.StartsWith(prefix, StringComparison.Ordinal)))
            || (creditSourceByExecution.Keys
                |> Seq.exists (fun key -> key.StartsWith(prefix, StringComparison.Ordinal)))

        cancelWaiters (fun demand -> demand.SessionId = sessionId)
        clearCreditSourcesForSession sessionId

        ownedTokenByExecution.Keys
        |> Seq.filter (fun key -> key.StartsWith(prefix, StringComparison.Ordinal))
        |> Seq.toArray
        |> Array.iter retireExecution

        drain ()
        outcome existed

    /// 释放一次精确物理执行的托管与等待者；交还 Applied 或 AlreadyApplied。
    member _.releasePhysical(sessionId: obj, physicalUserMessageId: obj) : string =
        let sessionId = text "release" "sessionId" sessionId
        let physical = text "release" "physicalUserMessageId" physicalUserMessageId
        let key = executionKey sessionId (Some physical)

        let existed =
            ownedTokenByExecution.ContainsKey key
            || creditSourceByExecution.ContainsKey key
            || (waiters
                |> Seq.exists (fun demand -> demand.SessionId = sessionId && demand.PhysicalUserMessageId = physical))

        cancelWaiters (fun demand -> demand.SessionId = sessionId && demand.PhysicalUserMessageId = physical)
        retireExecution key
        drain ()
        outcome existed

    /// provider step 准入：先按 fence 推进/收回，再复用同 requestKey 同 fence 的等待或在途 step，
    /// 否则排队并按到达序号依次尝试：自己拥有的 token → 借来的 token → tryOrdinary(running) 允许时取新 token。
    member _.enterStep
        (
            sessionId: obj,
            physicalUserMessageId: obj,
            target: obj,
            fence: obj,
            tryOrdinary: obj,
            requestKey: obj
        ) : Task =
        let sessionId = text "provider step" "sessionId" sessionId
        let physical = text "provider step" "physicalUserMessageId" physicalUserMessageId
        let fence = fenceOf fence
        let tryOrdinary = policy "provider step" tryOrdinary
        let requestKey = optionalText "provider step" "requestKey" requestKey
        reconcileFence sessionId physical fence

        match tryReuseExistingStep sessionId physical fence requestKey with
        | Some task -> task
        | None -> enqueueStep sessionId physical target fence requestKey tryOrdinary

    /// provider run 结束：结束该执行中 fence 不含此 run 的那个在途 step。
    member _.endStep(sessionId: obj, physicalUserMessageId: obj, providerRun: obj) : unit =
        let sessionId = text "end step" "sessionId" sessionId
        let physical = text "end step" "physicalUserMessageId" physicalUserMessageId
        let providerRun = text "end step" "providerRun" providerRun

        tokens.Values
        |> Seq.tryFind (fun token ->
            match token.State with
            | TokenState.InFlight step
            | TokenState.Retiring step ->
                step.SessionId = sessionId
                && step.PhysicalUserMessageId = physical
                && not (Set.contains providerRun step.Fence)
            | TokenState.Idle -> false)
        |> Option.iter finishStep

        drain ()

    /// step 被抑制：结束该执行的在途 step。
    member _.suppressStep(sessionId: obj, physicalUserMessageId: obj) : unit =
        let sessionId = text "suppress step" "sessionId" sessionId
        let physical = text "suppress step" "physicalUserMessageId" physicalUserMessageId

        tokens.Values
        |> Seq.tryFind (fun token ->
            match token.State with
            | TokenState.InFlight step
            | TokenState.Retiring step -> step.SessionId = sessionId && step.PhysicalUserMessageId = physical
            | TokenState.Idle -> false)
        |> Option.iter finishStep

        drain ()

    /// 这次物理执行精确托管的 credit（拥有的或借来的）；没有时抛出。
    member _.exactCredit(sessionId: obj, physicalUserMessageId: obj) : float =
        let sessionId = text "exact credit" "sessionId" sessionId
        let physical = text "exact credit" "physicalUserMessageId" physicalUserMessageId
        let key = executionKey sessionId (Some physical)

        match ownedTokenByExecution.TryGetValue key, creditSourceByExecution.TryGetValue key with
        | (true, credit), _ -> credit
        | (false, _), (true, source) -> source.Credit
        | _ -> Fail.op (sprintf "physical execution %s/%s has no exact capacity credit" sessionId physical)

    /// 只读不变量快照：账本、token、托管、provider-step 等待者与三种 token 状态计数。
    member _.invariantSnapshot() : obj =
        let ledgerEntries = ledgerEntries () |> Array.sortBy fst
        let targetByCredit = Map.ofArray ledgerEntries

        let tokenSnapshots =
            tokens.Values
            |> Seq.sortBy _.Credit
            |> Seq.map (fun token -> token, tokenStateName token.State)
            |> Seq.toArray

        let custodies =
            Seq.append
                (ownedTokenByExecution |> Seq.map (fun (KeyValue(key, credit)) -> credit, key))
                (creditSourceByExecution |> Seq.map (fun (KeyValue(key, source)) -> source.Credit, key))
            |> Seq.distinct
            |> Seq.sortBy (fun (_, key) ->
                let separator = key.IndexOf('\u001f')
                key.Substring(0, separator), key.Substring(separator + 1))
            |> Seq.map (fun (credit, key) -> Wire.freeze (createObj [ "credit" ==> credit; "owner" ==> executionOwner key ]))
            |> Seq.toArray

        let count state =
            tokenSnapshots |> Array.sumBy (fun (_, name) -> if name = state then 1 else 0)

        Wire.freeze (
            createObj
                [ "ledgerEntries"
                  ==> (ledgerEntries
                       |> Array.map (fun (credit, target) -> Wire.freeze (createObj [ "credit" ==> credit; "target" ==> target ]))
                       |> Wire.freezeArray)
                  "tokens"
                  ==> (tokenSnapshots
                       |> Array.map (fun (token, name) ->
                           Wire.freeze (
                               createObj
                                   [ "credit" ==> token.Credit
                                     "state" ==> name
                                     "owner" ==> executionOwner token.OwnerKey
                                     "target" ==> targetByCredit[token.Credit] ]
                           ))
                       |> Wire.freezeArray)
                  "custodies" ==> Wire.freezeArray custodies
                  "waiters"
                  ==> (waiters.ToArray()
                       |> Array.sortBy _.Sequence
                       |> Array.map (fun demand ->
                           Wire.freeze (
                               createObj
                                   [ "owner"
                                     ==> Wire.freeze (
                                         createObj
                                             [ "sessionId" ==> demand.SessionId
                                               "physicalUserMessageId" ==> demand.PhysicalUserMessageId ]
                                     )
                                     "sequence" ==> demand.Sequence
                                     "kind" ==> "ProviderStep" ]
                           ))
                       |> Wire.freezeArray)
                  "idleCount" ==> count "Idle"
                  "inFlightCount" ==> count "InFlight"
                  "retiringCount" ==> count "Retiring" ]
        )

    /// scheduler `running`：每枚真实 token 的当前 target。
    member _.snapshot() : obj array = ledgerSnapshot ()

    /// 让全部 provider-step 等待者以 error 失败并清空等待。
    member _.fail(error: obj) : unit =
        let pending = waiters.ToArray()
        waiters.Clear()

        pending
        |> Array.iter (fun demand ->
            try
                demand.Completion.SetException(unbox<exn> error)
            with _ ->
                ())
