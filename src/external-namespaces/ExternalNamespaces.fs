module Wanxiangli.ExternalNamespaces.ExternalNamespaces

open System
open System.Collections.Generic

[<AllowNullLiteral>]
type ExternalNamespaceMessages =
    abstract declare: names: string array -> unit
    abstract patterns: names: string array -> string array
    abstract matches: toolName: string -> bool

/// 跨工作区声明集合的进程内 owner。不决定具体角色的执行权限。
let ExternalNamespaces: ExternalNamespaceMessages =
    let declared = HashSet<string>()

    { new ExternalNamespaceMessages with
        member _.declare(names) =
            for name in names do
                declared.Add name |> ignore

        member _.patterns(names) =
            names |> Array.map (fun name -> name + "_*")

        member _.matches(toolName) =
            declared
            |> Seq.exists (fun name -> toolName.StartsWith(name + "_", StringComparison.Ordinal)) }
