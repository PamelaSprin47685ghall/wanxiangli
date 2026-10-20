namespace Wanxiangli.Capability

/// 能力词汇：每个值是一项可见即可做的工具能力。标签即 JS 边界上的规范拼写。
[<RequireQualifiedAccess>]
type Permission =
    | Fork
    | Resume
    | Join
    | Horizon
    | Fission
    | Read
    | Write
    | Edit
    | Glob
    | Grep
    | Move
    | Remove
    | Exec
    | Pty
    | ReviewAssessment
    | Fetch
    | Finality
    | BashHoneypot
    | JsPlan
    | Ask
    | Deliver
    | Review
    | DevOpsConsultation
    | Advisor

/// Manager 的生命周期事实。门禁只读精确事实，不读阶段枚举。
type ManagerFacts =
    { HasActiveIncumbency: bool
      HasAssessment: bool
      HasConfirmation: bool
      IsFinalIncumbent: bool
      HasCleanupBlocker: bool }

[<RequireQualifiedAccess>]
module Permission =

    let all: Permission list =
        [ Permission.Fork; Permission.Resume; Permission.Join; Permission.Horizon; Permission.Fission
          Permission.Read; Permission.Write; Permission.Edit; Permission.Glob; Permission.Grep
          Permission.Move; Permission.Remove; Permission.Exec; Permission.Pty; Permission.ReviewAssessment
          Permission.Fetch; Permission.Finality; Permission.BashHoneypot; Permission.JsPlan; Permission.Ask
          Permission.Deliver; Permission.Review; Permission.DevOpsConsultation; Permission.Advisor ]

    let label (permission: Permission): string =
        match permission with
        | Permission.Fork -> "Fork"
        | Permission.Resume -> "Resume"
        | Permission.Join -> "Join"
        | Permission.Horizon -> "Horizon"
        | Permission.Fission -> "Fission"
        | Permission.Read -> "Read"
        | Permission.Write -> "Write"
        | Permission.Edit -> "Edit"
        | Permission.Glob -> "Glob"
        | Permission.Grep -> "Grep"
        | Permission.Move -> "Move"
        | Permission.Remove -> "Remove"
        | Permission.Exec -> "Exec"
        | Permission.Pty -> "Pty"
        | Permission.ReviewAssessment -> "ReviewAssessment"
        | Permission.Fetch -> "Fetch"
        | Permission.Finality -> "Finality"
        | Permission.BashHoneypot -> "BashHoneypot"
        | Permission.JsPlan -> "JsPlan"
        | Permission.Ask -> "Ask"
        | Permission.Deliver -> "Deliver"
        | Permission.Review -> "Review"
        | Permission.DevOpsConsultation -> "DevOpsConsultation"
        | Permission.Advisor -> "Advisor"

    /// 未知标签不是能力。
    let tryParse (text: string): Permission option =
        all |> List.tryFind (fun permission -> label permission = text)

/// 唯一的角色 × 能力矩阵（capability-enforcement / office-capability）。
/// 角色以规范小写标签进入；矩阵之外的标签（历史角色、内部槽位、未知名）一律空集。
[<RequireQualifiedAccess>]
module OfficeMatrix =

    /// Manager 已交评审后的只读面：在评审后被收回。
    let managerReviewReadOnly: Set<Permission> =
        set [ Permission.Read; Permission.Glob; Permission.Grep ]

    /// capability-enforcement-025：最终在任者的读取/清理/收尾面——保留读、horizon、join
    /// 与 deliver 终局，去掉一切新工作能力（fork、resume、review）。
    let managerFinish: Set<Permission> =
        set
            [ Permission.Read; Permission.Glob; Permission.Grep; Permission.Horizon; Permission.Join
              Permission.Finality ]

    let private manager: Set<Permission> =
        set
            [ Permission.Fork; Permission.Resume; Permission.Join; Permission.Horizon; Permission.Advisor
              Permission.ReviewAssessment; Permission.Finality; Permission.Read; Permission.Glob; Permission.Grep ]

    /// 角色标签 → 能力集合。advisor 是评审者而非行动者，故为空集。
    let permissions (roleLabel: string): Set<Permission> =
        match roleLabel with
        | "advisor" -> Set.empty
        | "manager" -> manager
        | "orchestrator" -> set [ Permission.Fork; Permission.Join; Permission.Horizon; Permission.Advisor ]
        | "engineer" ->
            set
                [ Permission.Read; Permission.Write; Permission.Edit; Permission.Glob; Permission.Grep
                  Permission.Move; Permission.Remove; Permission.BashHoneypot; Permission.Fetch
                  Permission.Fission; Permission.Advisor ]
        | "devops" ->
            set
                [ Permission.Read; Permission.Write; Permission.Edit; Permission.Glob; Permission.Grep
                  Permission.Move; Permission.Remove; Permission.Exec; Permission.Join; Permission.Horizon
                  Permission.Advisor ]
        // devops 委派调查，ask 只提问用户；两者不是同一项能力。
        | "plan" ->
            set [ Permission.JsPlan; Permission.Ask; Permission.DevOpsConsultation; Permission.Review; Permission.Deliver ]
        | _ -> Set.empty

    /// Manager 门禁：无在任者不授予任何能力；只有确认没有评审是非法事实，失败关闭；
    /// 清理阻塞只留 Join + Finality；最终在任者只留收尾面；已评审收回只读面；其余为完整 Manager 集合。
    let permissionsForManagerFacts (facts: ManagerFacts): Set<Permission> =
        if not facts.HasActiveIncumbency then Set.empty
        elif facts.HasConfirmation && not facts.HasAssessment then Set.empty
        elif facts.HasCleanupBlocker then set [ Permission.Join; Permission.Finality ]
        elif facts.IsFinalIncumbent then managerFinish
        elif facts.HasAssessment then Set.difference manager managerReviewReadOnly
        else manager
