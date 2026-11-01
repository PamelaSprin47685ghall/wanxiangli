import { SegmentedWriter, WriterSegments } from 'wanxiangli/segments'

const segments = new WriterSegments()
const name: string = segments.segmentFileName('owner', 0)
const series: string[] = segments.seriesOf('owner', [name])
void series

const writer = new SegmentedWriter({ directory: () => '/caller/events', writerId: 'owner', segmentCap: 4096 })
const identity: string = writer.writerId
const target: string = writer.filePath()
const outcome = writer.append('encoded line\n')
if (outcome.ok) {
  const completion: 'no-append' | 'durable' = outcome.completion
  void completion
} else {
  const kind: 'before-append' | 'after-append' = outcome.kind
  const phase: 'before-append' | 'append' | 'open' | 'fsync' | 'close' = outcome.primary.phase
  const cause: unknown = outcome.primary.cause
  const cleanup: unknown[] = outcome.cleanupFailures.map(fault => fault.cause)
  void kind; void phase; void cause; void cleanup
}
void identity; void target
// @ts-expect-error 目录必须由调用方以闭包提供。
void new SegmentedWriter({ directory: '/events', writerId: 'owner', segmentCap: 4096 })
// @ts-expect-error writer 身份不能从外部改写。
writer.writerId = 'other'
// @ts-expect-error append 接受主体已编码的文本。
void writer.append(new Uint8Array([65]))
// @ts-expect-error 主体不能控制或镜像库的 CurrentFile。
writer.currentFile = 'other.ndjson'
