module Wanxiangli.Degeneration.ReliabilityCounters

open System
open Fable.Core
open Fable.Core.JsInterop

type ReliabilityCounterSnapshot =
    { identityConflicts: int64
      queueFull: int64
      fatalSettlements: int64
      recoveryObserveOnly: int64
      recoveryResumeAdmission: int64
      recoveryReconcileStartedProvider: int64
      recoveryMarkTerminal: int64
      recoveryFailClosed: int64
      recoveryManualIntervention: int64
      hookFailures: int64
      fallbackAdvances: int64
      streamAborts: int64 }

[<Emit("Object.freeze($0)")>]
let private freeze (value: 'T) : 'T = jsNative

[<AttachMembers>]
type ReliabilityDiagnosticsStore() =
    let gate = obj ()
    let mutable identityConflicts = 0L
    let mutable queueFull = 0L
    let mutable fatalSettlements = 0L
    let mutable recoveryObserveOnly = 0L
    let mutable recoveryResumeAdmission = 0L
    let mutable recoveryReconcileStartedProvider = 0L
    let mutable recoveryMarkTerminal = 0L
    let mutable recoveryFailClosed = 0L
    let mutable recoveryManualIntervention = 0L
    let mutable hookFailures = 0L
    let mutable fallbackAdvances = 0L
    let mutable streamAborts = 0L

    member _.Record(kind: string) : unit =
        lock gate (fun () ->
            match kind with
            | "identityConflict" -> identityConflicts <- identityConflicts + 1L
            | "queueFull" -> queueFull <- queueFull + 1L
            | "fatalSettlement" -> fatalSettlements <- fatalSettlements + 1L
            | "recovery:observeOnly" -> recoveryObserveOnly <- recoveryObserveOnly + 1L
            | "recovery:resumeAdmission" -> recoveryResumeAdmission <- recoveryResumeAdmission + 1L
            | "recovery:reconcileStartedProvider" -> recoveryReconcileStartedProvider <- recoveryReconcileStartedProvider + 1L
            | "recovery:markTerminal" -> recoveryMarkTerminal <- recoveryMarkTerminal + 1L
            | "recovery:failClosed" -> recoveryFailClosed <- recoveryFailClosed + 1L
            | "recovery:manualIntervention" -> recoveryManualIntervention <- recoveryManualIntervention + 1L
            | "hookFailure" -> hookFailures <- hookFailures + 1L
            | "fallbackAdvanced" -> fallbackAdvances <- fallbackAdvances + 1L
            | "streamAbort" -> streamAborts <- streamAborts + 1L
            | unknown -> invalidArg "kind" ("unknown reliability observation kind: " + unknown))

    member _.Snapshot() : obj =
        lock gate (fun () ->
            freeze
                {| identityConflicts = identityConflicts
                   queueFull = queueFull
                   fatalSettlements = fatalSettlements
                   recoveryObserveOnly = recoveryObserveOnly
                   recoveryResumeAdmission = recoveryResumeAdmission
                   recoveryReconcileStartedProvider = recoveryReconcileStartedProvider
                   recoveryMarkTerminal = recoveryMarkTerminal
                   recoveryFailClosed = recoveryFailClosed
                   recoveryManualIntervention = recoveryManualIntervention
                   hookFailures = hookFailures
                   fallbackAdvances = fallbackAdvances
                   streamAborts = streamAborts |})

    member _.Reset() : unit =
        lock gate (fun () ->
            identityConflicts <- 0L
            queueFull <- 0L
            fatalSettlements <- 0L
            recoveryObserveOnly <- 0L
            recoveryResumeAdmission <- 0L
            recoveryReconcileStartedProvider <- 0L
            recoveryMarkTerminal <- 0L
            recoveryFailClosed <- 0L
            recoveryManualIntervention <- 0L
            hookFailures <- 0L
            fallbackAdvances <- 0L
            streamAborts <- 0L)

[<AttachMembers>]
type ReliabilityCounters() =
    inherit ReliabilityDiagnosticsStore()

let reliabilityDiagnosticsStore = ReliabilityDiagnosticsStore()
let reliabilityCounters = reliabilityDiagnosticsStore

let createReliabilityDiagnosticsStore () = ReliabilityDiagnosticsStore()
let createReliabilityCounters () = ReliabilityDiagnosticsStore()
