namespace Wanxiangli.Prefix

/// 同一世代的追加律（prefix-stability-001/013）。比较范围：provider、
/// model、variant、完整工具集、system 与消息序列。消息按调用方给出的
/// 规范字节逐条比较；本模块不解析消息内容。
module WireLaw =

    type Wire =
        { Provider: string option
          Model: string option
          Variant: string option
          Tools: string list
          System: string list
          Messages: string list }

    type Break =
        | ProviderChanged
        | ModelChanged
        | VariantChanged
        | ToolsChanged
        | SystemChanged
        | HistoryShorter
        | HistoryChanged

    let label (item: Break) =
        match item with
        | ProviderChanged -> "provider"
        | ModelChanged -> "model"
        | VariantChanged -> "variant"
        | ToolsChanged -> "tools"
        | SystemChanged -> "system"
        | HistoryShorter -> "history-shorter"
        | HistoryChanged -> "history-changed"

    /// 空列表表示 next 是 previous 的同代追加（含完全相同）。
    /// 工具集必须完全一致：追加工具也让缓存整体失效，不能算追加。
    let classify (previous: Wire) (next: Wire) : Break list =
        let previousCount = List.length previous.Messages
        let nextCount = List.length next.Messages

        [ if previous.Provider <> next.Provider then ProviderChanged
          if previous.Model <> next.Model then ModelChanged
          if previous.Variant <> next.Variant then VariantChanged
          if previous.Tools <> next.Tools then ToolsChanged
          if previous.System <> next.System then SystemChanged
          if previousCount > nextCount then
              HistoryShorter
          elif List.truncate previousCount next.Messages <> previous.Messages then
              HistoryChanged ]
