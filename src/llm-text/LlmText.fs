namespace Wanxiangli.LlmText

open Fable.Core

module private Tokens =
    [<Emit("new WeakMap()")>]
    let createMap () : obj = jsNative

    [<Emit("Object.freeze(Object.create(null))")>]
    let createToken () : obj = jsNative

    [<Emit("$0.set($1, $2)")>]
    let set (_map: obj) (_token: obj) (_value: obj) : unit = jsNative

    [<Emit("$0.get($1)")>]
    let get (_map: obj) (_token: obj) : obj = jsNative

    [<Emit("$0 === undefined")>]
    let missing (_value: obj) : bool = jsNative

    let wrap map value =
        let token = createToken ()
        set map token (box value)
        token

    let read<'T> map token : 'T =
        let value = get map token
        if missing value then invalidArg "value" "Value belongs to another LlmText instance or has the wrong kind"
        unbox value

type private Store =
    { Documents: obj
      Blocks: obj
      Fields: obj
      Values: obj }

module private Stores =
    // 弱键只关联实例的私有状态，不延长实例或文档的寿命。
    let private owners = Tokens.createMap ()
    let register (owner: obj) =
        Tokens.set owners owner (box { Documents = Tokens.createMap (); Blocks = Tokens.createMap (); Fields = Tokens.createMap (); Values = Tokens.createMap () })
    let private store (owner: obj) = Tokens.read<Store> owners owner
    let document (owner: obj) (token: obj) = Tokens.read<Representation.Document> (store owner).Documents token
    let block (owner: obj) (token: obj) = Tokens.read<Representation.DataBlock> (store owner).Blocks token
    let field (owner: obj) (token: obj) = Tokens.read<Representation.Data.Field> (store owner).Fields token
    let value (owner: obj) (token: obj) = Tokens.read<Representation.Data.Value> (store owner).Values token
    let wrapDocument owner value = Tokens.wrap (store owner).Documents value
    let wrapBlock owner value = Tokens.wrap (store owner).Blocks value
    let wrapField owner value = Tokens.wrap (store owner).Fields value
    let wrapValue owner value = Tokens.wrap (store owner).Values value
    let wrapBlocks owner values = values |> List.map (wrapBlock owner) |> List.toArray

open Stores

/// 指令、数据和值通过不透明令牌交流；数组在边界复制为私有值。
[<AttachMembers>]
type LlmText() as self =
    do Stores.register self

    member this.empty() = Representation.empty |> wrapDocument this
    member this.instructions(texts: string array) = Representation.instructions (List.ofArray texts) |> wrapDocument this
    member this.instruction(text: string) = Representation.instruction text |> wrapDocument this
    member this.instructionsOnly(current: obj) = Representation.instructionsOnly (document this current) |> wrapDocument this
    member this.withInstructions(texts: string array, current: obj) =
        Representation.withInstructions (List.ofArray texts) (document this current) |> wrapDocument this
    member this.withInstruction(text: string, current: obj) =
        Representation.withInstruction text (document this current) |> wrapDocument this
    member this.withData(data: obj array, current: obj) =
        Representation.withData (data |> Array.map (block this) |> List.ofArray) (document this current) |> wrapDocument this
    member this.combine(items: obj array) =
        Representation.combine (items |> Array.map (document this) |> List.ofArray) |> wrapDocument this
    member this.render(current: obj) = Representation.render (document this current)
    member _.renderInstruction(text: string) = Representation.renderInstruction text
    member _.renderInstructions(texts: string array) = Representation.renderInstructions (List.ofArray texts)
    member _.normalizeNewlines(text: string) = Representation.normalizeNewlines text
    member _.byteCount(text: string) = Representation.byteCount text

    member this.ofJs(input: obj) = Representation.Data.ofJs input |> wrapValue this
    member this.integerValue(input: int64) = Representation.Data.Value.Integer input |> wrapValue this
    member this.arrayValue(items: obj array) =
        Representation.Data.Value.Array (items |> Array.map (value this) |> List.ofArray) |> wrapValue this
    member this.objectValue(items: (string * obj) array) =
        Representation.Data.Value.Object (items |> Array.map (fun (name, token) -> name, value this token) |> List.ofArray)
        |> wrapValue this
    member this.structuredValue(input: obj) = Representation.Data.structuredValue (value this input) |> wrapBlocks this
    member this.rootStructuredValue(input: obj) = Representation.Data.rootStructuredValue (value this input) |> wrapBlocks this

    member this.stringField(name: string, input: string) = Representation.Data.stringField name input |> wrapBlock this
    member this.intField(name: string, input: int) = Representation.Data.intField name input |> wrapBlock this
    member this.int64Field(name: string, input: int64) = Representation.Data.int64Field name input |> wrapBlock this
    member this.boolField(name: string, input: bool) = Representation.Data.boolField name input |> wrapBlock this
    member this.stringMember(name: string, input: string) = Representation.Data.stringMember name input |> wrapField this
    member this.intMember(name: string, input: int) = Representation.Data.intMember name input |> wrapField this
    member this.int64Member(name: string, input: int64) = Representation.Data.int64Member name input |> wrapField this
    member this.floatMember(name: string, input: float) = Representation.Data.floatMember name input |> wrapField this
    member this.boolMember(name: string, input: bool) = Representation.Data.boolMember name input |> wrapField this
    member this.table(name: string, members: obj array) =
        Representation.Data.table name (members |> Array.map (field this) |> List.ofArray) |> wrapBlock this
    member this.tableArray(name: string, members: obj array) =
        Representation.Data.tableArray name (members |> Array.map (field this) |> List.ofArray) |> wrapBlock this
    member this.textTables(name: string, texts: string array) = Representation.Data.textTables name (List.ofArray texts) |> wrapBlocks this
