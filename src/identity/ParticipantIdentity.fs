namespace Wanxiangli.Identity

open System
open Fable.Core
open Fable.Core.JsInterop

/// 身份来源：根选定或继承自所有者。二者互斥，不可转换。
[<RequireQualifiedAccess>]
type PersonaOrigin =
    | ResolvedAtRoot
    | InheritedFromOwner

[<RequireQualifiedAccess>]
type ParticipantIdentityError =
    | BlankParticipantName
    | LegacyParticipantName of name: string
    | MalformedParticipantName of name: string
    | UnknownParticipantName of name: string
    | UnsupportedPersonaCatalogVersion of version: int
    | RoleMismatch of expected: Role option * actual: Role option
    | BlankPersona
    | PersonaMismatch of expected: string * actual: string
    | OriginMismatch of expected: PersonaOrigin * actual: PersonaOrigin option
    | OwnerRequired
    | OwnerPersonaMismatch of expected: string * actual: string
    | OwnerCatalogVersionMismatch of expected: int * actual: int

type private PersonaName = PersonaName of string

/// 参与者种类：受管角色或内部槽位（Bookkeeper）。已退役的槽位名不再解析。
type private ParticipantKind =
    | ManagedRole of Role
    | Bookkeeper

/// 稳定参与者身份：logical run 内不可变的规范身份证据。
/// 物理模型目标与租约分配不属于这里（见 ExecutionBinding）。
type ParticipantIdentity =
    private
        { SelectedAgent: PersonaName
          Kind: ParticipantKind
          Persona: string
          PersonaCatalogVersion: int
          Origin: PersonaOrigin }

/// 已验证身份证据的不可变包装。构造只经 ParticipantIdentity 模块的校验路径。
type ParticipantIdentityEvidence = private { Identity: ParticipantIdentity }

