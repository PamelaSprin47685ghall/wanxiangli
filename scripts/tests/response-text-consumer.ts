import { classify, type ResponseTextShape } from 'wanxiangli/response-text'

const empty: ResponseTextShape = classify(null)
const text: 'Empty' | 'ToolMarkup' | 'Text' = classify('ordinary')
void empty
void text
// @ts-expect-error 只接受字符串或 null。
classify(42)
// @ts-expect-error 不接收宿主消息对象。
classify({ content: 'ordinary' })
// @ts-expect-error 输出仅报告形状，不返回完成状态。
const completed: 'Complete' = classify('ordinary')
void completed
