namespace Wanxiangli.Identity

/// Persona：角色在目录中的稳定人格名。V1 目录与宿主主仓保持一致。
type Persona =
    | Director
    | Lead
    | Engineer
    | Coder
    | Investigator
    | Operator
    | Researcher
    | Analyst
    | Auditor
    | Chronicler
    | Distiller
    | Curator
    | Predictor
    | Planner

[<RequireQualifiedAccess>]
module Persona =

    let render (persona: Persona): string =
        match persona with
        | Persona.Director -> "Director"
        | Persona.Lead -> "Lead"
        | Persona.Engineer -> "Engineer"
        | Persona.Coder -> "Coder"
        | Persona.Investigator -> "Investigator"
        | Persona.Operator -> "Operator"
        | Persona.Researcher -> "Researcher"
        | Persona.Analyst -> "Analyst"
        | Persona.Auditor -> "Auditor"
        | Persona.Chronicler -> "Chronicler"
        | Persona.Distiller -> "Distiller"
        | Persona.Curator -> "Curator"
        | Persona.Predictor -> "Predictor"
        | Persona.Planner -> "Planner"

[<RequireQualifiedAccess>]
module PersonaCatalog =

    let currentVersion = 1

    /// 角色 → Persona（V1 目录，与主仓 Wanxiangshu.Participant.Persona 一致）。
    let persona (role: Role): Persona =
        match role with
        | Role.Manager -> Persona.Lead
        | Role.Orchestrator -> Persona.Director
        | Role.Engineer -> Persona.Engineer
        | Role.Coder -> Persona.Coder
        | Role.Inspector -> Persona.Investigator
        | Role.Browser -> Persona.Researcher
        | Role.Inquiry -> Persona.Analyst
        | Role.DevOps -> Persona.Operator
        | Role.Distiller -> Persona.Distiller
        | Role.Blogger -> Persona.Chronicler
        | Role.Plan -> Persona.Planner

    /// Bookkeeper 的目录人格（内部槽位，非活跃角色）。
    let bookkeeperPersona: Persona = Persona.Curator

    /// Predictor 的目录人格（内部槽位，非活跃角色）。
    let predictorPersona: Persona = Persona.Predictor

    let personaV1 (role: Role): string = persona role |> Persona.render

    let bookkeeperPersonaV1: string = Persona.render bookkeeperPersona
