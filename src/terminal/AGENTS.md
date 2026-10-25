# wanxiangli/terminal

Autonomous Smalltalk/Actor-style objects for terminal facts, sticky replay, run deduplication, and reference-counted sharing.

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
