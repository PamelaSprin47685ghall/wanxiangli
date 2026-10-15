namespace Wanxiangli.Identity

open System

/// 参与者角色词汇。历史角色只供历史事件解码；活跃身份解析一律拒绝。
type Role =
    | Manager
    | Orchestrator
    | Engineer
    | Coder
    | Inspector
    | Browser
    | Inquiry
    | DevOps
    | Distiller
    | Blogger
    | Plan

[<RequireQualifiedAccess>]
module Roles =

    /// 活跃身份集合（participant-identity-010）：只有这六个可进入活跃解析。
    let active: Role list =
        [ Role.Orchestrator; Role.Manager; Role.Engineer; Role.DevOps
          Role.Blogger; Role.Plan ]

    /// 历史角色：只供历史事件/日志解码，活跃路径一律拒绝。
    let historical: Role list =
        [ Role.Coder; Role.Inspector; Role.Browser; Role.Inquiry; Role.Distiller ]

    let all: Role list = active @ historical

    let roleLabel (role: Role): string =
        match role with
        | Role.Manager -> "manager"
        | Role.Orchestrator -> "orchestrator"
        | Role.Engineer -> "engineer"
        | Role.Coder -> "coder"
        | Role.Inspector -> "inspector"
        | Role.Browser -> "browser"
        | Role.Inquiry -> "inquiry"
        | Role.DevOps -> "devops"
        | Role.Distiller -> "distiller"
        | Role.Blogger -> "blogger"
        | Role.Plan -> "plan"

    let private parseActive (value: string): Role option =
        match value with
        | "manager" -> Some Role.Manager
        | "orchestrator" -> Some Role.Orchestrator
        | "engineer" -> Some Role.Engineer
        | "devops" -> Some Role.DevOps
        | "blogger" -> Some Role.Blogger
        | "plan" -> Some Role.Plan
        | _ -> None

    let private parseHistorical (value: string): Role option =
        match value with
        | "coder" -> Some Role.Coder
        | "inspector" -> Some Role.Inspector
        | "browser" -> Some Role.Browser
        | "inquiry" -> Some Role.Inquiry
        | "distiller" -> Some Role.Distiller
        | _ -> None

    /// 活跃解析（participant-identity-010）：仅接受六个活跃角色；历史角色、内部
    /// 槽位名（bookkeeper/predictor）与非字符串一律 None。
    let tryParseRole (value: string): Role option =
        if isNull (box value) then None
        else parseActive (value.ToLowerInvariant())

    /// 历史解码：活跃 + 历史 11 个角色，仅供历史事件/日志解码边界使用。
    let tryParseHistoricalRole (value: string): Role option =
        if isNull (box value) then None
        else
            let lowered = value.ToLowerInvariant()
            match parseActive lowered with
            | Some role -> Some role
            | None -> parseHistorical lowered

    /// 活跃判定：物理执行绑定与活跃身份解析共用。
    let isActive (role: Role): bool = List.contains role active
