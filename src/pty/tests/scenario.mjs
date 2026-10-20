// Run under Bun: bun scenario.mjs <name>. Drives a real bun-pty terminal through wanxiangli/pty.
import { spawn } from 'bun-pty'
import { Terminal } from '../../../dist/pty/Terminal.js'

const cwd = process.cwd()
const open = (command, cols = 80, rows = 24) => {
  const opened = Terminal.open({ driver: spawn, command, cwd, cols, rows })
  if (opened.kind !== 'Opened') throw new Error('open failed: ' + JSON.stringify(opened))
  return opened.terminal
}
const drainAll = async (terminal, limitMs = 8000) => {
  let output = ''
  const until = Date.now() + limitMs
  for (;;) {
    const read = await terminal.read(500)
    output += read.output
    if (read.closed || Date.now() > until) return { output, closed: read.closed }
  }
}
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const scenarios = {
  async roundtrip() {
    const t = open('test -t 0 && echo tty-yes; IFS= read -r line; printf "got:%s\\n" "$line"; printf "\\344\\270\\255\\346\\226\\207\\342\\234\\223\\n"')
    const first = await t.read(5000)
    const write = t.write('abc\n')
    const rest = await drainAll(t)
    const exit = await t.wait()
    return { first, write, rest, exit, inspect: t.inspect(),
      after: { write: t.write('x'), signal: t.signal('TERM'), resize: t.resize(10, 10), read: await t.read(0) } }
  },
  async silent() {
    const t = open('sleep 3')
    const start = Date.now()
    const pending = t.read(300)
    const busy = await t.read(100)
    const read = await pending
    const elapsed = Date.now() - start
    const immediate = await t.read(0)
    const closed = await t.close(1000)
    return { busy, read, elapsed, immediate, closed }
  },
  async wake() {
    const t = open('sleep 0.3; echo late; sleep 3')
    const start = Date.now()
    const read = await t.read(10000)
    const elapsed = Date.now() - start
    await t.close(1000)
    return { read, elapsed }
  },
  async descendants() {
    const t = open('sh -c \'trap "" TERM; exec sleep 300\' & echo child=$!; sleep 300')
    let text = ''
    while (!/child=\d+\s/.test(text)) text += (await t.read(3000)).output
    const child = Number(text.match(/child=(\d+)/)[1])
    const before = alive(child)
    const closed = await t.close(1000)
    await sleep(200)
    return { child, before, closed, after: alive(child), inspect: t.inspect() }
  },
  async escalate() {
    const t = open('trap "" TERM; echo ready; while :; do sleep 0.1; done')
    await t.read(3000)
    const start = Date.now()
    const closed = await t.close(300)
    return { closed, elapsed: Date.now() - start, again: await t.close(0) }
  },
  async signal() {
    const t = open('echo ready; sleep 300')
    await t.read(3000)
    const sent = t.signal('INT')
    const exit = await Promise.race([t.wait(), sleep(5000).then(() => 'timeout')])
    return { sent, exit }
  },
  async resize() {
    const t = open('sleep 0.5; stty size', 80, 24)
    const resized = t.resize(120, 40)
    const rest = await drainAll(t)
    return { resized, rest }
  },
  async badCwd() {
    const opened = Terminal.open({ driver: spawn, command: 'echo hi', cwd: '/nonexistent/wanxiangli-pty', cols: 80, rows: 24 })
    if (opened.kind !== 'Opened') return { opened }
    const rest = await drainAll(opened.terminal)
    return { opened: { kind: 'Opened' }, rest, exit: await opened.terminal.wait() }
  },
}

const name = process.argv[2]
const result = await scenarios[name]()
process.stdout.write(JSON.stringify(result) + '\n')
process.exit(0)
