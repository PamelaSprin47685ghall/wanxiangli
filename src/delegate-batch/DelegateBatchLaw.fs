module Wanxiangli.DelegateBatch.DelegateBatchLaw

open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type DelegateBatchLaw() =
    inherit DelegateBatchLawCore()

type JoinGuardScope = JoinGuardReservationStore.JoinGuardScope
type JoinGuardReservationStore = JoinGuardReservationStore.JoinGuardReservationStore
let joinGuardReservationStore = JoinGuardReservationStore.joinGuardReservationStore

type RetiredDelegateRegistry = RetiredDelegateRegistry.RetiredDelegateRegistry
let retiredDelegateRegistry = RetiredDelegateRegistry.retiredDelegateRegistry

type SyncDelegateBatchStore = SyncDelegateBatchStore.SyncDelegateBatchStore
let syncDelegateBatchStore = SyncDelegateBatchStore.syncDelegateBatchStore
