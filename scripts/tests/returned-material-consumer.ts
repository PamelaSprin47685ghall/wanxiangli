import * as material from 'wanxiangli/returned-material'

const reports: readonly string[] = ['report']
const materials: readonly string[] = ['artifact']
const encoded: string = material.encode(reports, materials)
const body: string[] = material.body(encoded)
const carry: string[] = material.carry(encoded)
const error: string | null = material.validationError(encoded)
const entries: { text: string }[] = material.entries(encoded)
const fullText: string = material.fullText(encoded)
body.push('local')
carry.push('local')
entries[0].text = 'local'
void error
void fullText
// @ts-expect-error 原块必须是字符串。
material.encode([42], [])
// @ts-expect-error 编码输入是字符串，不接收已经解析的对象。
material.body({ body: [], carry: [] })
// @ts-expect-error 测试输入转换不属于存储协议入口。
material.ofEntries([])
// @ts-expect-error 呈现由独立模块承担。
material.render(encoded)
