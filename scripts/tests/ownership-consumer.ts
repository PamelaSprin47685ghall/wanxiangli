import { Ownership, type Lease, type Binding, type Message } from 'wanxiangli/ownership'

const owner = new Ownership('typed-registry')
owner.execute('open', { type: 'OpenScope', scopeId: 'work', parentId: null })
const message: Message = { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'session' }
const reply = owner.execute('reserve', message)
if (reply.result.kind === 'Reserved') {
  const lease: Lease = reply.result.lease
  const binding: Binding = { externalId: 'physical-container', incarnationId: 'unique-instance' }
  owner.execute('started', { type: 'Started', lease, binding })
  owner.execute('cancel', { type: 'Cancel', lease })
  owner.execute('end', { type: 'Ended', lease, binding, outcome: 'Cancelled' })
  owner.resource(lease)
  // @ts-expect-error 超时不是终态。
  owner.execute('wrong', { type: 'Ended', lease, binding, outcome: 'TimedOut' })
  // @ts-expect-error 物理容器名不能替代包含实例身份的关联。
  owner.execute('wrong', { type: 'Started', lease, binding: { externalId: 'pid' } })
}
owner.execute('drain', { type: 'Drain', scopeId: 'work' })
owner.blockers('work').map(resource => resource.lease.token)
owner.execute('close', { type: 'Close', scopeId: 'work' })
new Ownership('typed-registry', owner.records()).head()
// @ts-expect-error 不注入存储服务。
new Ownership('typed-registry', { read() { return [] }, append() {} })
// @ts-expect-error lease 不能被裸资源名替代。
owner.resource('child')
// @ts-expect-error 每次开立都明确父范围，不以缺字段猜测。
owner.execute('missing-parent', { type: 'OpenScope', scopeId: 'child' })
// @ts-expect-error 没有按计数释放全部资源的捷径。
owner.execute('unsafe', { type: 'ReleaseAll', scopeId: 'work' })
