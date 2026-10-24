namespace Wanxiangli.Time

open System
open System.Threading.Tasks
open Fable.Core.JsInterop

module NodeTiming =

    /// Fable 的 TaskCompletionSource 未暴露 TrySet*；用守卫包装 SetResult。
    /// .NET 下捕获已完成 TCS 抛出的异常，Fable 下 Promise resolver 幂等。
    let private trySetResult (completion: TaskCompletionSource<'T>) (value: 'T) : bool =
        try
            completion.SetResult(value)
            true
        with _ ->
            false

    let timerTask (milliseconds: int) : Task<unit> =
        let completion = TaskCompletionSource<unit>()

        if milliseconds >= 1000 then
            (emitJsExpr (milliseconds, (fun () -> completion.SetResult())) "setTimeout($1, $0).unref()": obj)
            |> ignore
        else
            (emitJsExpr (milliseconds, (fun () -> completion.SetResult())) "setTimeout($1, $0)": obj)
            |> ignore

        completion.Task

    let raceExit (exitTask: Task) (milliseconds: int) : Task<bool> =
        emitJsExpr
            (exitTask, milliseconds)
            """
            new Promise((resolve, reject) => {
                let timer = null;
                $0.then(
                    () => {
                        if (timer !== null) { clearTimeout(timer); timer = null; }
                        resolve(true);
                    },
                    (err) => {
                        if (timer !== null) { clearTimeout(timer); timer = null; }
                        reject(err);
                    }
                );
                timer = setTimeout(() => {
                    timer = null;
                    resolve(false);
                }, $1);
                if ($1 >= 1000 && timer !== null && typeof timer.unref === 'function') {
                    timer.unref();
                }
            })
            """

    let nodeTimerPort () : ITimerPort =
        let mutable disposed = false

        { new ITimerPort with
            member _.Delay(milliseconds: int) =
                let completion = TaskCompletionSource<unit>()
                let mutable cancelled = false

                let fire () =
                    if not cancelled && not disposed then
                        trySetResult completion () |> ignore

                let timerId: obj =
                    if milliseconds >= 1000 then
                        emitJsExpr (milliseconds, fire) "setTimeout($1, $0).unref()"
                    else
                        emitJsExpr (milliseconds, fire) "setTimeout($1, $0)"

                { new IDeadlineHandle with
                    member _.Delay = completion.Task

                    member _.Cancel() =
                        if not cancelled then
                            cancelled <- true
                            (emitJsExpr timerId "clearTimeout($0)": unit) }

            member _.Dispose() = disposed <- true }

    let nodeClockPort () : IClockPort =
        { new IClockPort with
            member _.UtcNow() = DateTimeOffset.UtcNow }
