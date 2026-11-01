module Wanxiangli.Program.Invocation

open System
open System.Threading.Tasks
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Program.Native

[<Import("FileSession", "wanxiangli/runtime")>]
let private fileSession (_options: obj) : obj = jsNative

type private Ledger =
    abstract prepared: obj -> obj
    abstract committed: obj -> unit
    abstract settle: unit -> Task<obj>

type private Options =
    abstract root: string
    abstract ledger: Ledger
    abstract checkReturn: obj -> obj

type private Session =
    abstract execute: obj -> Task<obj>

[<AttachMembers>]
type ProgramInvocation(spec: obj) =
    let options: Options = unbox spec
    let rewritten = ResizeArray<string>()
    let created = ResizeArray<string>()
    let removed = ResizeArray<string>()
    let moved = ResizeArray<string * string>()
    let reads = ResizeArray<string * string>()
    let mutable settlementFailure: obj = null

    let recordMutation mutation =
        let path = string (get mutation "path")
        match string (get mutation "kind") with
        | "rewrite" -> rewritten.Add path
        | "create" -> created.Add path
        | "remove" -> removed.Add path
        | "move" -> moved.Add(path, string (get mutation "destination"))
        | _ -> invalidArg "mutation" "unknown physical file effect"

    let ownedFiles =
        fileSession (createObj [
            "root" ==> options.root
            "before" ==> (fun (mutation: obj) ->
                options.ledger.prepared (createObj [ "root" ==> options.root; "mutation" ==> mutation ]))
            "after" ==> Action<obj, obj>(fun mutation token ->
                recordMutation mutation
                options.ledger.committed token)
            "read" ==> Action<string, string>(fun path text -> reads.Add(path, text)) ])

    let observe explicitReads effectPaths =
        task {
            let callback = get spec "observe"
            if isFunction callback then
                try
                    let! _ = promise (invoke callback [| createObj [ "reads" ==> explicitReads; "effectPaths" ==> effectPaths ] |])
                    ()
                with _ -> ()
        }

    let settle outputBoundBytes receipt =
        task {
            let rewrittenPaths, createdPaths, removedPaths = rewritten.ToArray(), created.ToArray(), removed.ToArray()
            let movedPaths = moved.ToArray()
            let effectPaths = Array.concat [
                rewrittenPaths; createdPaths; removedPaths
                movedPaths |> Array.collect (fun (source, destination) -> [| source; destination |]) ]
            let explicitReads =
                reads
                |> Seq.distinctBy fst
                |> Seq.map (fun (path, text) -> createObj [ "path" ==> path; "resultBytes" ==> text ])
                |> Seq.toArray
            do! observe explicitReads effectPaths
            let! appended = options.ledger.settle()
            let failure =
                if not (missing appended) then appended
                elif field receipt "state" = "completed" then
                    options.checkReturn (createObj [ "value" ==> get receipt "value"; "outputBoundBytes" ==> outputBoundBytes ])
                else null
            settlementFailure <- failure
            let result =
                if missing failure then receipt
                else merge receipt (createObj [
                    "state" ==> "failed"; "code" ==> get failure "code"; "reason" ==> get failure "reason" ])
            return merge result (createObj [ "effects" ==> createObj [
                "rewritten" ==> rewrittenPaths; "created" ==> createdPaths; "removed" ==> removedPaths
                "moved" ==> (movedPaths |> Array.map (fun (source, destination) ->
                    createObj [ "from" ==> source; "destination" ==> destination ])) ] ])
        }

    member _.files: obj = ownedFiles

    member _.execute(session: obj, execution: obj, api: obj) : Task<obj> =
        let session: Session = unbox session
        task {
            let configured = merge execution (createObj [
                "api" ==> api
                "settle" ==> (fun (receipt: obj) -> settle (get execution "outputBoundBytes") receipt) ])
            let! receipt = session.execute configured
            return createObj [ "receipt" ==> receipt; "settlementFailure" ==> settlementFailure ]
        }
