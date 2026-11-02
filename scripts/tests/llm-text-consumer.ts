import { LlmText, type Document, type DataBlock } from 'wanxiangli/llm-text'
const text = new LlmText()
const blocks: DataBlock[] = text.structuredValue(text.objectValue([
  ['large', text.integerValue(9223372036854775807n)],
  ['nested', text.ofJs({ answer: 42 })],
]))
const document: Document = text.withData(blocks, text.instruction('check'))
const rendered: string = text.render(document)
const bytes: number = text.byteCount(rendered)
void bytes
// @ts-expect-error 原始字符串不能冒充数据块。
text.withData(['forged'], document)
// @ts-expect-error int64 不能从可能舍入的 number 输入。
text.int64Field('large', 9223372036854775807)
// @ts-expect-error 文档与字段不是同一种值。
text.render(text.stringMember('name', 'value'))
