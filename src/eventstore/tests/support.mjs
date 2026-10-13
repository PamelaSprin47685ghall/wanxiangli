import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'

export function createJournal(path) {
  return new SqliteJournal(new DatabaseSync(path))
}

export function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-journal-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'journal.sqlite')
}

export function worker(t, database, mode, body) {
  const child = fork(new URL('./worker.mjs', import.meta.url), [database, mode, body], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  child.diagnostics = ''
  child.stderr.on('data', data => { child.diagnostics += data })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  })
  return child
}

export function message(child) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', received)
      child.off('exit', exited)
      child.off('error', failed)
    }
    const received = value => { cleanup(); resolve(value) }
    const exited = (code, signal) => { cleanup(); reject(new Error(`Worker exited: ${code}/${signal}\n${child.diagnostics}`)) }
    const failed = error => { cleanup(); reject(error) }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Worker did not reach the barrier\n${child.diagnostics}`)) }, 10000)
    child.once('message', received)
    child.once('exit', exited)
    child.once('error', failed)
  })
}

export async function kill(child) {
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  return exited
}
