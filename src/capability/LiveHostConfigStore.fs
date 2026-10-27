namespace Wanxiangli.Capability

open Fable.Core
open Fable.Core.JsInterop

module internal LiveHostConfigWire =

    [<Emit("$0 === null || $0 === undefined")>]
    let isNil (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'boolean'")>]
    let isBoolean (_value: obj): bool = jsNative

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj): bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj): bool = jsNative

type internal SettingItem =
    { RawPath: string array
      PathList: string list
      IsBool: bool
      BoolVal: bool
      TextVal: string }

module internal LiveHostConfigTree =

    open LiveHostConfigWire

    let packNullConfig () : obj =
        createObj
            [ "ok" ==> false
              "error" ==> "the host supplied no config object" ]

    let readLeaf (node: obj) (leaf: string) : obj option =
        if isNil node || isNil node?(leaf) then
            None
        else
            Some node?(leaf)

    let rec descendStep (node: obj) (path: string list) : obj option =
        match path with
        | [] -> None
        | [ leaf ] -> readLeaf node leaf
        | head :: rest -> descendRead node?(head) rest

    and descendRead (node: obj) (path: string list) : obj option =
        if isNil node then None else descendStep node path

    let ensureChild (node: obj) (head: string) : obj =
        if isNil node?(head) then
            node?(head) <- createObj []
        node?(head)

    let writeLeaf (node: obj) (leaf: string) (isBool: bool) (boolVal: bool) (textVal: string) : unit =
        if isBool then
            node?(leaf) <- box boolVal
        else
            node?(leaf) <- box textVal

    let rec descendWriteStep (node: obj) (path: string list) (isBool: bool) (boolVal: bool) (textVal: string) : unit =
        match path with
        | [] -> ()
        | [ leaf ] -> writeLeaf node leaf isBool boolVal textVal
        | head :: rest ->
            let child = ensureChild node head
            descendWriteStep child rest isBool boolVal textVal

    let tryUnboxBool (act: obj) (expected: bool) : bool =
        try
            isBoolean act && unbox<bool> act = expected
        with _ ->
            false

    let tryUnboxString (act: obj) (expected: string) : bool =
        try
            isString act && unbox<string> act = expected
        with _ ->
            false

    let checkValueMatch (isBool: bool) (boolVal: bool) (textVal: string) (actual: obj) : bool =
        if isBool then
            tryUnboxBool actual boolVal
        else
            tryUnboxString actual textVal

    let valueMatches (isBool: bool) (boolVal: bool) (textVal: string) (actualOpt: obj option) : bool =
        match actualOpt with
        | Some act -> checkValueMatch isBool boolVal textVal act
        | None -> false

    let extractPath (item: obj) : string array =
        if isNil item || isNil item?path then [||]
        elif isArray item?path then unbox<string array> item?path
        else [||]

    let extractIsBool (item: obj) : bool =
        if isString item?kind then
            unbox<string> item?kind = "bool"
        else
            isBoolean item?value

    let extractBoolVal (item: obj) : bool =
        if isBoolean item?value then unbox<bool> item?value else false

    let extractTextVal (item: obj) : string =
        if isNil item?value then "" else string item?value

    let parseSettingItem (item: obj) : SettingItem =
        let pathArr = extractPath item
        { RawPath = pathArr
          PathList = Array.toList pathArr
          IsBool = extractIsBool item
          BoolVal = extractBoolVal item
          TextVal = extractTextVal item }

    let applyOne (node: obj) (item: SettingItem) : bool =
        descendWriteStep node item.PathList item.IsBool item.BoolVal item.TextVal
        let actual = descendRead node item.PathList
        valueMatches item.IsBool item.BoolVal item.TextVal actual

    let findFirstGap (node: obj) (items: SettingItem list) : SettingItem option =
        items |> List.tryFind (fun item -> not (applyOne node item))

    let packGap (gapItem: SettingItem) : obj =
        createObj
            [ "ok" ==> true
              "hasGap" ==> true
              "gapPath" ==> gapItem.RawPath
              "gapReason" ==> "the host did not accept or preserve the configured setting" ]

    let packSuccess () : obj =
        createObj
            [ "ok" ==> true
              "hasGap" ==> false
              "gapPath" ==> [||]
              "gapReason" ==> "" ]

    let packFound (raw: obj) : obj =
        if isBoolean raw then
            createObj
                [ "ok" ==> true
                  "found" ==> true
                  "kind" ==> "bool"
                  "value" ==> box (unbox<bool> raw) ]
        else
            createObj
                [ "ok" ==> true
                  "found" ==> true
                  "kind" ==> "text"
                  "value" ==> box (string raw) ]

    let packNotFound () : obj =
        createObj
            [ "ok" ==> true
              "found" ==> false
              "kind" ==> ""
              "value" ==> null ]

    let applyInternal (node: obj) (settings: obj array) : obj =
        let items =
            if isNil settings then []
            else settings |> Array.toList |> List.map parseSettingItem
        match findFirstGap node items with
        | Some gap -> packGap gap
        | None -> packSuccess ()

    let toSafePathList (path: string array) : string list =
        if isNil path then []
        else Array.toList path

    let readFromNode (node: obj) (path: string array) : obj =
        let pathList = toSafePathList path
        match descendRead node pathList with
        | Some raw -> packFound raw
        | None -> packNotFound ()

    let applyCatching (node: obj) (settings: obj array) : obj =
        try
            applyInternal node settings
        with ex ->
            createObj
                [ "ok" ==> false
                  "error" ==> ("the host config rejected the write: " + ex.Message) ]

[<AttachMembers>]
type LiveHostConfigStore(initialConfig: obj) =

    let mutable current = initialConfig

    member _.accept(nextConfig: obj) : unit =
        current <- nextConfig

    member _.read(path: string array) : obj =
        if LiveHostConfigWire.isNil current then
            LiveHostConfigTree.packNullConfig ()
        else
            LiveHostConfigTree.readFromNode current path

    member _.apply(settings: obj array) : obj =
        if LiveHostConfigWire.isNil current then
            LiveHostConfigTree.packNullConfig ()
        else
            LiveHostConfigTree.applyCatching current settings
