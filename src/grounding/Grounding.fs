module Wanxiangli.Grounding.Grounding

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Grounding.Wire
open Wanxiangli.Grounding.Catalog

/// wanxiangli/grounding 公开入口：无状态方法对象。
/// 消费方（主仓 GroundingCatalog 桥接与库测试）均以 `Grounding.method(...)`
/// 形式调用；与 build.mjs 以文件名定位导出实体的规则对齐。
let Grounding: obj =
    createObj [
        "sha256Hex" ==> Wire.sha256Hex
        "matchesPathPattern" ==> Wire.matchesPathPattern
        "canonicalWorkspace" ==> Catalog.canonicalWorkspace
        "workspaceRelativePath" ==> Catalog.workspaceRelativePath
        "discover" ==> Catalog.discover
        "resolve" ==> Catalog.resolve
        "materialize" ==> Catalog.materialize
        "snapshotsForPaths" ==> Catalog.snapshotsForPaths
    ]
