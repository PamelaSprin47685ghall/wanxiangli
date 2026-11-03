namespace Wanxiangli.LlmText

[<RequireQualifiedAccess>]
module internal Representation =

    type DataBlock = private DataBlock of string

    type Document =
        private
            { Instructions: string list
              Data: DataBlock list }

    let empty: Document = { Instructions = []; Data = [] }

    let instructions (texts: string list) : Document = { Instructions = texts; Data = [] }

    let instruction (text: string) : Document = instructions [ text ]

    let instructionsOnly (document: Document) : Document = { document with Data = [] }

    let withInstructions (texts: string list) (document: Document) : Document =
        { document with
            Instructions = document.Instructions @ texts }

    let withInstruction (text: string) (document: Document) : Document = withInstructions [ text ] document

    let withData (blocks: DataBlock list) (document: Document) : Document =
        { document with
            Data = document.Data @ blocks }

    let combine (documents: Document list) : Document =
        documents
        |> List.fold
            (fun acc document ->
                { Instructions = acc.Instructions @ document.Instructions
                  Data = acc.Data @ document.Data })
            empty

    let render (document: Document) : string =
        let body = document.Data |> List.map (fun (DataBlock block) -> block)
        SyntheticToml.document document.Instructions body

    let renderInstruction (text: string) : string = instruction text |> render

    let renderInstructions (texts: string list) : string = instructions texts |> render

    let normalizeNewlines = SyntheticToml.normalizeNewlines

    let byteCount = SyntheticToml.byteCount

    [<RequireQualifiedAccess>]
    module Data =

        open Fable.Core

        let private block text = DataBlock text

        type Value =
            | Null
            | Bool of bool
            | Integer of int64
            | Float of float
            | String of string
            | Array of Value list
            | Object of (string * Value) list

        [<Emit("$0 === null")>]
        let private jsNull (_value: obj) : bool = jsNative

        [<Emit("typeof $0")>]
        let private jsType (_value: obj) : string = jsNative

        [<Emit("Array.isArray($0)")>]
        let private jsIsArray (_value: obj) : bool = jsNative

        [<Emit("Number.isInteger($0)")>]
        let private jsIsInteger (_value: obj) : bool = jsNative

        [<Emit("Number.isFinite($0)")>]
        let private jsIsFinite (_value: obj) : bool = jsNative

        [<Emit("Object.keys($0)")>]
        let private jsKeys (_value: obj) : string array = jsNative

        [<Emit("$0[$1]")>]
        let private jsGet (_target: obj) (_key: obj) : obj = jsNative

        [<Emit("$0.length")>]
        let private jsLength (_target: obj) : int = jsNative

        let private maxSafeInteger = 9007199254740991.0

        let private ofJsNumber (value: obj) : Value =
            let num: float = unbox value

            if jsIsInteger value && abs num <= maxSafeInteger then
                Value.Integer(int64 num)
            else
                Value.Float num

        let rec ofJs (value: obj) : Value =
            if jsNull value then
                Value.Null
            elif jsType value = "boolean" then
                Value.Bool(unbox value)
            elif jsType value = "string" then
                Value.String(unbox value)
            elif jsType value = "number" then
                ofJsNumber value
            elif jsIsArray value then
                Value.Array [ for i in 0 .. jsLength value - 1 -> ofJs (jsGet value i) ]
            elif jsType value = "object" then
                let keys = jsKeys value
                Value.Object [ for k in keys -> k, ofJs (jsGet value k) ]
            else
                Value.Null

        let rec private isPrimitiveTree =
            function
            | Value.Bool _
            | Value.Integer _
            | Value.Float _
            | Value.String _ -> true
            | Value.Array values -> List.forall isPrimitiveTree values
            | Value.Null
            | Value.Object _ -> false

        let rec private renderInline =
            function
            | Value.Bool value -> SyntheticToml.renderBool value
            | Value.Integer value -> SyntheticToml.renderInt value
            | Value.Float value -> SyntheticToml.renderFloat value
            | Value.String value -> SyntheticToml.renderString value
            | Value.Array values -> "[" + String.concat ", " (List.map renderInline values) + "]"
            | Value.Null
            | Value.Object _ -> "false"

        let private formatPath segments =
            segments |> List.map SyntheticToml.renderKey |> String.concat "."

        let rec private structuredBlocks value =
            let rec encodeObject path fields =
                let present =
                    fields
                    |> List.choose (fun (name, item) ->
                        match item with
                        | Value.Null -> None
                        | _ -> Some(name, item))

                let localFields, nested =
                    present
                    |> List.fold
                        (fun (local, nested) (name, item) ->
                            match item with
                            | Value.Object row -> local, nested @ encodeObject (path @ [ name ]) row
                            | Value.Array items when
                                not (List.isEmpty items)
                                && List.forall
                                    (function
                                    | Value.Object _ -> true
                                    | _ -> false)
                                    items
                                ->
                                let rows =
                                    items
                                    |> List.collect (function
                                        | Value.Object row -> encodeObjectRow (path @ [ name ]) row
                                        | _ -> [])

                                local, nested @ rows
                            | Value.Null -> local, nested
                            | _ ->
                                local
                                @ [ SyntheticToml.field (SyntheticToml.renderKey name) (renderInline item) ],
                                nested)
                        ([], [])

                let self =
                    match localFields, nested with
                    | [], [] -> [ SyntheticToml.tableEntry (formatPath path) [] |> block ]
                    | [], _ -> []
                    | _, _ -> [ SyntheticToml.tableEntry (formatPath path) localFields |> block ]

                self @ nested

            and encodeObjectRow path fields =
                let present =
                    fields
                    |> List.choose (fun (name, item) ->
                        match item with
                        | Value.Null -> None
                        | _ -> Some(name, item))

                let localFields, nested =
                    present
                    |> List.fold
                        (fun (local, nested) (name, item) ->
                            match item with
                            | Value.Object row -> local, nested @ encodeObject (path @ [ name ]) row
                            | Value.Array items when
                                not (List.isEmpty items)
                                && List.forall
                                    (function
                                    | Value.Object _ -> true
                                    | _ -> false)
                                    items
                                ->
                                let rows =
                                    items
                                    |> List.collect (function
                                        | Value.Object row -> encodeObjectRow (path @ [ name ]) row
                                        | _ -> [])

                                local, nested @ rows
                            | Value.Null -> local, nested
                            | _ ->
                                local
                                @ [ SyntheticToml.field (SyntheticToml.renderKey name) (renderInline item) ],
                                nested)
                        ([], [])

                (SyntheticToml.tableArrayEntry (formatPath path) localFields |> block) :: nested

            match value with
            | Value.Null -> []
            | Value.Bool _
            | Value.Integer _
            | Value.Float _
            | Value.String _ -> [ SyntheticToml.field "data" (renderInline value) |> block ]
            | Value.Array [] -> [ SyntheticToml.field "data" "[]" |> block ]
            | Value.Array items when
                List.forall
                    (function
                    | Value.Object _ -> true
                    | _ -> false)
                    items
                ->
                items
                |> List.collect (function
                    | Value.Object row -> encodeObjectRow [ "data" ] row
                    | _ -> [])
            | Value.Array items -> [ SyntheticToml.field "data" (renderInline (Value.Array items)) |> block ]
            | Value.Object fields -> encodeObject [ "data" ] fields

        let rec private rootBlocks value =
            let rec encodeObject path fields =
                let present =
                    fields
                    |> List.choose (fun (name, item) ->
                        match item with
                        | Value.Null -> None
                        | _ -> Some(name, item))

                let localFields, nested =
                    present
                    |> List.fold
                        (fun (local, nested) (name, item) ->
                            match item with
                            | Value.Object row -> local, nested @ encodeObject (path @ [ name ]) row
                            | Value.Array items when
                                not (List.isEmpty items)
                                && List.forall
                                    (function
                                    | Value.Object _ -> true
                                    | _ -> false)
                                    items
                                ->
                                let rows =
                                    items
                                    |> List.collect (function
                                        | Value.Object row -> encodeObjectRow (path @ [ name ]) row
                                        | _ -> [])

                                local, nested @ rows
                            | Value.Null -> local, nested
                            | _ ->
                                local
                                @ [ SyntheticToml.field (SyntheticToml.renderKey name) (renderInline item) ],
                                nested)
                        ([], [])

                let self =
                    match path, localFields with
                    | [], [] -> []
                    | [], fields -> fields |> List.map block
                    | p, fields -> [ SyntheticToml.tableEntry (formatPath p) fields |> block ]

                self @ nested

            and encodeObjectRow path fields =
                let present =
                    fields
                    |> List.choose (fun (name, item) ->
                        match item with
                        | Value.Null -> None
                        | _ -> Some(name, item))

                let localFields, nested =
                    present
                    |> List.fold
                        (fun (local, nested) (name, item) ->
                            match item with
                            | Value.Object row -> local, nested @ encodeObject (path @ [ name ]) row
                            | Value.Array items when
                                not (List.isEmpty items)
                                && List.forall
                                    (function
                                    | Value.Object _ -> true
                                    | _ -> false)
                                    items
                                ->
                                let rows =
                                    items
                                    |> List.collect (function
                                        | Value.Object row -> encodeObjectRow (path @ [ name ]) row
                                        | _ -> [])

                                local, nested @ rows
                            | Value.Null -> local, nested
                            | _ ->
                                local
                                @ [ SyntheticToml.field (SyntheticToml.renderKey name) (renderInline item) ],
                                nested)
                        ([], [])

                (SyntheticToml.tableArrayEntry (formatPath path) localFields |> block) :: nested

            match value with
            | Value.Null -> []
            | Value.Object fields -> encodeObject [] fields
            | Value.Array [] -> []
            | other -> structuredBlocks other

        let stringField name value =
            SyntheticToml.field name (SyntheticToml.renderString value) |> block

        let intField name (value: int) =
            SyntheticToml.field name (string value) |> block

        let int64Field name (value: int64) =
            SyntheticToml.field name (string value) |> block

        let boolField name (value: bool) =
            SyntheticToml.field name (SyntheticToml.renderBool value) |> block

        let private fieldString name value =
            SyntheticToml.field name (SyntheticToml.renderString value)

        let private fieldInt name (value: int) = SyntheticToml.field name (string value)

        let private fieldInt64 name (value: int64) = SyntheticToml.field name (string value)

        let private fieldFloat name (value: float) =
            SyntheticToml.field name (SyntheticToml.renderFloat value)

        let private fieldBool name (value: bool) =
            SyntheticToml.field name (SyntheticToml.renderBool value)

        type Field = private Field of string

        let stringMember name value = fieldString name value |> Field

        let intMember name value = fieldInt name value |> Field

        let int64Member name value = fieldInt64 name value |> Field

        let floatMember name value = fieldFloat name value |> Field

        let boolMember name value = fieldBool name value |> Field

        let table name (fields: Field list) =
            fields
            |> List.map (fun (Field field) -> field)
            |> SyntheticToml.tableEntry name
            |> block

        let tableArray name (fields: Field list) =
            fields
            |> List.map (fun (Field field) -> field)
            |> SyntheticToml.tableArrayEntry name
            |> block

        let textTables name (texts: string list) =
            texts |> List.map (fun text -> tableArray name [ stringMember "text" text ])

        let structuredValue (value: Value) = structuredBlocks value

        let rootStructuredValue (value: Value) = rootBlocks value
