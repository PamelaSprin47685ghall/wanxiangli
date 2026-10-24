namespace Wanxiangli.Fs

open Wanxiangli.Fs.Native

/// gitignore 选中文件上的 grep：跳过不可读与非 UTF-8 文件，
/// 返回行列位置（1-based）、匹配文本，以及被扫描文件的完整读取
/// 快照（供调用方做冲突检测）。
module AnchorFs =

    type GrepHit =
        { Path: string
          Line: int
          Column: int
          Text: string }

    type GrepListing =
        { Matches: GrepHit list
          ReadSnapshots: (string * string) list }

    let private grepHitsOnText (rel: string) (text: string) (spec: Anchor.AnchorSpec) : GrepHit list =
        Anchor.hits text spec
        |> List.map (fun (index, matched) ->
            let line, column = Anchor.lineColumn text index

            { Path = rel
              Line = line
              Column = column
              Text = matched })

    let private grepPath
        (root: string)
        (spec: Anchor.AnchorSpec)
        (rel: string)
        : (GrepHit list * (string * string)) option =
        match Utf8Fs.readUtf8Classified (pathJoin root rel) with
        | Error _ -> None
        | Ok text -> Some(grepHitsOnText rel text spec, (rel, text))

    /// 完整结果，内部不截断；超限由调用方结果边界处理。
    let grep
        (root: string)
        (spec: Anchor.AnchorSpec)
        (pattern: string)
        : System.Threading.Tasks.Task<Result<GrepListing, FsFailure>> =
        task {
            if System.String.IsNullOrEmpty pattern then
                return Error(failure "INVALID_ANCHOR_PATTERN" "anchor RegExp is invalid")
            else
                match! GlobFs.glob root pattern with
                | Error e -> return Error e
                | Ok paths ->
                    let hits = ResizeArray<GrepHit>()
                    let snapshots = ResizeArray<string * string>()

                    for path in paths do
                        do! yieldEventLoop ()

                        grepPath root spec path
                        |> Option.iter (fun (fileHits, snapshot) ->
                            hits.AddRange(fileHits)
                            snapshots.Add(snapshot))

                    return
                        Ok
                            { Matches = List.ofSeq hits
                              ReadSnapshots = List.ofSeq snapshots }
        }
