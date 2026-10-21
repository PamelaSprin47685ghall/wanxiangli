namespace Wanxiangli.Authority

/// interaction-authority-018 的五类预期关闭（闭集合）。每个被接受的根必须唯一归入其一。
[<RequireQualifiedAccess>]
type ClosureKind =
    | HumanRootManagerLife
    | HumanRootManagedRun
    | AgentOwnerChildWork
    | AgentOwnerAttachedWork
    | AgentOwnerInternalLeaf

/// AgentOwnerRoot 的生命周期归属。InternalLeaf 无论物理 Ownership 是 Root 还是 Attached 都只算 InternalLeaf。
[<RequireQualifiedAccess>]
type AgentOwnerLife =
    | Child
    | Attached
    | InternalLeaf

/// 各类唯一合法的 source witness：对应生命周期 durable closed outcome 的精确引用。
[<RequireQualifiedAccess>]
type ClosureWitness =
    | LifeCompleted of lifeId: string * factId: string
    | ManagedLogicalRunTerminal of logicalRunId: string * factId: string
    | ChildLogicalRunTerminal of ownerLogicalRunId: string * childLogicalRunId: string * factId: string
    | AttachedLogicalRunTerminal of
        ownerLogicalRunId: string *
        childLogicalRunId: string *
        attachmentKind: string *
        associationGeneration: string *
        factId: string
    | InternalLeafTerminal of
        ownerLogicalRunId: string *
        leafLogicalRunId: string *
        decisionOrTransactionId: string *
        factId: string

/// 要关闭的已接受根，以及宿主为它给出的精确身份。
type ClosingRoot =
    { Kind: ClosureKind
      SessionId: string
      LogicalRunId: string
      RootId: string
      /// AgentOwnerRoot 的 owner 逻辑运行；HumanRoot 为 None。
      OwnerLogicalRunId: string option
      /// HumanRootManagerLife 的 Manager life；其余为 None。
      LifeId: string option }

[<RequireQualifiedAccess>]
type ClosureRefusal =
    /// 记录的 RootKind 与预期类别的根种类不一致。
    | RootKindMismatch
    /// witness 文本不是五类之一的规范编码，也不是可接受的旧格式。
    | MalformedWitness
    /// witness 属于另一类关闭。
    | WitnessKindMismatch
    /// witness 的 owner / 运行 / life 与被关闭的根不精确相同，或有空字段。
    | WitnessIdentityMismatch
    /// 根缺少关闭所需的身份（owner 运行或 life）。
    | ClosingIdentityMissing

