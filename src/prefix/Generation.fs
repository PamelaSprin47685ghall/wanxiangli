namespace Wanxiangli.Prefix

/// 前缀世代：哪一代在生效，以及哪些已提交证据已经推进过它。
///
/// 世代只由两类已提交证据推进（prefix-stability-002/006）：宿主压缩
/// （一个压缩伪 run）与 Plan 任期交接（一个 incumbencyId）。候选只是对
/// 下一行的提议，不改变状态；只有 commit 接受的行才推进世代。
module Generation =

    type Evidence =
        | Compaction of run: string
        | Tenure of incumbencyId: string
        | Scope of callId: string

    type State =
        { Epoch: float
          CompactionRuns: Set<string>
          Tenures: Set<string>
          Scopes: Set<string> }

    /// 一条待写入的推进行。PreviousEpoch 是写入时认定的现行世代。
    type Candidate =
        { PreviousEpoch: float
          NextEpoch: float
          Evidence: Evidence }

    type Rejection =
        /// 行写于另一个世代（崩溃后重放的同一行即落在这里）。
        | StaleEpoch of expected: float * actual: float
        /// NextEpoch 不是 PreviousEpoch 的后继。
        | NonSequentialEpoch
        /// 同一证据已经推进过一次。与 StaleEpoch 分开：世代因别的证据
        /// 前进后，旧证据的新行会带着"正确"的 PreviousEpoch 到来。
        | AlreadyReanchored of Evidence

    let empty =
        { Epoch = 0.0
          CompactionRuns = Set.empty
          Tenures = Set.empty
          Scopes = Set.empty }

    let isReanchored (evidence: Evidence) (state: State) =
        match evidence with
        | Compaction run -> Set.contains run state.CompactionRuns
        | Tenure incumbency -> Set.contains incumbency state.Tenures
        | Scope callId -> Set.contains callId state.Scopes

    /// 候选：证据尚未推进过时，提议从现行世代推进一代；否则没有候选。
    let propose (evidence: Evidence) (state: State) : Candidate option =
        if isReanchored evidence state then
            None
        else
            Some
                { PreviousEpoch = state.Epoch
                  NextEpoch = state.Epoch + 1.0
                  Evidence = evidence }

    /// 观察到的压缩伪 run（旧到新）中，最新一个尚未推进过的成为候选。
    /// 只取一个：连续两次推进对前缀没有额外作用，只会白白推高世代号。
    let proposeCompaction (observed: string list) (state: State) : Candidate option =
        observed
        |> List.filter (fun run -> not (Set.contains run state.CompactionRuns))
        |> List.tryLast
        |> Option.bind (fun run -> propose (Compaction run) state)

    /// 提交一行：检查顺序固定为 重复证据 → 世代过期 → 非后继。
    let commit (candidate: Candidate) (state: State) : Result<State, Rejection> =
        if isReanchored candidate.Evidence state then
            Error(AlreadyReanchored candidate.Evidence)
        elif candidate.PreviousEpoch <> state.Epoch then
            Error(StaleEpoch(state.Epoch, candidate.PreviousEpoch))
        elif candidate.NextEpoch <> candidate.PreviousEpoch + 1.0 then
            Error NonSequentialEpoch
        else
            match candidate.Evidence with
            | Compaction run ->
                Ok
                    { state with
                        Epoch = candidate.NextEpoch
                        CompactionRuns = Set.add run state.CompactionRuns }
            | Tenure incumbency ->
                Ok
                    { state with
                        Epoch = candidate.NextEpoch
                        Tenures = Set.add incumbency state.Tenures }
            | Scope callId ->
                Ok
                    { state with
                        Epoch = candidate.NextEpoch
                        Scopes = Set.add callId state.Scopes }

    /// 吸收策略：重放的行与重复的观察是预期的稳态，调用方什么都不写；
    /// 非后继世代是损坏，必须报告。
    let absorbed (rejection: Rejection) =
        match rejection with
        | StaleEpoch _
        | AlreadyReanchored _ -> true
        | NonSequentialEpoch -> false
