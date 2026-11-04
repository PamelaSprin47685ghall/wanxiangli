module Wanxiangli.DelegateBatch.DeferredInspectionStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

type DeferredCallRecord =
    { callId: string
      charge: string
      keywords: string
      estimate: int option
      stagedAt: int64 }

/// EXEC-026/031 / Package-SyncDelegate-Batch:
/// Autonomous process-local store for deferred inspection batches and settled replacement results.
/// 1. Session-scoped FIFO deferred call queue (pendingCalls).
/// 2. Deduplication check: duplicate callId staging is rejected.
/// 3. Replaced result storage and fast lookup for tool output rewriting.
/// 4. Complete session cleanup and global settlement to prevent memory leaks.
[<AttachMembers>]
type DeferredInspectionStore() =
    let gate = obj ()

    let pendingCalls = Dictionary<string, ResizeArray<DeferredCallRecord>>()
    let callToSession = Dictionary<string, string>()
    let replacedResults = Dictionary<string, string>()
    let replacedBySession = Dictionary<string, HashSet<string>>()

    let cleanKey (s: string) : string =
        if isNull s then "" else s.Trim()

    member _.stage
        (
            sessionId: string,
            callId: string,
            charge: string,
            keywords: string,
            estimate: int option
        ) : obj =
        let sKey = cleanKey sessionId
        let cKey = cleanKey callId
        if String.IsNullOrEmpty sKey || String.IsNullOrEmpty cKey || String.IsNullOrEmpty charge then
            createObj
                [ "ok" ==> false
                  "stagedCount" ==> 0
                  "reason" ==> "InvalidInput" ]
        else
            lock gate (fun () ->
                if callToSession.ContainsKey cKey then
                    let existingSession = callToSession[cKey]
                    createObj
                        [ "ok" ==> false
                          "stagedCount" ==> (if pendingCalls.ContainsKey sKey then pendingCalls[sKey].Count else 0)
                          "reason" ==> "DuplicateCall"
                          "existingSession" ==> existingSession ]
                else
                    let list =
                        match pendingCalls.TryGetValue sKey with
                        | true, cur -> cur
                        | false, _ ->
                            let cur = ResizeArray<DeferredCallRecord>()
                            pendingCalls[sKey] <- cur
                            cur

                    let record =
                        { callId = cKey
                          charge = charge
                          keywords = if isNull keywords then "" else keywords
                          estimate = estimate
                          stagedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }

                    list.Add record
                    callToSession[cKey] <- sKey

                    createObj
                        [ "ok" ==> true
                          "stagedCount" ==> list.Count
                          "callId" ==> cKey
                          "reason" ==> (null: obj) ])

    member _.takePending(sessionId: string) : obj array =
        let sKey = cleanKey sessionId
        lock gate (fun () ->
            match pendingCalls.TryGetValue sKey with
            | true, list when list.Count > 0 ->
                pendingCalls.Remove sKey |> ignore
                let arr =
                    list
                    |> Seq.map (fun r ->
                        callToSession.Remove r.callId |> ignore
                        createObj
                            [ "callId" ==> r.callId
                              "charge" ==> r.charge
                              "keywords" ==> r.keywords
                              "estimate" ==> (match r.estimate with Some e -> box e | None -> null)
                              "stagedAt" ==> r.stagedAt ])
                    |> Seq.toArray
                arr
            | _ ->
                pendingCalls.Remove sKey |> ignore
                ([||]: obj array))

    member _.hasPending(sessionId: string) : bool =
        let sKey = cleanKey sessionId
        lock gate (fun () ->
            match pendingCalls.TryGetValue sKey with
            | true, list -> list.Count > 0
            | false, _ -> false)

    member _.pendingCount(sessionId: string) : int =
        let sKey = cleanKey sessionId
        lock gate (fun () ->
            match pendingCalls.TryGetValue sKey with
            | true, list -> list.Count
            | false, _ -> 0)

    member _.totalPendingCallsCount : int =
        lock gate (fun () ->
            let mutable total = 0
            for list in pendingCalls.Values do
                total <- total + list.Count
            total)

    member _.pendingSessionsCount : int =
        lock gate (fun () -> pendingCalls.Count)

    member _.recordReplacedResult(callId: string, replacement: string, ?sessionId: string) : bool =
        let cKey = cleanKey callId
        if String.IsNullOrEmpty cKey then
            false
        else
            let rep = if isNull replacement then "" else replacement
            lock gate (fun () ->
                replacedResults[cKey] <- rep
                let targetSession =
                    match sessionId with
                    | Some sid when not (String.IsNullOrEmpty(cleanKey sid)) -> cleanKey sid
                    | _ ->
                        match callToSession.TryGetValue cKey with
                        | true, sid -> sid
                        | false, _ -> ""

                if not (String.IsNullOrEmpty targetSession) then
                    let set =
                        match replacedBySession.TryGetValue targetSession with
                        | true, cur -> cur
                        | false, _ ->
                            let cur = HashSet<string>()
                            replacedBySession[targetSession] <- cur
                            cur
                    set.Add cKey |> ignore
                true)

    member this.recordReplacedResults(results: (string * string) seq, ?sessionId: string) : int =
        let mutable count = 0
        for (cid, rep) in results do
            if this.recordReplacedResult(cid, rep, ?sessionId = sessionId) then
                count <- count + 1
        count

    member _.tryReplacedResult(callId: string) : string option =
        let cKey = cleanKey callId
        lock gate (fun () ->
            match replacedResults.TryGetValue cKey with
            | true, rep -> Some rep
            | false, _ -> None)

    member _.hasReplacedResults () : bool =
        lock gate (fun () -> replacedResults.Count > 0)

    member _.replacedResultsCount : int =
        lock gate (fun () -> replacedResults.Count)

    member _.clearSession(sessionId: string) : obj =
        let sKey = cleanKey sessionId
        lock gate (fun () ->
            let mutable droppedPending = 0
            match pendingCalls.TryGetValue sKey with
            | true, list ->
                droppedPending <- list.Count
                for r in list do
                    callToSession.Remove r.callId |> ignore
                pendingCalls.Remove sKey |> ignore
            | false, _ -> ()

            let mutable droppedReplaced = 0
            match replacedBySession.TryGetValue sKey with
            | true, calls ->
                droppedReplaced <- calls.Count
                for cid in calls do
                    replacedResults.Remove cid |> ignore
                replacedBySession.Remove sKey |> ignore
            | false, _ -> ()

            createObj
                [ "droppedPending" ==> droppedPending
                  "droppedReplaced" ==> droppedReplaced ])

    member _.clearReplacedResults () : int =
        lock gate (fun () ->
            let count = replacedResults.Count
            replacedResults.Clear()
            replacedBySession.Clear()
            count)

    member _.clearAll () : obj =
        lock gate (fun () ->
            let sessions = pendingCalls.Count
            let pendingTotal = callToSession.Count
            let replacedTotal = replacedResults.Count

            pendingCalls.Clear()
            callToSession.Clear()
            replacedResults.Clear()
            replacedBySession.Clear()

            createObj
                [ "droppedSessions" ==> sessions
                  "droppedPendingCalls" ==> pendingTotal
                  "droppedReplacedResults" ==> replacedTotal ])

    member _.snapshot () : obj =
        lock gate (fun () ->
            let mutable totalPending = 0
            let pendingBySess = Dictionary<string, int>()
            for kv in pendingCalls do
                pendingBySess[kv.Key] <- kv.Value.Count
                totalPending <- totalPending + kv.Value.Count

            createObj
                [ "pendingSessionsCount" ==> pendingCalls.Count
                  "totalPendingCallsCount" ==> totalPending
                  "replacedResultsCount" ==> replacedResults.Count ])

let deferredInspectionStore = DeferredInspectionStore()
