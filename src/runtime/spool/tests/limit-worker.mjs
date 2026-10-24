import { OutputSpool } from 'wanxiangli/runtime'
import { statSync } from 'node:fs'

const spool = new OutputSpool({ directory: process.argv[2], memoryBytes: 100 })
const chunk = new Uint8Array(1000).fill(0x61)
for (let i = 0; i < 20; i++) spool.append('stdout', chunk)
const result = spool.finish()
const size = statSync(result.path).size
const discard = spool.discard()
process.stdout.write(JSON.stringify({ result, size, discard }))
