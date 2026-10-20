namespace Wanxiangli.Capability

open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj): bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let isPlainObject (_value: obj): bool = jsNative

    /// 严格布尔：只有 true 本身算 true；缺失、非布尔一律 false。
    [<Emit("$0 === true")>]
    let isTrue (_value: obj): bool = jsNative

/// wanxiangli/capability 公开入口。无状态能力 owner：可见工具面与运行时门禁读同一份结果。
/// JS 边界只收发 plain data；能力以规范标签（如 "Read"）出入，集合按字典序排列。
[<AttachMembers>]
type Capability() =

    let labels (permissions: Set<Permission>): string array =
        permissions |> Set.toList |> List.map Permission.label |> List.sort |> List.toArray

    let roleOf (role: obj): string = if Wire.isString role then unbox<string> role else ""

    let factsOf (raw: obj): ManagerFacts option =
        if not (Wire.isPlainObject raw) then None
        else
            Some
                { HasActiveIncumbency = Wire.isTrue raw?hasActiveIncumbency
                  HasAssessment = Wire.isTrue raw?hasAssessment
                  HasConfirmation = Wire.isTrue raw?hasConfirmation
                  IsFinalIncumbent = Wire.isTrue raw?isFinalIncumbent
                  HasCleanupBlocker = Wire.isTrue raw?hasCleanupBlocker }

    /// 全部能力标签（声明顺序）。
    member _.permissionLabels(): string array = Permission.all |> List.map Permission.label |> List.toArray

    /// 角色的能力标签（排序）。非规范角色标签一律空集。
    member _.permissions(role: obj): string array = labels (OfficeMatrix.permissions (roleOf role))

    /// 角色是否持有该能力；未知能力标签一律 false。
    member _.isAllowed(role: obj, permission: obj): bool =
        Wire.isString permission
        && (match Permission.tryParse (unbox<string> permission) with
            | Some value -> OfficeMatrix.permissions (roleOf role) |> Set.contains value
            | None -> false)

    member _.managerReviewReadOnlyPermissions(): string array = labels OfficeMatrix.managerReviewReadOnly

    member _.managerFinishPermissions(): string array = labels OfficeMatrix.managerFinish

    /// Manager 事实门禁。facts = { hasActiveIncumbency, hasAssessment, hasConfirmation,
    /// isFinalIncumbent, hasCleanupBlocker }，字段必须是布尔 true 才算成立；非对象一律空集。
    member _.permissionsForManagerFacts(facts: obj): string array =
        match factsOf facts with
        | Some value -> labels (OfficeMatrix.permissionsForManagerFacts value)
        | None -> [||]
