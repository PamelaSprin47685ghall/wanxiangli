import { writeSync, writeFileSync, closeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [mode, ...args] = process.argv.slice(2)
switch (mode) {
  case 'report':
    process.stdout.write(JSON.stringify({ args, cwd: process.cwd(), env: process.env }))
    process.stderr.write('diagnostic\n')
    break
  case 'stamp':
    writeFileSync(args[0], 'executed')
    break
  case 'exit':
    process.exitCode = Number(args[0])
    break
  case 'echo':
    process.stdin.pipe(process.stdout)
    process.stderr.write('ready\n')
    break
  case 'idle':
    process.on('SIGTERM', () => process.stderr.write('term-seen\n'))
    process.stdin.resume()
    process.stdin.on('end', () => process.exit(0))
    process.stdout.write('ready\n')
    break
  case 'paused':
    setInterval(() => {}, 1000)
    process.stdout.write('ready\n')
    break
  case 'broken-input':
    closeSync(0)
    setInterval(() => {}, 1000)
    process.stdout.write('ready\n')
    break
  case 'bytes':
    process.stdout.write(Buffer.from(args[0], 'base64'))
    process.stderr.write(Buffer.from(args[1] ?? '', 'base64'))
    break
  case 'flood': {
    const block = Buffer.alloc(65536, 0x61)
    for (let i = 0; i < 128; i++) writeSync(1, block)
    for (let i = 0; i < 16; i++) writeSync(2, block)
    writeSync(1, Buffer.from('最后的原始输出🧭\n'))
    writeSync(2, Buffer.from('stderr-tail\n'))
    break
  }
  case 'split': {
    let phase = 0
    process.stdin.on('data', () => {
      const chunks = [Buffer.from([0xf0, 0x9f]), Buffer.from([0x98, 0x80]), Buffer.from('尾')]
      process.stdout.write(chunks[phase++])
    })
    break
  }
  case 'grandchild':
    process.on('SIGTERM', () => process.stdout.write('grandchild-term\n'))
    process.stdout.write(JSON.stringify({ grandchild: process.pid }) + '\n')
    setInterval(() => {}, 1000)
    break
  case 'group': {
    process.on('SIGTERM', () => process.stderr.write('leader-term\n'))
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'grandchild'], { stdio: ['ignore', 'pipe', 'pipe'], env: {} })
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    break
  }
  case 'draining': {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'grandchild'], { stdio: ['ignore', 1, 2], env: {} })
    child.unref()
    process.exit(0)
    break
  }
  default: throw new Error(`Unknown worker mode: ${mode}`)
}
