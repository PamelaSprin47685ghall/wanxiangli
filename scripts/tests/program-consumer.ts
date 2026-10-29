import { Program, ProgramSession, ProgramCatalog, Wait, type ProgramOptions, type ProgramReceipt } from 'wanxiangli/program'
import { Runtime, RuntimeTools, FileSession, Filesystem, ProcessSession, Terminal, OutputSpool, Time, type CallResult } from 'wanxiangli/runtime'
const runtime = Runtime()
const session = ProgramSession('consumer')
const options: ProgramOptions = {
  name: 'consumer', program: 'class Js extends JsProgram { async run() { return 1; } }',
  intent: 'Collect the result under the same request deadline.',
  root: '.', baseClass: 'class JsProgram {}', api: {}, capabilities: [],
  executionBudgetMs: 1000, outputBoundBytes: 4096
}
const pending: Promise<ProgramReceipt> = session.execute(options)
const call: Promise<CallResult> = runtime.startCommand({root: '.', command:'true'}).result
void [Program, ProgramCatalog, Wait, RuntimeTools, FileSession, Filesystem, ProcessSession, Terminal, OutputSpool, Time, pending, call]
