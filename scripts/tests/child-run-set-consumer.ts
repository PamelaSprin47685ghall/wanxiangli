import { ChildRunSet, type ChildRunCompletion, type ChildRunInput, type ChildRunMailbox } from 'wanxiangli/handle-lifecycle'
import { Wait } from 'wanxiangli/program'

const transport = Wait.completionMailbox()
const mailbox: ChildRunMailbox<unknown, unknown, unknown> = {
  ...transport,
  drainAgents: max => transport.drainAgents(max).map(String),
}
const children = new ChildRunSet({mailbox, now: () => new Date(), mintRunId: () => 'run-ts',
  raceExit: async pending => { await pending; return true },
  runDefault: async () => ({kind: 'completed', view: 'answer'})})
const input: ChildRunInput = {agentId: 'a', agent: 'engineer', role: 'engineer'}
children.fork(input)
const returned = await children.awaitAgent('a')
if (returned.ok) {
  const completion: ChildRunCompletion = returned.value
  const material: string | undefined = completion.outcome.view
  void material
}
children.close()
