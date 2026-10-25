module Wanxiangli.Casebook.SessionDraftStore

open System.Collections.Generic
open Fable.Core

[<AttachMembers>]
type CasebookDraftTurn =
    { Q: string
      A: string option }

[<AttachMembers>]
type CasebookDraftSnapshot =
    { turns: CasebookDraftTurn array }

type private Draft =
    { mutable Turns: CasebookDraftTurn list }

/// 进程内会话草稿自治存储对象。
/// 追踪每个委托会话在执行期间的问答轮次，支持原地覆写 Q、追加新轮、覆写 A 及原子消费（tryTake）。
[<AttachMembers>]
type SessionDraftStore() =
    // DSL-MUTABLE: resource — per-session casebook draft registry
    let drafts = Dictionary<string, Draft>()

    member _.setQ(sessionId: string, q: string) : unit =
        match drafts.TryGetValue(sessionId) with
        | false, _ ->
            drafts.[sessionId] <- { Turns = [ { Q = q; A = None } ] }
        | true, draft ->
            match draft.Turns with
            | [] ->
                draft.Turns <- [ { Q = q; A = None } ]
            | turns ->
                let last = List.last turns
                let init = turns |> List.take (List.length turns - 1)
                match last.A with
                | None ->
                    draft.Turns <- init @ [ { last with Q = q } ]
                | Some _ ->
                    draft.Turns <- turns @ [ { Q = q; A = None } ]

    member _.setA(sessionId: string, a: string) : unit =
        match drafts.TryGetValue(sessionId) with
        | false, _ ->
            drafts.[sessionId] <- { Turns = [ { Q = ""; A = Some a } ] }
        | true, draft ->
            match draft.Turns with
            | [] ->
                draft.Turns <- [ { Q = ""; A = Some a } ]
            | turns ->
                let last = List.last turns
                let init = turns |> List.take (List.length turns - 1)
                draft.Turns <- init @ [ { last with A = Some a } ]

    member _.tryTake(sessionId: string) : CasebookDraftSnapshot option =
        match drafts.TryGetValue(sessionId) with
        | true, draft ->
            drafts.Remove(sessionId) |> ignore
            let arr =
                draft.Turns
                |> List.map (fun t -> { Q = t.Q; A = t.A })
                |> List.toArray
            Some { turns = arr }
        | false, _ ->
            None

    member _.clear(sessionId: string) : unit =
        drafts.Remove(sessionId) |> ignore

    member _.lastQuestion(draft: CasebookDraftSnapshot) : string =
        if draft.turns.Length = 0 then
            ""
        else
            draft.turns.[draft.turns.Length - 1].Q

    member _.lastAnswer(draft: CasebookDraftSnapshot) : string option =
        let mutable found = None
        let mutable i = draft.turns.Length - 1
        while i >= 0 && found.IsNone do
            match draft.turns.[i].A with
            | Some a -> found <- Some a
            | None -> ()
            i <- i - 1
        found

    member _.transcript(draft: CasebookDraftSnapshot) : string =
        let lines =
            draft.turns
            |> Array.mapi (fun i t ->
                let n = string (i + 1)
                let a = defaultArg t.A ""
                "Q" + n + " = " + t.Q + "\nA" + n + " = " + a)
        String.concat "\n" lines

let sessionDraftStore = SessionDraftStore()
