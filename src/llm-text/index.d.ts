declare const documentBrand: unique symbol
declare const blockBrand: unique symbol
declare const fieldBrand: unique symbol
declare const valueBrand: unique symbol
export interface Document { readonly [documentBrand]: true }
export interface DataBlock { readonly [blockBrand]: true }
export interface Field { readonly [fieldBrand]: true }
export interface Value { readonly [valueBrand]: true }

/** Values belong to the instance that created them. No I/O or mutable public state. */
export declare class LlmText {
  constructor()
  empty(): Document
  instructions(texts: readonly string[]): Document
  instruction(text: string): Document
  instructionsOnly(document: Document): Document
  withInstructions(texts: readonly string[], document: Document): Document
  withInstruction(text: string, document: Document): Document
  withData(blocks: readonly DataBlock[], document: Document): Document
  combine(documents: readonly Document[]): Document
  render(document: Document): string
  renderInstruction(text: string): string
  renderInstructions(texts: readonly string[]): string
  normalizeNewlines(text: string): string
  byteCount(text: string): number
  /** Snapshots supported JS values; does not promise lossless arbitrary JSON encoding. */
  ofJs(value: unknown): Value
  integerValue(value: bigint): Value
  arrayValue(values: readonly Value[]): Value
  objectValue(fields: readonly (readonly [string, Value])[]): Value
  structuredValue(value: Value): DataBlock[]
  rootStructuredValue(value: Value): DataBlock[]
  stringField(name: string, value: string): DataBlock
  intField(name: string, value: number): DataBlock
  int64Field(name: string, value: bigint): DataBlock
  boolField(name: string, value: boolean): DataBlock
  stringMember(name: string, value: string): Field
  intMember(name: string, value: number): Field
  int64Member(name: string, value: bigint): Field
  floatMember(name: string, value: number): Field
  boolMember(name: string, value: boolean): Field
  table(name: string, fields: readonly Field[]): DataBlock
  tableArray(name: string, fields: readonly Field[]): DataBlock
  textTables(name: string, texts: readonly string[]): DataBlock[]
}
