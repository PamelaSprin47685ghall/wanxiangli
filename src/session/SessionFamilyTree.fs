module Wanxiangli.Ownership.SessionFamilyTree

open System
open System.Collections.Generic
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type SessionFamilyResult =
    { ok: bool
      root: string
      error: string }
    member this.isOk = this.ok
    member this.isError = not this.ok
    member this.toResult() : Result<string, string> =
        if this.ok then Ok this.root else Error this.error

/// 领域会话家族树与祖先图网自治对象。
/// 
/// 核心契约与不变量：
/// 1. 扁平管理归属（HOST-015 "a son's son is a son"）：托管子会话统一指向其家族权威根 Family Root。
/// 2. 权威祖先解析与环路拦截：通过异步步进查询探索物理祖先链，环路当跳立即 fail-closed 报错并拒绝建立。
/// 3. 防幽灵复活：在异步多跳父链查询在途期间，若会话被外部销毁或注销，迟到查询结果严禁写回复活。
/// 4. 两步消息 Abort 责任闭环：
///    - childrenToAbort(parentId): 只读返回待中止子会话列表（不动名册）；
///    - settleAbort(parentId, results): 宿主上报每个 child 的中止结果 (childId, isAborted)。
///      库侧仅将确切已中止（isAborted=true）的子会话移出名册；失败的（isAborted=false）保留在名册以便下次重试，绝不失管。
[<AttachMembers>]
type SessionFamilyTree(?familyParent: string -> string option) =
    let parentChildMap = Dictionary<string, HashSet<string>>()
    let childParents = Dictionary<string, string>()
    let knownRoots = HashSet<string>()
    let clearedChildren = HashSet<string>()
    let abortingRoots = HashSet<string>()
    let lockObj = obj ()
    let mutable mutationEpoch = 0
    let restoredParent = defaultArg familyParent (fun _ -> None)

    let findRestoredRoot (sessionId: string) =
        let visited = HashSet<string>()

        let nextRestoredStep current =
            match restoredParent current with
            | Some parentId when parentId <> current -> Some parentId
            | _ -> None

        let rec loop current =
            if not (visited.Add current) then
                current
            else
                nextRestoredStep current |> Option.map loop |> Option.defaultValue current

        loop sessionId

    let knownOrDeclaredRoot (sessionId: string) =
        if knownRoots.Contains sessionId then
            Some sessionId
        else
            None

    let tryFindKnownRoot (sessionId: string) =
        match childParents.TryGetValue sessionId with
        | true, rootId -> Some rootId
        | false, _ -> knownOrDeclaredRoot sessionId

    let pruneEmptyRoot (rootId: string) =
        if parentChildMap.ContainsKey rootId && parentChildMap.[rootId].Count = 0 then
            parentChildMap.Remove rootId |> ignore

    let detachFromRoot (rootId: string) (childId: string) =
        if parentChildMap.ContainsKey rootId then
            parentChildMap.[rootId].Remove childId |> ignore

    let parseStepResult (res: obj) : Result<string option, string> =
        if isNull res then
            Error "null step query result"
        elif res?ok = true then
            let p = res?parent
            if isNull (box p) || (box p :? unit) then
                Ok None
            elif box p :? string then
                let s = unbox<string> p
                if String.IsNullOrEmpty s then Ok None else Ok (Some s)
            else
                Ok None
        elif res?ok = false then
            let err =
                if isNull (box res?error) then "unknown query error"
                else string res?error
            Error err
        elif res?tag = 0 then
            // F# Result.Ok
            let valObj = res?fields?(0)
            if isNull valObj then
                Ok None
            elif box valObj :? string then
                let s = unbox<string> valObj
                if String.IsNullOrEmpty s then Ok None else Ok (Some s)
            elif valObj?tag = 0 then
                // Some x
                Ok (Some (string valObj?fields?(0)))
            else
                Ok None
        elif res?tag = 1 then
            // F# Result.Error
            Error (string res?fields?(0))
        else
            Error "invalid step query result shape"

    member _.registerChild(parentId: string, childId: string) : string =
        lock lockObj (fun () ->
            mutationEpoch <- mutationEpoch + 1
            clearedChildren.Remove childId |> ignore

            let rootId =
                match childParents.TryGetValue parentId with
                | true, value -> value
                | false, _ ->
                    match tryFindKnownRoot parentId with
                    | Some r -> r
                    | None -> parentId

            match childParents.TryGetValue childId with
            | true, previousRoot when previousRoot <> rootId && parentChildMap.ContainsKey previousRoot ->
                parentChildMap.[previousRoot].Remove childId |> ignore
            | _ -> ()

            if not (parentChildMap.ContainsKey rootId) then
                parentChildMap.[rootId] <- HashSet<string>()

            parentChildMap.[rootId].Add childId |> ignore
            childParents.[childId] <- rootId
            knownRoots.Add rootId |> ignore
            rootId
        )

    member _.resolveFamilyRoot(targetId: string, stepQuery: obj) : Task<SessionFamilyResult> =
        task {
            // 起始快速路径（0 次外部查询）
            let (knownOpt, startEpoch, isAborting) =
                lock lockObj (fun () ->
                    let k = tryFindKnownRoot targetId
                    let aborting = abortingRoots.Contains targetId
                    (k, mutationEpoch, aborting)
                )

            if isAborting then
                return { ok = false; root = null; error = sprintf "Session %s is currently aborting" targetId }
            else
                match knownOpt with
                | Some known ->
                    return { ok = true; root = known; error = null }
                | None ->
                    let visited = HashSet<string>()
                    let ancestors = ResizeArray<string>()

                    let callQuery (curr: string) : Task<Result<string option, string>> =
                        task {
                            try
                                let rawTask: Task<obj> =
                                    if stepQuery?Invoke <> null then
                                        stepQuery?Invoke curr
                                    else
                                        stepQuery $ curr
                                let! rawRes = rawTask
                                return parseStepResult rawRes
                            with ex ->
                                return Error ex.Message
                        }

                    let rec walk (current: string) : Task<Result<string, string>> =
                        task {
                            // 1. 环路拦截：当跳立即检查
                            if not (visited.Add current) then
                                return Error (sprintf "Session ancestry cycle detected at %s" current)
                            else
                                ancestors.Add current
                                // 2. 中途已知缓存命中检查
                                let knownStepOpt =
                                    if current <> targetId then
                                        lock lockObj (fun () -> tryFindKnownRoot current)
                                    else
                                        None

                                match knownStepOpt with
                                | Some known ->
                                    return Ok known
                                | None ->
                                    // 3. 外部单跳物理查询
                                    let! parentResult = callQuery current
                                    match parentResult with
                                    | Error err ->
                                        return Error err
                                    | Ok (Some p) ->
                                        return! walk p
                                    | Ok None ->
                                        // 物理链到达物理根
                                        return Ok current
                        }

                    let! result = walk targetId
                    match result with
                    | Ok root ->
                        let recorded =
                            lock lockObj (fun () ->
                                // 防幽灵复活与代际保护：
                                // 1. root 不能处于 aborting 状态；
                                // 2. ancestors 中不得有任意节点已处于 clearedChildren 中
                                let isRevivedGhost =
                                    abortingRoots.Contains root
                                    || ancestors |> Seq.exists (fun a -> clearedChildren.Contains a)

                                if not isRevivedGhost then
                                    knownRoots.Add root |> ignore
                                    for ancestor in ancestors do
                                        if ancestor <> root then
                                            childParents.[ancestor] <- root
                                            if not (parentChildMap.ContainsKey root) then
                                                parentChildMap.[root] <- HashSet<string>()
                                            parentChildMap.[root].Add ancestor |> ignore
                                    true
                                else
                                    false
                            )
                        if recorded then
                            return { ok = true; root = root; error = null }
                        else
                            return { ok = false; root = null; error = sprintf "Session ancestry resolution discarded: session or root %s was cleared or aborting" root }
                    | Error err ->
                        return { ok = false; root = null; error = err }
        }

    member _.familyRootOf(sessionId: string) : string =
        lock lockObj (fun () ->
            match tryFindKnownRoot sessionId with
            | Some root -> root
            | None ->
                let root = findRestoredRoot sessionId
                if root <> sessionId then
                    childParents.[sessionId] <- root
                    knownRoots.Add root |> ignore
                    root
                else
                    sessionId
        )

    member _.isManagedChild(sessionId: string) : bool =
        lock lockObj (fun () ->
            childParents.ContainsKey sessionId || (restoredParent sessionId |> Option.isSome)
        )

    member _.listChildren(parentId: string) : string array =
        lock lockObj (fun () ->
            match parentChildMap.TryGetValue parentId with
            | true, set -> set |> Seq.toArray
            | false, _ -> [||]
        )

    /// 两步中止：步骤 1，只读返回待中止的子会话快照，不动名册
    member _.childrenToAbort(parentId: string) : string array =
        lock lockObj (fun () ->
            match parentChildMap.TryGetValue parentId with
            | true, set ->
                abortingRoots.Add parentId |> ignore
                set |> Seq.toArray
            | false, _ ->
                [||]
        )

    /// 两步中止：步骤 2，根据宿主物理执行的实际确切结果结算
    /// 仅将 isAborted = true 的 child 从名册摘除；isAborted = false 的严格保留以便重试
    member _.settleAbort(parentId: string, results: (string * bool) array) : unit =
        lock lockObj (fun () ->
            mutationEpoch <- mutationEpoch + 1
            abortingRoots.Remove parentId |> ignore

            for (childId, isAborted) in results do
                if isAborted then
                    clearedChildren.Add childId |> ignore
                    match childParents.TryGetValue childId with
                    | true, rootId ->
                        childParents.Remove childId |> ignore
                        detachFromRoot rootId childId
                        pruneEmptyRoot rootId
                    | false, _ -> ()
        )

    member _.settleAbortOne(parentId: string, childId: string, isAborted: bool) : unit =
        lock lockObj (fun () ->
            mutationEpoch <- mutationEpoch + 1
            if isAborted then
                clearedChildren.Add childId |> ignore
                match childParents.TryGetValue childId with
                | true, rootId ->
                    childParents.Remove childId |> ignore
                    detachFromRoot rootId childId
                    pruneEmptyRoot rootId
                | false, _ -> ()
        )

    member _.endAbort(parentId: string) : unit =
        lock lockObj (fun () ->
            abortingRoots.Remove parentId |> ignore
        )

    member _.detachChild(childId: string) : unit =
        lock lockObj (fun () ->
            mutationEpoch <- mutationEpoch + 1
            clearedChildren.Add childId |> ignore
            match childParents.TryGetValue childId with
            | true, rootId ->
                childParents.Remove childId |> ignore
                detachFromRoot rootId childId
                pruneEmptyRoot rootId
            | false, _ -> ()
        )

    member _.clearSession(sessionId: string) : unit =
        lock lockObj (fun () ->
            mutationEpoch <- mutationEpoch + 1
            clearedChildren.Add sessionId |> ignore
            abortingRoots.Remove sessionId |> ignore

            match childParents.TryGetValue sessionId with
            | true, rootId ->
                childParents.Remove sessionId |> ignore
                detachFromRoot rootId sessionId
                pruneEmptyRoot rootId
            | false, _ -> ()

            if parentChildMap.ContainsKey sessionId then
                let children = parentChildMap.[sessionId] |> Seq.toArray
                for c in children do
                    childParents.Remove c |> ignore
                    clearedChildren.Add c |> ignore
                parentChildMap.Remove sessionId |> ignore

            knownRoots.Remove sessionId |> ignore
        )

    member _.clearAll() : unit =
        lock lockObj (fun () ->
            mutationEpoch <- mutationEpoch + 1
            parentChildMap.Clear()
            childParents.Clear()
            knownRoots.Clear()
            clearedChildren.Clear()
            abortingRoots.Clear()
        )

    member _.snapshot() : obj =
        lock lockObj (fun () ->
            {| roots = knownRoots |> Seq.toArray
               childParents = childParents |> Seq.map (fun kv -> kv.Key, kv.Value) |> Seq.toArray
               abortingRoots = abortingRoots |> Seq.toArray
               clearedChildren = clearedChildren |> Seq.toArray |}
            |> box
        )
