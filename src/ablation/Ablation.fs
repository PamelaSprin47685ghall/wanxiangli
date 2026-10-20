module Wanxiangli.Ablation.Ablation

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

/// 消融 DAG 定律的公开消息。清单从哪里读、配置集怎样合并、门禁投影到什么，由组合者决定。
[<AllowNullLiteral>]
type AblationMessages =
    abstract validateNodes: nodes: obj -> obj
    abstract findCycle: nodes: obj * edges: obj -> obj
    abstract validateModes: edges: obj * modes: obj -> obj

type private Node =
    { Id: string
      Package: string
      Kind: string
      Parent: string option }

type private Edge = { From: string; To: string; Kind: string }

type private Mode =
    | Ablated
    | Borrowed
    | Active

let private fail (message: string) : 'a = raise (ArgumentException message)

[<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
let private descriptorOf (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.prototype.hasOwnProperty.call($0, $1)")>]
let private hasOwn (_value: obj) (_name: string) : bool = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("Object.keys($0)")>]
let private keysOf (_value: obj) : string[] = jsNative

let private isAbsent (value: obj) = isNull value || jsTypeof value = "undefined"

let private requireObject (what: string) (value: obj) =
    if isAbsent value || jsTypeof value <> "object" || isArray value then
        fail (what + " must be an object")

/// 只读数据字段；accessor 在读取前被拒绝。缺失字段返回 None。
let private ownField (value: obj) (name: string) : obj option =
    let descriptor = descriptorOf value name

    if isAbsent descriptor then None
    elif not (hasOwn descriptor "value") then fail ("Accessor field is not accepted: " + name)
    else Some descriptor?value

let private requiredString (what: string) (value: obj) (name: string) : string =
    match ownField value name with
    | Some field when jsTypeof field = "string" -> unbox<string> field
    | _ -> fail (what + "." + name + " must be a string")

let private optionalString (what: string) (value: obj) (name: string) : string option =
    match ownField value name with
    | None -> None
    | Some field when isAbsent field -> None
    | Some field when jsTypeof field = "string" -> Some(unbox<string> field)
    | Some _ -> fail (what + "." + name + " must be a string when present")

/// 只接受真正的数组，并在读取任何元素前拍下快照，调用方之后改动不影响本次判断。
let private snapshot (what: string) (value: obj) : obj[] =
    if not (isArray value) then
        fail (what + " must be an array")
    else
        let items = unbox<obj[]> value
        Array.init items.Length (fun index ->
            match ownField value (string index) with
            | Some item -> item
            | None -> fail (what + " must not be sparse"))

let private nodeOf (value: obj) : Node =
    requireObject "node" value

    { Id = requiredString "node" value "id"
      Package = requiredString "node" value "package"
      Kind = optionalString "node" value "kind" |> Option.defaultValue "package"
      Parent = optionalString "node" value "parent" }

let private edgeOf (value: obj) : Edge =
    requireObject "edge" value

    { From = requiredString "edge" value "from"
      To = requiredString "edge" value "to"
      Kind = optionalString "edge" value "kind" |> Option.defaultValue "station-order" }

let private nodesOf (value: obj) = snapshot "nodes" value |> Array.map nodeOf |> Array.toList
let private edgesOf (value: obj) = snapshot "edges" value |> Array.map edgeOf |> Array.toList

let private modeOf (raw: string) : Mode =
    match raw with
    | "ablated" -> Ablated
    | "borrowed" -> Borrowed
    | "active" -> Active
    | _ -> fail ("mode must be 'ablated', 'borrowed' or 'active', got '" + raw + "'")

let private modesOf (value: obj) : Map<string, Mode> =
    requireObject "modes" value

    keysOf value
    |> Array.map (fun key ->
        match ownField value key with
        | Some raw when jsTypeof raw = "string" -> key, modeOf (unbox<string> raw)
        | _ -> fail ("modes." + key + " must be a string"))
    |> Map.ofArray

let private violation (kind: string) (reason: string) : obj =
    freeze (createObj [ "kind" ==> kind; "reason" ==> reason ])

let private invalidManifest reason = Some(violation "InvalidManifest" reason)
let private dagViolation reason = Some(violation "DagViolation" reason)

/// 子节点必须声明父节点，父节点必须是同包的主节点。
let private sliceViolation (nodeMap: Map<string, Node>) (node: Node) : obj option =
    match node.Parent, node.Parent |> Option.bind (fun parentId -> Map.tryFind parentId nodeMap) with
    | None, _ -> invalidManifest (sprintf "Slice node '%s' must declare parent" node.Id)
    | Some parentId, None -> invalidManifest (sprintf "Slice node '%s' parent '%s' not found" node.Id parentId)
    | Some parentId, Some parent when parent.Kind <> "package" ->
        invalidManifest (
            sprintf "Slice node '%s' parent '%s' must be kind 'package' but is '%s'" node.Id parentId parent.Kind
        )
    | Some parentId, Some parent when parent.Package <> node.Package ->
        invalidManifest (
            sprintf
                "Slice node '%s' (package '%s') and parent '%s' (package '%s') must belong to same package"
                node.Id
                node.Package
                parentId
                parent.Package
        )
    | Some _, Some _ -> None

/// 每个包恰有一个同名、kind 为 package 的主节点。
let private mainNodeViolation (nodes: Node list) : obj option =
    nodes
    |> List.map (fun node -> node.Package)
    |> List.distinct
    |> List.tryPick (fun pkg ->
        let inPackage = nodes |> List.filter (fun node -> node.Package = pkg)
        let mains = inPackage |> List.filter (fun node -> node.Id = pkg && node.Kind = "package")
        let packageKinds = inPackage |> List.filter (fun node -> node.Kind = "package")

        if mains.IsEmpty then
            invalidManifest (
                sprintf "Package '%s' is missing a main node (expected id '%s' and kind 'package')" pkg pkg
            )
        elif mains.Length > 1 || packageKinds.Length > 1 then
            invalidManifest (sprintf "Package '%s' has multiple main nodes" pkg)
        else
            None)

let private nodesViolation (nodes: Node list) : obj option =
    let nodeMap = nodes |> List.map (fun node -> node.Id, node) |> Map.ofList

    match nodes |> List.filter (fun node -> node.Kind = "slice") |> List.tryPick (sliceViolation nodeMap) with
    | Some found -> Some found
    | None -> mainNodeViolation nodes

/// station-order 与 borrow 两类边共同构成的图不得有环。只沿已声明节点深度优先。
let private cycleViolation (nodes: Node list) (edges: Edge list) : obj option =
    let adjacency =
        edges
        |> List.filter (fun edge -> edge.Kind = "station-order" || edge.Kind = "borrow")
        |> List.groupBy (fun edge -> edge.From)
        |> List.map (fun (from, group) -> from, group |> List.map (fun edge -> edge.To))
        |> Map.ofList

    let ids = nodes |> List.map (fun node -> node.Id)
    // DSL-MUTABLE: algorithm-scratch — DFS colouring, local to one call
    let colour = Dictionary<string, int>()

    for id in ids do
        colour[id] <- 0

    let rec visit node =
        colour[node] <- 1

        let found =
            adjacency
            |> Map.tryFind node
            |> Option.defaultValue []
            |> List.tryPick (fun next ->
                match colour.TryGetValue next with
                | true, 1 -> Some(sprintf "Cycle detected involving edge %s -> %s" node next)
                | true, 0 -> visit next
                | _ -> None)

        colour[node] <- 2
        found

    ids
    |> List.tryPick (fun id -> if colour[id] = 0 then visit id else None)
    |> Option.bind dagViolation

/// 三态边约束：station-order 的下游 active 需要上游至少 borrowed；borrow 的目标至少 borrowed 时前提至少 borrowed。
/// 未给出的节点按 ablated 判断。
let private modesViolation (edges: Edge list) (modes: Map<string, Mode>) : obj option =
    let mode id = modes |> Map.tryFind id |> Option.defaultValue Ablated
    let atLeastBorrowed m = m = Active || m = Borrowed

    edges
    |> List.tryPick (fun edge ->
        let fromMode = mode edge.From
        let toMode = mode edge.To

        match edge.Kind with
        | "station-order" when toMode = Active && not (atLeastBorrowed fromMode) ->
            dagViolation (
                sprintf "station-order: %s requires %s at least borrowed before active downstream" edge.To edge.From
            )
        | "borrow" when atLeastBorrowed toMode && not (atLeastBorrowed fromMode) ->
            dagViolation (sprintf "borrow: %s requires %s at least borrowed" edge.To edge.From)
        | _ -> None)

let private answer (found: obj option) : obj =
    match found with
    | Some value -> value
    | None -> null

/// 消融 DAG 定律。每条消息独立：先完整校验输入，再给出第一处违约或 null。
let Ablation () : AblationMessages =
    { new AblationMessages with
        member _.validateNodes(nodes) = nodesOf nodes |> nodesViolation |> answer

        member _.findCycle(nodes, edges) =
            let nodeList = nodesOf nodes
            cycleViolation nodeList (edgesOf edges) |> answer

        member _.validateModes(edges, modes) =
            let edgeList = edgesOf edges
            modesViolation edgeList (modesOf modes) |> answer }