[<RequireQualifiedAccess>]
module ParticipantIdentity =

    let private currentVersion = PersonaCatalog.currentVersion

    /// 历史/废弃参与者名：只允许出现在历史事件解码，活跃解析一律拒绝。
    /// 与主仓 ManagedCatalog.legacyAgentNames 同表（10 名 + 下划线形态）。
    let private legacyNames: string list =
        List.map Roles.roleLabel Roles.historical
        @ [ "build"; "student"; "teacher"; "meditator"; "executor" ]

    let private isLegacyName (name: string): bool =
        List.contains (name.ToLowerInvariant()) legacyNames
        || name.Contains "_"

    let private isMalformedName (name: string): bool =
        String.IsNullOrWhiteSpace name
        || name.Length > 64
        || name.Contains " "
        || name.Contains "."

    let private roleOfKind (kind: ParticipantKind): Role option =
        match kind with
        | ManagedRole role -> Some role
        | Bookkeeper -> None

    let private personaOfKind (kind: ParticipantKind): string =
        match kind with
        | ManagedRole role -> PersonaCatalog.personaV1 role
        | Bookkeeper -> PersonaCatalog.bookkeeperPersonaV1

    /// 规范名解析：活跃角色 + 内部槽位（bookkeeper）。
    /// 历史/废弃/畸形名返回对应错误，绝不静默映射到活跃角色。
    let private parseKnownCanonicalName (name: string): Result<ParticipantKind, ParticipantIdentityError> =
        if String.IsNullOrWhiteSpace name then Error ParticipantIdentityError.BlankParticipantName
        elif isLegacyName name then Error(ParticipantIdentityError.LegacyParticipantName name)
        elif isMalformedName name then Error(ParticipantIdentityError.MalformedParticipantName name)
        else
            let lowered = name.ToLowerInvariant()
            match lowered with
            | "bookkeeper" -> Ok ParticipantKind.Bookkeeper
            | _ ->
                match Roles.tryParseRole lowered with
                | Some role -> Ok(ManagedRole role)
                | None ->
                    match Roles.tryParseHistoricalRole lowered with
                    | Some _ -> Error(ParticipantIdentityError.LegacyParticipantName lowered)
                    | None -> Error(ParticipantIdentityError.UnknownParticipantName lowered)

    let private build (name: string) (kind: ParticipantKind) (origin: PersonaOrigin): ParticipantIdentityEvidence =
        { Identity =
            { SelectedAgent = PersonaName(name.ToLowerInvariant())
              Kind = kind
              Persona = personaOfKind kind
              PersonaCatalogVersion = currentVersion
              Origin = origin } }

    /// 根选定：参与者名在根处被选定，身份证据自此不可变。
    let resolveAtRoot (name: string): Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        parseKnownCanonicalName name |> Result.map (fun kind -> build name kind PersonaOrigin.ResolvedAtRoot)

    /// 继承自所有者：子身份沿用所有者的 persona 与目录版本；名字必须可解析。
    let inheritFromOwner
        (name: string)
        (owner: ParticipantIdentityEvidence)
        : Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        let ownerIdentity = owner.Identity
        parseKnownCanonicalName name
        |> Result.map (fun kind ->
            let inherited =
                { SelectedAgent = PersonaName(name.ToLowerInvariant())
                  Kind = kind
                  Persona = ownerIdentity.Persona
                  PersonaCatalogVersion = ownerIdentity.PersonaCatalogVersion
                  Origin = PersonaOrigin.InheritedFromOwner }
            { Identity = inherited })

    /// 重水化：对既有身份输入做完整校验，任何错配一律拒绝。
    /// owner 为 None 时，InheritedFromOwner 输入必须被拒绝（OwnerRequired）。
    let rehydrate (owner: ParticipantIdentityEvidence option) (input: obj): Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        let name = Wire.string input "name"
        let roleLabel = Wire.string input "role"
        let persona = Wire.string input "persona"
        let catalogVersion = Wire.int input "catalogVersion"
        let origin =
            match Wire.string input "origin" with
            | Some "ResolvedAtRoot" -> Some PersonaOrigin.ResolvedAtRoot
            | Some "InheritedFromOwner" -> Some PersonaOrigin.InheritedFromOwner
            | _ -> None

        match name, roleLabel, persona, catalogVersion, origin with
        | None, _, _, _, _ -> Error ParticipantIdentityError.BlankParticipantName
        | Some rawName, _, _, _, _ ->
            match parseKnownCanonicalName rawName with
            | Error error -> Error error
            | Ok kind ->
                let loweredName = rawName.ToLowerInvariant()

                match roleLabel with
                | None ->
                    // 角色字段缺失：仅当身份种类本身无角色（Bookkeeper）时合法。
                    if roleOfKind kind |> Option.isNone then
                        match persona, catalogVersion, origin with
                        | None, _, _ -> Error ParticipantIdentityError.BlankPersona
                        | _, None, _ -> Error(ParticipantIdentityError.UnsupportedPersonaCatalogVersion 0)
                        | _, _, None -> Error(ParticipantIdentityError.OriginMismatch(expected = PersonaOrigin.ResolvedAtRoot, actual = None))
                        | _ ->
                            let expectedPersona = personaOfKind kind
                            if persona.Value <> expectedPersona then
                                Error(ParticipantIdentityError.PersonaMismatch(expected = expectedPersona, actual = persona.Value))
                            else
                                let version = catalogVersion.Value
                                if version <> currentVersion then
                                    Error(ParticipantIdentityError.UnsupportedPersonaCatalogVersion version)
                                else
                                    let resolvedOrigin = origin.Value
                                    match resolvedOrigin with
                                    | PersonaOrigin.InheritedFromOwner ->
                                        match owner with
                                        | None -> Error ParticipantIdentityError.OwnerRequired
                                        | Some ownerEvidence ->
                                            let ownerId = ownerEvidence.Identity
                                            if ownerId.PersonaCatalogVersion <> version then
                                                Error(ParticipantIdentityError.OwnerCatalogVersionMismatch(expected = ownerId.PersonaCatalogVersion, actual = version))
                                            else
                                                Ok { Identity = { SelectedAgent = PersonaName loweredName; Kind = kind; Persona = persona.Value; PersonaCatalogVersion = version; Origin = PersonaOrigin.InheritedFromOwner } }
                                    | PersonaOrigin.ResolvedAtRoot ->
                                        Ok { Identity = { SelectedAgent = PersonaName loweredName; Kind = kind; Persona = persona.Value; PersonaCatalogVersion = version; Origin = PersonaOrigin.ResolvedAtRoot } }
                    else
                        Error(ParticipantIdentityError.RoleMismatch(expected = roleOfKind kind, actual = None))
                | Some rawRole ->
                    let parsedRole = Roles.tryParseHistoricalRole rawRole
                    let expectedRole = roleOfKind kind
                    if parsedRole <> expectedRole then
                        Error(ParticipantIdentityError.RoleMismatch(expected = expectedRole, actual = parsedRole))
                    else
                        // 继承身份没有 owner 见证时直接拒绝，先于 persona 比对：
                        // 无见证时无从确定期望 persona，OwnerRequired 是唯一诚实答案。
                        let missingOwnerWitness =
                            match origin with
                            | Some PersonaOrigin.InheritedFromOwner -> owner.IsNone
                            | _ -> false

                        if missingOwnerWitness then
                            Error ParticipantIdentityError.OwnerRequired
                        else
                            match persona with
                            | None -> Error ParticipantIdentityError.BlankPersona
                            | Some rawPersona ->
                                let expectedPersona =
                                    match origin with
                                    | Some PersonaOrigin.InheritedFromOwner ->
                                        match owner with
                                        | Some ownerEvidence -> ownerEvidence.Identity.Persona
                                        | None -> personaOfKind kind
                                    | _ -> personaOfKind kind

                                if rawPersona <> expectedPersona then
                                    Error(ParticipantIdentityError.PersonaMismatch(expected = expectedPersona, actual = rawPersona))
                                else
                                    match catalogVersion with
                                    | None -> Error(ParticipantIdentityError.UnsupportedPersonaCatalogVersion 0)
                                    | Some version ->
                                        if version <> currentVersion then
                                            Error(ParticipantIdentityError.UnsupportedPersonaCatalogVersion version)
                                        else
                                            match origin with
                                            | None -> Error(ParticipantIdentityError.OriginMismatch(expected = PersonaOrigin.ResolvedAtRoot, actual = None))
                                            | Some resolvedOrigin ->
                                                match resolvedOrigin with
                                                | PersonaOrigin.InheritedFromOwner ->
                                                    match owner with
                                                    | None -> Error ParticipantIdentityError.OwnerRequired
                                                    | Some ownerEvidence ->
                                                        let ownerId = ownerEvidence.Identity
                                                        if ownerId.PersonaCatalogVersion <> version then
                                                            Error(ParticipantIdentityError.OwnerCatalogVersionMismatch(expected = ownerId.PersonaCatalogVersion, actual = version))
                                                        else
                                                            Ok
                                                                { Identity =
                                                                    { SelectedAgent = PersonaName loweredName
                                                                      Kind = kind
                                                                      Persona = rawPersona
                                                                      PersonaCatalogVersion = version
                                                                      Origin = PersonaOrigin.InheritedFromOwner } }
                                                | PersonaOrigin.ResolvedAtRoot ->
                                                    Ok
                                                        { Identity =
                                                            { SelectedAgent = PersonaName loweredName
                                                              Kind = kind
                                                              Persona = rawPersona
                                                              PersonaCatalogVersion = version
                                                              Origin = PersonaOrigin.ResolvedAtRoot } }

    /// 身份证据的 plain 投影（供 JS 边界与 ExecutionBinding 消费）。
    let toView (evidence: ParticipantIdentityEvidence): obj =
        let identity = evidence.Identity
        let (PersonaName name) = identity.SelectedAgent
        let originLabel =
            match identity.Origin with
            | PersonaOrigin.ResolvedAtRoot -> "ResolvedAtRoot"
            | PersonaOrigin.InheritedFromOwner -> "InheritedFromOwner"

        createObj [
            "name", box name
            "role", Wire.toNull (roleOfKind identity.Kind |> Option.map Roles.roleLabel)
            "persona", box identity.Persona
            "catalogVersion", box identity.PersonaCatalogVersion
            "origin", box originLabel
        ]

    /// 错误的 plain 投影：{ error: kind, detail?: string }。
    let errorView (error: ParticipantIdentityError): obj =
        let kind =
            match error with
            | ParticipantIdentityError.BlankParticipantName -> "BlankParticipantName"
            | ParticipantIdentityError.LegacyParticipantName _ -> "LegacyParticipantName"
            | ParticipantIdentityError.MalformedParticipantName _ -> "MalformedParticipantName"
            | ParticipantIdentityError.UnknownParticipantName _ -> "UnknownParticipantName"
            | ParticipantIdentityError.UnsupportedPersonaCatalogVersion _ -> "UnsupportedPersonaCatalogVersion"
            | ParticipantIdentityError.RoleMismatch _ -> "RoleMismatch"
            | ParticipantIdentityError.BlankPersona -> "BlankPersona"
            | ParticipantIdentityError.PersonaMismatch _ -> "PersonaMismatch"
            | ParticipantIdentityError.OriginMismatch _ -> "OriginMismatch"
            | ParticipantIdentityError.OwnerRequired -> "OwnerRequired"
            | ParticipantIdentityError.OwnerPersonaMismatch _ -> "OwnerPersonaMismatch"
            | ParticipantIdentityError.OwnerCatalogVersionMismatch _ -> "OwnerCatalogVersionMismatch"

        let detail =
            match error with
            | ParticipantIdentityError.LegacyParticipantName name
            | ParticipantIdentityError.MalformedParticipantName name
            | ParticipantIdentityError.UnknownParticipantName name -> box name
            | ParticipantIdentityError.UnsupportedPersonaCatalogVersion version -> box version
            | _ -> null

        if isNull detail then createObj [ "error", box kind ]
        else createObj [ "error", box kind; "detail", detail ]

    /// 供 ExecutionBinding 校验绑定角色一致性使用。
    let roleOf (evidence: ParticipantIdentityEvidence): Role option = roleOfKind evidence.Identity.Kind
