import { Program, ProgramSession, ProgramCatalog, ProgramInvocation, Wait, type ProgramOptions, type ProgramReceipt, type ProgramInvocationFailure, type ProgramInvocationResult } from 'wanxiangli/program'
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
type Failure = { readonly cause: Error }
const original: Failure = { cause: new Error('original') }
const failure: ProgramInvocationFailure<Failure> = { code: 'APPEND_FAILED', reason: 'store failed', failure: original }
const invocation = new ProgramInvocation<{ path: string }, Failure>({
  root: '.',
  ledger: {
    prepared: ({ mutation }) => ({ path: mutation.path }),
    committed: token => { void token.path },
    settle: async () => null,
  },
  observe: ({ reads, effectPaths }) => { void [reads[0]?.resultBytes, effectPaths] },
  checkReturn: ({ value }) => value === undefined ? failure : null,
})
const { api, ...invocationOptions } = options
const invoked: Promise<ProgramInvocationResult<Failure>> = invocation.execute(session, invocationOptions, invocation.files)
void invoked
// @ts-expect-error Failure references retain the supplied type.
const invalidFailure: ProgramInvocationFailure<Failure> = { code: 'APPEND_FAILED', reason: 'failed', failure: 'flattened' }
void invalidFailure
void [Program, ProgramCatalog, Wait, RuntimeTools, FileSession, Filesystem, ProcessSession, Terminal, OutputSpool, Time, pending, call]
