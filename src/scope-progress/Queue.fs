module Wanxiangli.ScopeProgress.Queue

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<Import("createHash", "node:crypto")>]
let private hashConstructor (algorithm: string) : obj = jsNative

type private Process =
    { Id: string
      Epoch: string
      TriggerIds: ResizeArray<string>
      TriggerNotes: ResizeArray<string>
      mutable Phase: int }

type private SessionQueue =
    { mutable Active: Process option
      mutable Waiting: Process option
      Seen: Dictionary<string, Dictionary<string, string>> }

type AdvisorProcessQueuePort =
    abstract enqueue: sessionId: string * epochId: string * triggerId: string -> obj
    abstract enqueueWithNote: sessionId: string * epochId: string * triggerId: string * note: string -> obj
    abstract hasActive: sessionId: string * epochId: string -> bool
    abstract restoreGroup: sessionId: string * epochId: string * triggerIds: string array * notes: string array -> obj
    abstract advance: sessionId: string * processId: string * phase: int -> obj
    abstract finish: sessionId: string * processId: string -> obj
    abstract fail: sessionId: string * processId: string -> obj
    abstract reset: sessionId: string * epochId: string -> unit
    abstract clear: sessionId: string -> unit

let AdvisorProcessQueue () : AdvisorProcessQueuePort =
    let sessions = Dictionary<string, SessionQueue>()
    let processId (sessionId: string) (epoch: string) (trigger: string) =
        let field (value: string) = string value.Length + ":" + value
        let identity = field sessionId + field epoch + field trigger
        let digest = hashConstructor "sha256"
        let chain: obj = digest?update(identity, "utf8")
        "advisor:" + string (chain?digest("hex"))
    let make sessionId epoch trigger note =
        { Id = processId sessionId epoch trigger
          Epoch = epoch
          TriggerIds = ResizeArray [ trigger ]
          TriggerNotes = ResizeArray [ note ]
          Phase = 0 }
    let seat sessionId =
        match sessions.TryGetValue sessionId with
        | true, queue -> queue
        | _ ->
            let queue = { Active = None; Waiting = None; Seen = Dictionary() }
            sessions[sessionId] <- queue
            queue
    let receipt accepted started (candidate: Process) =
        createObj [ "ok" ==> true
                    "accepted" ==> accepted
                    "start" ==> started
                    "processId" ==> candidate.Id
                    "triggers" ==> candidate.TriggerIds.ToArray()
                    "notes" ==> candidate.TriggerNotes.ToArray() ]
    { new AdvisorProcessQueuePort with
        member _.hasActive(sessionId, epochId) =
            match sessions.TryGetValue sessionId with
            | true, queue -> queue.Active |> Option.exists (fun process -> process.Epoch = epochId)
            | _ -> false
        member _.restoreGroup(sessionId, epochId, triggerIds, notes) =
            if
                String.IsNullOrWhiteSpace sessionId
                || String.IsNullOrWhiteSpace epochId
                || triggerIds.Length = 0
                || triggerIds.Length <> notes.Length
                || triggerIds |> Array.exists String.IsNullOrWhiteSpace
                || triggerIds |> Array.distinct |> Array.length <> triggerIds.Length
            then
                createObj [ "ok" ==> false; "reason" ==> "nonempty, distinct report identities and exact notes required" ]
            else
                let queue = seat sessionId
                let active = queue.Active |> Option.filter (fun value -> value.Epoch = epochId)
                let waiting = queue.Waiting |> Option.filter (fun value -> value.Epoch = epochId)
                if active.IsSome || waiting.IsSome then
                    createObj [ "ok" ==> false; "reason" ==> "cannot restore a group over an active Advisor Process" ]
                else
                    let seen =
                        match queue.Seen.TryGetValue epochId with
                        | true, previous -> previous
                        | _ ->
                            let created = Dictionary<string, string>()
                            queue.Seen[epochId] <- created
                            created
                    if triggerIds |> Array.exists seen.ContainsKey then
                        createObj [ "ok" ==> false; "reason" ==> "one of the exact report identities was already observed" ]
                    else
                        let restored = make sessionId epochId triggerIds[0] notes[0]
                        for index in 1 .. triggerIds.Length - 1 do
                            restored.TriggerIds.Add triggerIds[index]
                            restored.TriggerNotes.Add notes[index]
                        for reportId in triggerIds do seen[reportId] <- restored.Id
                        queue.Active <- Some restored
                        queue.Waiting <- None
                        receipt true true restored
        member this.enqueue(sessionId, epochId, triggerId) =
            (this :> AdvisorProcessQueuePort).enqueueWithNote(sessionId, epochId, triggerId, "")
        member _.enqueueWithNote(sessionId, epochId, triggerId, note) =
            if String.IsNullOrWhiteSpace sessionId || String.IsNullOrWhiteSpace epochId || String.IsNullOrWhiteSpace triggerId then
                createObj [ "ok" ==> false; "reason" ==> "session, epoch and trigger identity required" ]
            else
                let queue = seat sessionId
                let active = queue.Active |> Option.filter (fun item -> item.Epoch = epochId)
                let waiting = queue.Waiting |> Option.filter (fun item -> item.Epoch = epochId)
                queue.Active <- active
                queue.Waiting <- waiting
                let seen =
                    match queue.Seen.TryGetValue epochId with
                    | true, previous -> previous
                    | _ ->
                        let created = Dictionary<string, string>()
                        queue.Seen[epochId] <- created
                        created
                match seen.TryGetValue triggerId with
                | true, processId ->
                    createObj [ "ok" ==> true; "accepted" ==> false; "start" ==> false; "processId" ==> processId ]
                | _ ->
                    match active, waiting with
                    | None, _ ->
                        let next = make sessionId epochId triggerId note
                        queue.Active <- Some next
                        seen[triggerId] <- next.Id
                        receipt true true next
                    | Some _, Some existing ->
                        existing.TriggerIds.Add triggerId
                        existing.TriggerNotes.Add note
                        seen[triggerId] <- existing.Id
                        receipt true false existing
                    | Some _, None ->
                        let next = make sessionId epochId triggerId note
                        queue.Waiting <- Some next
                        seen[triggerId] <- next.Id
                        receipt true false next
        member _.advance(sessionId, processId, phase) =
            let queue = seat sessionId
            match queue.Active with
            | Some active when active.Id = processId && phase = active.Phase + 1 && phase <= 4 ->
                active.Phase <- phase
                createObj [ "ok" ==> true; "phase" ==> phase ]
            | _ -> createObj [ "ok" ==> false; "reason" ==> "stale or out-of-order Advisor process phase" ]
        member _.finish(sessionId, processId) =
            let queue = seat sessionId
            match queue.Active with
            | Some active when active.Id = processId && active.Phase = 4 ->
                queue.Active <- queue.Waiting
                queue.Waiting <- None
                match queue.Active with
                | Some next -> receipt true true next
                | None -> createObj [ "ok" ==> true; "start" ==> false ]
            | _ -> createObj [ "ok" ==> false; "reason" ==> "Advisor process has not completed four phases" ]
        member _.fail(sessionId, processId) =
            let queue = seat sessionId
            match queue.Active with
            | Some active when active.Id = processId ->
                queue.Active <- queue.Waiting
                queue.Waiting <- None
                match queue.Active with
                | Some next -> receipt true true next
                | None -> createObj [ "ok" ==> true; "start" ==> false ]
            | _ -> createObj [ "ok" ==> false; "reason" ==> "not an active Advisor process" ]
        member _.reset(sessionId, _epochId) =
            sessions.Remove sessionId |> ignore
        member _.clear(sessionId) =
            sessions.Remove sessionId |> ignore }

let advisorProcessQueue = AdvisorProcessQueue()
