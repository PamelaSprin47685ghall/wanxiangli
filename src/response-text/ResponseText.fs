module Wanxiangli.ResponseText

open System
open System.Text.RegularExpressions

// 保留包含匹配：破损标签和正文中的标签同样命中，不解析 XML。
let private toolMarkup =
    Regex(
        "<(?:/?\\s*(?:tool_call|use_tool|call|function_call|invoke)\\b[^>]*>?)|</(?:tool_call|use_tool|call|function_call|invoke)\\s*>",
        RegexOptions.Compiled ||| RegexOptions.IgnoreCase
    )

/// 只报告词法形状；续轮、失败和完成由调用方决定。
let classify (text: string) : string =
    if String.IsNullOrWhiteSpace text then "Empty"
    elif toolMarkup.IsMatch text then "ToolMarkup"
    else "Text"
