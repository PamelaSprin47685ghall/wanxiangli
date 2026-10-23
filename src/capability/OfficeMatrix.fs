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

    /// capability-enforcement-025：最终在任者的收口面——保留读、horizon、join
    /// 与 deliver 终局，并保留 ReviewAssessment 以便在终局前更新或清空义务账；
    /// 去掉新工作能力（fork、resume）。
    let managerFinish: Set<Permission> =
        set
            [ Permission.Read; Permission.Glob; Permission.Grep; Permission.Horizon; Permission.Join
              Permission.Finality; Permission.ReviewAssessment ]

    let private manager: Set<Permission> =
        set
            [ Permission.Fork; Permission.Resume; Permission.Join; Permission.Horizon; Permission.Advisor
              Permission.ReviewAssessment; Permission.Finality; Permission.Read; Permission.Glob; Permission.Grep ]

    /// 矩阵认得的角色标签（现行角色）。其余标签（历史角色、内部槽位、未知名）失败关闭。
    let roles: string list = [ "advisor"; "manager"; "orchestrator"; "engineer"; "devops"; "plan" ]

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

    /// Manager 门禁：无在任者不授予任何能力；清理阻塞只留 Join + Finality；
    /// 最终在任者只留收尾面（保留读/清理/收尾）；已评审收回只读面（Read/Glob/Grep 收回，Review 保持以允许后续更新义务账）；
    /// 其余为完整 Manager 集合。
    let permissionsForManagerFacts (facts: ManagerFacts): Set<Permission> =
        if not facts.HasActiveIncumbency then Set.empty
        elif facts.HasCleanupBlocker then set [ Permission.Join; Permission.Finality ]
        elif facts.IsFinalIncumbent then managerFinish
        elif facts.HasAssessment then Set.difference manager managerReviewReadOnly
        else manager

/// 能力 ↔ 宿主工具名的唯一映射（capability-enforcement-012）。schema 投影、派发映射与
/// 执行门禁都读这一份，不再各自维护名字表。一项能力可展开为多个名字，也可为空：
/// 空表示该职责只在编程面上（如 this.devops），不是宿主工具。
[<RequireQualifiedAccess>]
module ToolSurface =

    let toolNames (permission: Permission) : string list =
        match permission with
        | Permission.Fork -> [ "fork" ]
        | Permission.Resume -> [ "resume" ]
        | Permission.Join -> [ "join" ]
        | Permission.Horizon -> [ "horizon" ]
        | Permission.Fission -> [ "fission" ]
        | Permission.BashHoneypot -> [ "bash-honeypot" ]
        | Permission.ReviewAssessment -> [ "review" ]
        | Permission.Fetch -> [ "fetch" ]
        | Permission.Finality -> [ "deliver" ]
        | Permission.JsPlan -> [ "todowrite-for-plan" ]
        | Permission.Deliver -> [ "deliver" ]
        | Permission.Review -> [ "review" ]
        | Permission.Read
        | Permission.Write
        | Permission.Edit
        | Permission.Glob
        | Permission.Grep
        | Permission.Move
        | Permission.Remove
        | Permission.Exec
        | Permission.Pty
        | Permission.Ask
        | Permission.DevOpsConsultation
        | Permission.Advisor -> []

    /// 名字 → 能力的唯一反查。两项能力共用一个名字时，取该角色持有的那一项；
    /// 目录顺序不是裁决。只属于一项能力的名字对所有角色都映射到它。
    let permissionOfToolName (roleLabel: string) (name: string) : Permission option =
        let named = Permission.all |> List.filter (fun permission -> toolNames permission |> List.contains name)
        let owned = OfficeMatrix.permissions roleLabel
        match named |> List.filter (fun permission -> Set.contains permission owned), named with
        | [ permission ], _ -> Some permission
        | _, [ permission ] -> Some permission
        | _ -> None

    /// 可见即可做：只有角色持有该名字所映射的那项能力时为真。
    let admitsToolForRole (roleLabel: string) (name: string) : bool =
        match permissionOfToolName roleLabel name with
        | Some permission -> OfficeMatrix.permissions roleLabel |> Set.contains permission
        | None -> false

    /// 宿主实用工具（不是办公能力）：skill 与认知承诺 assume。它们不进能力矩阵，
    /// 但仍是"可见即可做"的一份事实：schema 投影、请求工具表与执行准入读同一个判定。
    let utilityToolNames: string list = [ "skill"; "assume" ]

    /// 现行角色都持有实用工具；矩阵之外的角色标签（含已退役的 distiller）一律拒绝。
    let admitsUtility (roleLabel: string) (name: string) : bool =
        List.contains name utilityToolNames && List.contains roleLabel OfficeMatrix.roles