[<RequireQualifiedAccess>]
module ClosureLaw =

    /// 前两类按 HumanRoot 的实际 lifecycle 穷尽（Manager life / 其余受管运行）；
    /// AgentOwnerRoot 必须有宿主给出的生命周期归属，否则无法唯一归类，不得被接受（None）。
    let expectedKind (rootKind: RootKind) (isManager: bool) (agentOwnerLife: AgentOwnerLife option) : ClosureKind option =
        match rootKind, agentOwnerLife with
        | RootKind.HumanRoot, None when isManager -> Some ClosureKind.HumanRootManagerLife
        | RootKind.HumanRoot, None -> Some ClosureKind.HumanRootManagedRun
        | RootKind.HumanRoot, Some _ -> None
        | RootKind.AgentOwnerRoot, Some AgentOwnerLife.Child -> Some ClosureKind.AgentOwnerChildWork
        | RootKind.AgentOwnerRoot, Some AgentOwnerLife.Attached -> Some ClosureKind.AgentOwnerAttachedWork
        | RootKind.AgentOwnerRoot, Some AgentOwnerLife.InternalLeaf -> Some ClosureKind.AgentOwnerInternalLeaf
        | RootKind.AgentOwnerRoot, None -> None

    let rootKindOf (kind: ClosureKind) : RootKind =
        match kind with
        | ClosureKind.HumanRootManagerLife
        | ClosureKind.HumanRootManagedRun -> RootKind.HumanRoot
        | _ -> RootKind.AgentOwnerRoot

    let witnessKind (witness: ClosureWitness) : ClosureKind =
        match witness with
        | ClosureWitness.LifeCompleted _ -> ClosureKind.HumanRootManagerLife
        | ClosureWitness.ManagedLogicalRunTerminal _ -> ClosureKind.HumanRootManagedRun
        | ClosureWitness.ChildLogicalRunTerminal _ -> ClosureKind.AgentOwnerChildWork
        | ClosureWitness.AttachedLogicalRunTerminal _ -> ClosureKind.AgentOwnerAttachedWork
        | ClosureWitness.InternalLeafTerminal _ -> ClosureKind.AgentOwnerInternalLeaf

    /// 规范编码的字段序列（标签在前）。编码本身（JSON 字符串数组）在 JS 边界完成。
    let fields (witness: ClosureWitness) : string list =
        match witness with
        | ClosureWitness.LifeCompleted(life, fact) -> [ "LifeCompleted"; life; fact ]
        | ClosureWitness.ManagedLogicalRunTerminal(run, fact) -> [ "ManagedLogicalRunTerminal"; run; fact ]
        | ClosureWitness.ChildLogicalRunTerminal(owner, child, fact) -> [ "ChildLogicalRunTerminal"; owner; child; fact ]
        | ClosureWitness.AttachedLogicalRunTerminal(owner, child, attachment, generation, fact) ->
            [ "AttachedLogicalRunTerminal"; owner; child; attachment; generation; fact ]
        | ClosureWitness.InternalLeafTerminal(owner, leaf, decision, fact) ->
            [ "InternalLeafTerminal"; owner; leaf; decision; fact ]

    let ofFields (values: string list) : ClosureWitness option =
        match values with
        | [ "LifeCompleted"; life; fact ] -> Some(ClosureWitness.LifeCompleted(life, fact))
        | [ "ManagedLogicalRunTerminal"; run; fact ] -> Some(ClosureWitness.ManagedLogicalRunTerminal(run, fact))
        | [ "ChildLogicalRunTerminal"; owner; child; fact ] ->
            Some(ClosureWitness.ChildLogicalRunTerminal(owner, child, fact))
        | [ "AttachedLogicalRunTerminal"; owner; child; attachment; generation; fact ] ->
            Some(ClosureWitness.AttachedLogicalRunTerminal(owner, child, attachment, generation, fact))
        | [ "InternalLeafTerminal"; owner; leaf; decision; fact ] ->
            Some(ClosureWitness.InternalLeafTerminal(owner, leaf, decision, fact))
        | _ -> None

    let private filled (value: string) = not (System.String.IsNullOrWhiteSpace value)

    /// witness 与被关闭根的精确匹配（kind、owner、运行、life 全部逐字相等，且无空字段）。
    let admit (closing: ClosingRoot) (witness: ClosureWitness) : Result<unit, ClosureRefusal> =
        let exact condition =
            if condition && List.forall filled (fields witness) then
                Ok()
            else
                Error ClosureRefusal.WitnessIdentityMismatch

        let owner () =
            match closing.OwnerLogicalRunId with
            | Some owner when filled owner -> Ok owner
            | _ -> Error ClosureRefusal.ClosingIdentityMissing

        if witnessKind witness <> closing.Kind then
            Error ClosureRefusal.WitnessKindMismatch
        else
            match witness with
            | ClosureWitness.LifeCompleted(life, _) ->
                match closing.LifeId with
                | Some expected when filled expected -> exact (life = expected)
                | _ -> Error ClosureRefusal.ClosingIdentityMissing
            | ClosureWitness.ManagedLogicalRunTerminal(run, _) -> exact (run = closing.LogicalRunId)
            | ClosureWitness.ChildLogicalRunTerminal(ownerRun, child, _)
            | ClosureWitness.AttachedLogicalRunTerminal(ownerRun, child, _, _, _)
            | ClosureWitness.InternalLeafTerminal(ownerRun, child, _, _) ->
                owner () |> Result.bind (fun expected -> exact (ownerRun = expected && child = closing.LogicalRunId))

    /// 读回一条已记录的关闭：记录的 RootKind 必须与预期类别一致；witness 必须是规范编码并精确匹配。
    /// 旧格式（CUT-09-b 之前唯一的 writer 只为 HumanRoot × Manager life 写入裸 retirement id）
    /// 只在预期类别正是 HumanRootManagerLife 时读作 LifeCompleted(LifeId, 该 id)，并标为 legacy。
    let admitRecorded
        (closing: ClosingRoot)
        (recordedRootKind: RootKind)
        (decoded: ClosureWitness option)
        (rawWitness: string)
        : Result<ClosureWitness * bool, ClosureRefusal> =
        if recordedRootKind <> rootKindOf closing.Kind then
            Error ClosureRefusal.RootKindMismatch
        else
            match decoded with
            | Some witness -> admit closing witness |> Result.map (fun () -> witness, false)
            | None when
                closing.Kind = ClosureKind.HumanRootManagerLife
                && filled rawWitness
                && not (rawWitness.TrimStart().StartsWith "[")
                ->
                match closing.LifeId with
                | Some life when filled life -> Ok(ClosureWitness.LifeCompleted(life, rawWitness), true)
                | _ -> Error ClosureRefusal.ClosingIdentityMissing
            | None -> Error ClosureRefusal.MalformedWitness
