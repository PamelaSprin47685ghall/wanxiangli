namespace Wanxiangli.Time

open System
open System.Threading.Tasks

type VirtualTimerPort =
    { Port: ITimerPort
      Advance: int -> unit
      NowMs: unit -> int }

type VirtualClockPort =
    { Port: IClockPort
      AdvanceMs: int -> unit
      /// JS 面接受 ISO 时刻字符串（与主仓 clockSet 一致），内部解析为 DateTimeOffset。
      Set: string -> unit }

module VirtualTiming =

    let private trySetResult (completion: TaskCompletionSource<'T>) (value: 'T) : bool =
        try
            completion.SetResult(value)
            true
        with _ ->
            false

    let createVirtualTimerPort () : VirtualTimerPort =
        // 虚拟时钟游标；未推进到 fireAt 前绝不触发
        let mutable nowMs = 0
        let mutable disposed = false
        let mutable nextId = 0
        let entries = ResizeArray<int * int * TaskCompletionSource<unit> * bool ref>()

        let removeId (id: int) =
            let index = entries |> Seq.tryFindIndex (fun (entryId, _, _, _) -> entryId = id)

            match index with
            | Some value -> entries.RemoveAt(value)
            | None -> ()

        let port =
            { new ITimerPort with
                member _.Delay(milliseconds: int) =
                    let completion = TaskCompletionSource<unit>()
                    let cancelled = ref false
                    let id = nextId
                    nextId <- nextId + 1
                    let fireAt = nowMs + max 0 milliseconds
                    entries.Add((id, fireAt, completion, cancelled))

                    { new IDeadlineHandle with
                        member _.Delay = completion.Task

                        member _.Cancel() =
                            if not cancelled.Value then
                                cancelled.Value <- true
                                removeId id }

                member _.Dispose() =
                    disposed <- true
                    entries.Clear() }

        let fireOne (id: int) (completion: TaskCompletionSource<unit>) (cancelled: bool ref) =
            if not cancelled.Value then
                cancelled.Value <- true
                removeId id
                trySetResult completion () |> ignore

        let advance (milliseconds: int) =
            if disposed then
                ()
            else
                nowMs <- nowMs + max 0 milliseconds

                let due =
                    entries
                    |> Seq.filter (fun (_, fireAt, _, cancelled) -> not cancelled.Value && fireAt <= nowMs)
                    |> Seq.toList

                for id, _, completion, cancelled in due do
                    fireOne id completion cancelled

        { Port = port
          Advance = advance
          NowMs = fun () -> nowMs }

    let createVirtualClockPort () : VirtualClockPort =
        let mutable now = DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero)

        let port =
            { new IClockPort with
                member _.UtcNow() = now }

        { Port = port
          AdvanceMs = fun ms -> now <- now.AddMilliseconds(float (max 0 ms))
          Set = fun value -> now <- DateTimeOffset.Parse(value) }
