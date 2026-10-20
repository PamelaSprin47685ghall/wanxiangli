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
    | OriginMismatch of expected: PersonaOrigin * actual: PersonaOrigin
    | OwnerRequired
    | OwnerPersonaMismatch of expected: string * actual: string
    | OwnerCatalogVersionMismatch of expected: int * actual: int
    /// JS 边界：role 字段既不是 null（Bookkeeper）也不是可解码的角色标签。
    | InvalidRoleLabel of label: string
    /// JS 边界：origin 字段不是 ResolvedAtRoot / InheritedFromOwner。
    | InvalidOriginLabel of label: string

/// 已保存或待校验身份的类型化输入。Role = None 表示内部槽位 Bookkeeper。
type ParticipantIdentityInput =
    { SelectedAgent: string
      Role: Role option
      Persona: string
      PersonaCatalogVersion: int
      Origin: PersonaOrigin }

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
    let legacyNames: string list =
        List.map Roles.roleLabel Roles.historical
        @ [ "build"; "student"; "teacher"; "meditator"; "executor" ]

    /// 参数为小写名。含下划线的旧式复合名同样按历史名拒绝。
    let isLegacyName (lowered: string): bool =
        List.contains lowered legacyNames || lowered.Contains "_"

    let private roleOfKind (kind: ParticipantKind): Role option =
        match kind with
        | ManagedRole role -> Some role
        | Bookkeeper -> None

    let private personaV1 (kind: ParticipantKind): string =
        match kind with
        | ManagedRole role -> PersonaCatalog.personaV1 role
        | Bookkeeper -> PersonaCatalog.bookkeeperPersonaV1

    let private parseKnownCanonicalName (name: string): Result<PersonaName * ParticipantKind, ParticipantIdentityError> =
        match name.ToLowerInvariant() with
        | "bookkeeper" -> Ok(PersonaName "bookkeeper", Bookkeeper)
        | lowered ->
            match Roles.tryParseRole lowered with
            | Some role -> Ok(PersonaName(Roles.roleLabel role), ManagedRole role)
            | None -> Error(ParticipantIdentityError.UnknownParticipantName name)

    /// 规范名解析：空白 → Blank；历史/废弃名 → Legacy；含大写或连字符 → Malformed；
    /// 活跃角色与内部槽位（bookkeeper）之外 → Unknown。绝不静默映射到活跃角色。
    let private parseCanonicalName (name: string) =
        if isNull (box name) || String.IsNullOrWhiteSpace name then
            Error ParticipantIdentityError.BlankParticipantName
        elif isLegacyName (name.ToLowerInvariant()) then
            Error(ParticipantIdentityError.LegacyParticipantName name)
        elif name <> name.ToLowerInvariant() || name.Contains "-" then
            Error(ParticipantIdentityError.MalformedParticipantName name)
        else
            parseKnownCanonicalName name

    let private create name kind persona version origin : ParticipantIdentityEvidence =
        { Identity =
            { SelectedAgent = name
              Kind = kind
              Persona = persona
              PersonaCatalogVersion = version
              Origin = origin } }

    let selectedAgent (evidence: ParticipantIdentityEvidence): string =
        let (PersonaName name) = evidence.Identity.SelectedAgent
        name

    let roleOf (evidence: ParticipantIdentityEvidence): Role option = roleOfKind evidence.Identity.Kind
    let persona (evidence: ParticipantIdentityEvidence): string = evidence.Identity.Persona
    let personaCatalogVersion (evidence: ParticipantIdentityEvidence): int = evidence.Identity.PersonaCatalogVersion
    let origin (evidence: ParticipantIdentityEvidence): PersonaOrigin = evidence.Identity.Origin

    let toInput (evidence: ParticipantIdentityEvidence): ParticipantIdentityInput =
        { SelectedAgent = selectedAgent evidence
          Role = roleOf evidence
          Persona = persona evidence
          PersonaCatalogVersion = personaCatalogVersion evidence
          Origin = origin evidence }

    /// 根选定：参与者名在根处被选定，persona 按 V1 目录一次解析，身份证据自此不可变。
    let resolveAtRoot (name: string): Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        parseCanonicalName name
        |> Result.map (fun (parsed, kind) ->
            create parsed kind (personaV1 kind) currentVersion PersonaOrigin.ResolvedAtRoot)

    /// 继承自所有者：子身份沿用所有者的 persona 与目录版本；子名必须是当前规范名。
    let inheritFromOwner
        (name: string)
        (owner: ParticipantIdentityEvidence)
        : Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        parseCanonicalName name
        |> Result.map (fun (parsed, kind) ->
            create parsed kind (persona owner) owner.Identity.PersonaCatalogVersion PersonaOrigin.InheritedFromOwner)

    let private validateShape (input: ParticipantIdentityInput) (parsed: PersonaName * ParticipantKind) =
        let (_, kind) = parsed
        let expectedRole = roleOfKind kind

        if input.PersonaCatalogVersion <> currentVersion then
            Error(ParticipantIdentityError.UnsupportedPersonaCatalogVersion input.PersonaCatalogVersion)
        elif input.Role <> expectedRole then
            Error(ParticipantIdentityError.RoleMismatch(expectedRole, input.Role))
        elif isNull (box input.Persona) || String.IsNullOrWhiteSpace input.Persona then
            Error ParticipantIdentityError.BlankPersona
        else
            Ok parsed

    let private rehydrateRoot (input: ParticipantIdentityInput) ((name, kind): PersonaName * ParticipantKind) =
        let expected = personaV1 kind

        if input.Persona <> expected then
            Error(ParticipantIdentityError.PersonaMismatch(expected, input.Persona))
        else
            Ok(create name kind input.Persona currentVersion PersonaOrigin.ResolvedAtRoot)

    let private rehydrateInherited
        (owner: ParticipantIdentityEvidence)
        (input: ParticipantIdentityInput)
        ((name, kind): PersonaName * ParticipantKind)
        =
        if input.Persona <> persona owner then
            Error(ParticipantIdentityError.OwnerPersonaMismatch(persona owner, input.Persona))
        elif input.PersonaCatalogVersion <> personaCatalogVersion owner then
            Error(
                ParticipantIdentityError.OwnerCatalogVersionMismatch(personaCatalogVersion owner, input.PersonaCatalogVersion)
            )
        else
            Ok(create name kind input.Persona owner.Identity.PersonaCatalogVersion PersonaOrigin.InheritedFromOwner)

    /// 历史解码：继承身份可携带已退役角色名（如 inspector），保留原角色，绝不升级为活跃角色。
    /// 根选定身份不享有此例外。
    let private parseCandidate (input: ParticipantIdentityInput) =
        match parseCanonicalName input.SelectedAgent with
        | Error(ParticipantIdentityError.LegacyParticipantName name) when
            input.Origin = PersonaOrigin.InheritedFromOwner
            ->
            match Roles.tryParseHistoricalRole name with
            | Some role -> Ok(PersonaName name, ManagedRole role)
            | None -> Error(ParticipantIdentityError.LegacyParticipantName name)
        | result -> result

    /// 重水化：对既有身份输入做完整校验，任何错配一律拒绝。
    /// owner 为 None 时，InheritedFromOwner 输入必须被拒绝（OwnerRequired）；
    /// 有 owner 时只接受 InheritedFromOwner 输入。
    let rehydrate
        (owner: ParticipantIdentityEvidence option)
        (input: ParticipantIdentityInput)
        : Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        parseCandidate input
        |> Result.bind (validateShape input)
        |> Result.bind (fun parsed ->
            match owner, input.Origin with
            | None, PersonaOrigin.InheritedFromOwner -> Error ParticipantIdentityError.OwnerRequired
            | Some _, PersonaOrigin.ResolvedAtRoot ->
                Error(ParticipantIdentityError.OriginMismatch(PersonaOrigin.InheritedFromOwner, PersonaOrigin.ResolvedAtRoot))
            | None, PersonaOrigin.ResolvedAtRoot -> rehydrateRoot input parsed
            | Some ownerEvidence, PersonaOrigin.InheritedFromOwner -> rehydrateInherited ownerEvidence input parsed)

    /// 已记录证据的恢复：读取本库先前产出并已随原子事实持久化的证据。
    /// 根选定证据完整重验 persona；继承证据的 owner 见证在记录时已校验，
    /// 这里只重验名、角色、目录版本与非空 persona，不重新要求 owner。
    let restoreRecorded (input: ParticipantIdentityInput): Result<ParticipantIdentityEvidence, ParticipantIdentityError> =
        parseCandidate input
        |> Result.bind (validateShape input)
        |> Result.bind (fun ((name, kind) as parsed) ->
            match input.Origin with
            | PersonaOrigin.ResolvedAtRoot -> rehydrateRoot input parsed
            | PersonaOrigin.InheritedFromOwner ->
                Ok(create name kind input.Persona currentVersion PersonaOrigin.InheritedFromOwner))

    // ── JS 边界 ──────────────────────────────────────────────────────────────

    let private originLabel (origin: PersonaOrigin): string =
        match origin with
        | PersonaOrigin.ResolvedAtRoot -> "ResolvedAtRoot"
        | PersonaOrigin.InheritedFromOwner -> "InheritedFromOwner"

    let private roleView (role: Role option): obj =
        match role with
        | Some value -> box (Roles.roleLabel value)
        | None -> null

    /// 把 plain 视图 { name, role, persona, catalogVersion, origin } 解码为类型化输入。
    /// role 为 null/缺失表示 Bookkeeper；其余字段类型不符按对应身份错误拒绝。
    let decodeInput (view: obj): Result<ParticipantIdentityInput, ParticipantIdentityError> =
        if not (Wire.isPlainObject view) then
            Error ParticipantIdentityError.BlankParticipantName
        else
            let name = Wire.get view "name"
            let role = Wire.get view "role"
            let personaValue = Wire.get view "persona"
            let originValue = Wire.get view "origin"

            if not (Wire.isString name) then
                Error ParticipantIdentityError.BlankParticipantName
            else
                let parsedRole =
                    if Wire.isNullOrUndefined role then Ok None
                    elif Wire.isString role then
                        match Roles.tryParseHistoricalRole(unbox<string> role) with
                        | Some value -> Ok(Some value)
                        | None -> Error(ParticipantIdentityError.InvalidRoleLabel(unbox<string> role))
                    else
                        Error(ParticipantIdentityError.InvalidRoleLabel(string role))

                let parsedOrigin =
                    match (if Wire.isString originValue then unbox<string> originValue else null) with
                    | "ResolvedAtRoot" -> Ok PersonaOrigin.ResolvedAtRoot
                    | "InheritedFromOwner" -> Ok PersonaOrigin.InheritedFromOwner
                    | other -> Error(ParticipantIdentityError.InvalidOriginLabel(if isNull other then "" else other))

                match parsedRole, parsedOrigin, Wire.int view "catalogVersion" with
                | Error error, _, _
                | _, Error error, _ -> Error error
                | _, _, None -> Error(ParticipantIdentityError.UnsupportedPersonaCatalogVersion 0)
                | Ok roleOption, Ok originValue, Some version ->
                    Ok
                        { SelectedAgent = unbox<string> name
                          Role = roleOption
                          Persona = (if Wire.isString personaValue then unbox<string> personaValue else "")
                          PersonaCatalogVersion = version
                          Origin = originValue }

    /// 身份证据的 plain 投影（供 JS 边界与 ExecutionBinding 消费）。Bookkeeper 的 role 为 null。
    let toView (evidence: ParticipantIdentityEvidence): obj =
        createObj [
            "name", box (selectedAgent evidence)
            "role", roleView (roleOf evidence)
            "persona", box (persona evidence)
            "catalogVersion", box (personaCatalogVersion evidence)
            "origin", box (originLabel (origin evidence))
        ]

    /// 错误的 plain 投影：{ error, detail? } 或错配类的 { error, expected, actual }。
    let errorView (error: ParticipantIdentityError): obj =
        let only kind = createObj [ "error", box kind ]
        let detail kind (value: obj) = createObj [ "error", box kind; "detail", value ]
        let pair kind (expected: obj) (actual: obj) =
            createObj [ "error", box kind; "expected", expected; "actual", actual ]

        match error with
        | ParticipantIdentityError.BlankParticipantName -> only "BlankParticipantName"
        | ParticipantIdentityError.LegacyParticipantName name -> detail "LegacyParticipantName" (box name)
        | ParticipantIdentityError.MalformedParticipantName name -> detail "MalformedParticipantName" (box name)
        | ParticipantIdentityError.UnknownParticipantName name -> detail "UnknownParticipantName" (box name)
        | ParticipantIdentityError.UnsupportedPersonaCatalogVersion version ->
            detail "UnsupportedPersonaCatalogVersion" (box version)
        | ParticipantIdentityError.RoleMismatch(expected, actual) -> pair "RoleMismatch" (roleView expected) (roleView actual)
        | ParticipantIdentityError.BlankPersona -> only "BlankPersona"
        | ParticipantIdentityError.PersonaMismatch(expected, actual) -> pair "PersonaMismatch" (box expected) (box actual)
        | ParticipantIdentityError.OriginMismatch(expected, actual) ->
            pair "OriginMismatch" (box (originLabel expected)) (box (originLabel actual))
        | ParticipantIdentityError.OwnerRequired -> only "OwnerRequired"
        | ParticipantIdentityError.OwnerPersonaMismatch(expected, actual) ->
            pair "OwnerPersonaMismatch" (box expected) (box actual)
        | ParticipantIdentityError.OwnerCatalogVersionMismatch(expected, actual) ->
            pair "OwnerCatalogVersionMismatch" (box expected) (box actual)
        | ParticipantIdentityError.InvalidRoleLabel label -> detail "InvalidRoleLabel" (box label)
        | ParticipantIdentityError.InvalidOriginLabel label -> detail "InvalidOriginLabel" (box label)
