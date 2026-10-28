# wanxiangli/terminal

Autonomous Smalltalk/Actor-style objects for terminal facts, sticky replay, run deduplication, reference-counted sharing, and projection message visibility waiting.

## Responsibilities

1. **TerminalRegistry**:
   - Owns listeners, session sticky cache (FIFO capped at 256), and last completed run deduplication dictionary.
   - Dispatches safely to listeners; faults are reported through the explicit `reportFault` port.
   - Deduplication rules:
     - `Completed(Some runId, _)` is deduplicated per session.
     - `Completed(None, _)` is never deduplicated.
     - `Failed` and `Aborted` are never deduplicated.
   - Distinguishes session-scoped vs process-scoped listeners, and sticky-replay vs future-only subscriptions.
   - `HasSubscriber` checks only session-level live subscriptions.
   - Taking snapshot under lock, invoking listener outside lock. Disposed listeners are marked `Live = false` so in-flight snapshots do not deliver.

2. **TerminalBus**:
   - Reference-counted registry of `TerminalRegistry` instances by string key.
   - First-wins acquisition.
   - Release requires reference equality (`obj.ReferenceEquals`).

3. **MessageVisibilityHub**:
   - Owns per-session one-shot waiters (`Dictionary<string, ResizeArray<VisibilityWaiter>>`) and deadline backstop coordination.
   - Neutral timer/delay contract: accepts custom delay factory, `ITimerPort`-like objects with `.Delay(ms)`, or falls back to native `setTimeout`/`clearTimeout`.
   - `Notify(sessionId)` atomically takes and removes all waiters for the session, cancels their deadline backstops, and resolves completion tasks.
   - `AwaitChange(sessionId, budgetMs)` registers a waiter and attaches deadline settlement. Settled waiter removes itself from the dictionary and drops the session key when empty.
   - `PendingCount(sessionId)` provides leak detection probe; zero waiters leaves no dangling keys.
   - `Clear(sessionId)` and `ClearAll()` support session and global drain/cleanup.
