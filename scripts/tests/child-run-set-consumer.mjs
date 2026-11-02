import assert from 'node:assert/strict'
import { ChildRunSet } from 'wanxiangli/handle-lifecycle'
import { Wait } from 'wanxiangli/program'

const mailbox = Wait.completionMailbox()
let finish
const pending = new Promise(resolve => { finish = resolve })
let runs = 0
const children = new ChildRunSet({mailbox, now: () => new Date(0), mintRunId: () => 'run-installed',
  raceExit: async pending => { await pending; return true },
  runDefault: async () => { throw Error('default must not run') }})
const input = {agentId: 'child', agent: 'engineer', role: 'engineer', run: () => { runs++; return pending }}
assert.equal(children.fork(input), 'Created')
assert.equal(children.fork(input), 'Nudged')
children.bindChildSession('child', 'physical-child')
const completion = children.awaitAgent('child')
await Promise.resolve()
assert.equal(runs, 1)
finish({kind: 'completed', view: 'delivered material', childSessionId: 'physical-child'})
const returned = await completion
assert.equal(returned.ok, true)
assert.equal(returned.value.runId, 'run-installed')
assert.equal(returned.value.outcome.view, 'delivered material')
assert.deepEqual(children.drainAgentWakes(5), ['child'])
assert.equal(children.list().agents[0].status, 'Idle')
children.close()
assert.equal(children.fork(input), 'NotFound')
console.log(JSON.stringify({childRunSet: true}))
