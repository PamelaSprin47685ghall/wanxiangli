namespace Wanxiangli.Prefix

/// 当前世代内已提交的 view 声明检查点（按工具调用身份）。
/// 同一调用身份再次进入是同一事实的重放，不是第二个检查点。
/// 世代推进时由组合者整体清空；本模块不认识世代。
module Checkpoints =

    let append (callId: string) (window: string list) : string list =
        if List.contains callId window then window else window @ [ callId ]
