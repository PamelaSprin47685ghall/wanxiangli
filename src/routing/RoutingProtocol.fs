namespace Wanxiangli.Routing

open System
open Fable.Core
open Fable.Core.JsInterop

module internal Wire =

    [<Emit("typeof $0 === 'function'")>]
    let isFunction (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'number'")>]
    let isNumber (_value: obj) : bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBoolean (_value: obj) : bool = jsNative

    [<Emit("$0 != null && (typeof $0 === 'object' || typeof $0 === 'function') && typeof $0.then === 'function'")>]
    let isThenable (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("$0 == null")>]
    let isNullish (_value: obj) : bool = jsNative

    [<Emit("$0($1, $2, $3)")>]
    let call3 (_fn: obj) (_a: obj) (_b: obj) (_c: obj) : obj = jsNative

    [<Emit("$0($1)")>]
    let call1 (_fn: obj) (_a: obj) : obj = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    [<Emit("String($0)")>]
    let show (_value: obj) : string = jsNative

/// A target the runtime can hold: full `provider/model` and a non-empty reasoning, both trimmed.
type internal Target = { Model: string; Reasoning: string }

module internal Target =

    let private fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    let private text (name: string) (value: obj) =
        if Wire.isString value && not (String.IsNullOrWhiteSpace(unbox<string> value)) then
            (unbox<string> value).Trim()
        else
            fail (sprintf "scheduler target requires non-empty %s" name)

    let private fullSelector (model: string) =
        let slash = model.IndexOf '/'

        if slash <= 0 || slash >= model.Length - 1 then
            fail "scheduler target model must be full provider/model"

        model

    /// 严格解码：null 不是 target；字段必须是非空字符串；model 必须是 provider/model。
    let decode (value: obj) : Target =
        if Wire.isNullish value then
            fail "null is not a target"

        let model = text "model" (value?model: obj) |> fullSelector
        let reasoning = text "reasoning" (value?reasoning: obj)
        { Model = model; Reasoning = reasoning }

    let encode (target: Target) : obj =
        Wire.freeze (createObj [ "model" ==> target.Model; "reasoning" ==> target.Reasoning ])

    let provider (target: Target) =
        target.Model.Substring(0, target.Model.IndexOf '/')

module internal Protocol =

    [<Literal>]
    let Version = 2.0

    let private migrate =
        "Migrate the existing configuration manually (the recommended template in resources/wanxiangshu.mjs shows the new shape); an existing user file is never overwritten."

    let private fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    /// 协议版本是 ABI 的格式版本，不是启用开关：缺失、非数字、其它数字都拒绝。
    let requireVersion (declared: obj) =
        if Wire.isNullish declared then
            fail (
                "wanxiangshu.mjs must export `routingProtocol = 2`; the scheduler ABI is route(role, running, previous). "
                + migrate
            )
        elif not (Wire.isNumber declared) then
            fail (
                "wanxiangshu.mjs routingProtocol must be the number 2; the scheduler ABI is route(role, running, previous). "
                + migrate
            )
        elif unbox<float> declared <> Version then
            fail (
                sprintf
                    "wanxiangshu.mjs declares routingProtocol = %s but this runtime requires 2 (route(role, running, previous)). %s"
                    (Wire.show declared)
                    migrate
            )

/// wanxiangli/routing 公开入口：模型调度器的协议 owner（CUT-10）。
/// 只做 ABI：模块导出形状、版本、同步调用、target 解码与理论容量查询的结果类型。
/// 不读文件、不加载模块、不持有容量；选择策略全部属于用户 MJS。
[<AttachMembers>]
type RoutingProtocol() =

    let fail (message: string) : 'a =
        raise (InvalidOperationException("execution-model-routing: " + message))

    let requireRole (role: obj) =
        if Wire.isString role && not (String.IsNullOrWhiteSpace(unbox<string> role)) then
            (unbox<string> role).Trim()
        else
            fail "scheduler role must be non-empty"

    /// 调度协议版本。
    member _.version: float = Protocol.Version

    /// 校验一个 MJS 模块命名空间，交还冻结的策略对象 { route, hasTheoreticalCapacity, markProviderFailed }。
    /// default 必须是函数，routingProtocol 必须是数字 2，hasTheoreticalCapacity 必须是函数；
    /// markProviderFailed 可省略（交还 null），出现时必须是函数。任何不符都抛出可操作的错误。
    member _.admit(moduleNamespace: obj) : obj =
        let route: obj = if Wire.isNullish moduleNamespace then null else moduleNamespace?``default``

        if not (Wire.isFunction route) then
            fail "scheduler default export must be a function"

        Protocol.requireVersion(moduleNamespace?routingProtocol: obj)

        let capacity: obj = moduleNamespace?hasTheoreticalCapacity

        if not (Wire.isFunction capacity) then
            fail (
                "wanxiangshu.mjs must export `hasTheoreticalCapacity(role)`; protocol 2 answers theoretical capacity per role. "
                + "Migrate the existing configuration manually (the recommended template in resources/wanxiangshu.mjs shows the new shape); an existing user file is never overwritten."
            )

        let markFailed: obj = moduleNamespace?markProviderFailed

        if not (Wire.isNullish markFailed) && not (Wire.isFunction markFailed) then
            fail "wanxiangshu.mjs markProviderFailed must be a function when exported"

        Wire.freeze (
            createObj
                [ "route" ==> route
                  "hasTheoreticalCapacity" ==> capacity
                  "markProviderFailed" ==> (if Wire.isNullish markFailed then null else markFailed: obj) ]
        )

    /// 调用 route(role, running, previous)，恰好三个参数。running 与 previous 以新冻结副本交出，
    /// 调度器改不到调用方的账本。返回 Promise 或非法结构抛错；null / undefined 是“等待”，交还 null。
    member _.route(route: obj, role: obj, running: obj, previous: obj) : obj =
        if not (Wire.isFunction route) then
            fail "scheduler default export must be a function"

        let role = requireRole role

        if not (Wire.isArray running) then
            fail "running must be an array of targets"

        let running =
            Wire.freeze (unbox<obj array> running |> Array.map (Target.decode >> Target.encode) |> box)

        let previous =
            if Wire.isNullish previous then null else Target.encode (Target.decode previous)

        let result = Wire.call3 route role running previous

        if Wire.isThenable result then
            fail "scheduler must be synchronous and must not return a Promise"

        if Wire.isNullish result then null else Target.encode (Target.decode result)

    /// 理论容量查询 hasTheoreticalCapacity(role)，恰好一个参数。只认布尔结果：
    /// Promise 或其它值不是“有容量”，抛错交调用方按配置错误处理。
    member _.hasTheoreticalCapacity(query: obj, role: obj) : bool =
        if not (Wire.isFunction query) then
            fail "hasTheoreticalCapacity must be a function"

        let result = Wire.call1 query (requireRole role)

        if Wire.isThenable result then
            fail "hasTheoreticalCapacity must be synchronous and must not return a Promise"

        if not (Wire.isBoolean result) then
            fail (sprintf "hasTheoreticalCapacity must return a boolean (got %s)" (Wire.show result))

        unbox<bool> result

    /// 严格解码一个 target：{ model: 'provider/model', reasoning }，交还修剪后的冻结副本。
    member _.decodeTarget(value: obj) : obj = Target.encode (Target.decode value)

    /// 解码持久道路记录的 'provider/model:reasoning'；与 decodeTarget 同一字段规则，坏值抛错。
    /// 分隔符是最后一个 ':'：模型名本身可以含 ':'（如 ollama 的 gemma4:31b），reasoning 不含。
    member _.decodeDurableTarget(value: obj) : obj =
        if not (Wire.isString value) || String.IsNullOrWhiteSpace(unbox<string> value) then
            fail "durable DevOps model target is empty"

        let text = (unbox<string> value).Trim()
        let separator = text.LastIndexOf ':'

        if separator <= 0 || separator >= text.Length - 1 then
            fail (sprintf "durable DevOps model target must be 'provider/model:reasoning' (got '%s')" text)

        Target.encode (
            Target.decode (
                createObj
                    [ "model" ==> text.Substring(0, separator)
                      "reasoning" ==> text.Substring(separator + 1) ]
            )
        )

    /// target 的 provider（model 中第一个 '/' 之前）。target 先按 decodeTarget 校验。
    member _.providerOf(target: obj) : string = Target.provider (Target.decode target)
