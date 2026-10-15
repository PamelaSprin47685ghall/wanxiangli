namespace Wanxiangli.Fs

open Fable.Core.JsInterop
open Wanxiangli.Fs.Native

/// 严格 UTF-8 读取：fatal 解码，绝不静默替换；ENOENT → FILE_NOT_FOUND。
/// 含 0x00 字节的二进制文件按非法文本拒绝（INVALID_UTF8）。
module Utf8Fs =

    let private classifyReadFailure path (ex: obj): FsFailure =
        let code = string (ex?code)
        if code = "ENOENT" then failure "FILE_NOT_FOUND" ("target file does not exist: " + path)
        else failure "FILE_READ_FAILED" ("file read failed: " + path)

    let private decodeClassified (path: string) (buffer: obj): Result<string, FsFailure> =
        try
            let text = decodeUtf8 buffer
            if text.Contains("\000") then
                Error(failure "INVALID_UTF8" ("file is not strict UTF-8: " + path))
            else
                Ok text
        with _ ->
            Error(failure "INVALID_UTF8" ("file is not strict UTF-8: " + path))

    /// 严格 UTF-8 读取；fatal 解码错误 → INVALID_UTF8。
    let readUtf8 (path: string): Result<string, FsFailure> =
        try
            Ok(decodeUtf8 (readFileBuffer path))
        with ex ->
            Error(classifyReadFailure path (box ex))

    /// 读取并把非法 UTF-8 与 NUL 字节归类为 INVALID_UTF8。
    let readUtf8Classified (path: string): Result<string, FsFailure> =
        try
            decodeClassified path (readFileBuffer path)
        with ex ->
            Error(classifyReadFailure path (box ex))
