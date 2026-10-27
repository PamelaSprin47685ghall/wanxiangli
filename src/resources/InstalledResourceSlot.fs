[<AutoOpen>]
module Wanxiangli.Resources.InstalledResourceSlot

open System
open Fable.Core

/// Autonomous state holder for an installed runtime resource singleton (clean-break from host mutable).
[<AttachMembers>]
type InstalledResourceSlot(missingErrorMessage: string) =
    let mutable current: obj option = None

    member _.install(value: obj) : unit =
        current <- Some value

    member _.tryGet() : obj option =
        current

    member _.require() : obj =
        match current with
        | Some value -> value
        | None -> invalidOp missingErrorMessage

    member _.isInstalled() : bool =
        Option.isSome current

    member _.clear() : unit =
        current <- None

let runtimeResourcesSlot =
    InstalledResourceSlot(
        "RuntimeResources not installed; call RuntimeResources.install (RuntimeResources.load ()) at plugin init"
    )

let providerResourcesSlot =
    InstalledResourceSlot("ProviderResources not installed")

let proseResourcesSlot =
    InstalledResourceSlot("ProviderProse not installed")
