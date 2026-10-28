import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { format } from 'node:util'

const root = process.argv[2]
process.chdir(root)
let compiler
for (const [method, stream] of [['log', 'stdout'], ['warn', 'stderr'], ['error', 'stderr']]) {
  console[method] = (...args) => {
    if (process.connected) process.send({ type: 'log', stream, text: format(...args) + '\n' })
  }
}
let bundler
let manager
const checkers = new Set()
const checked = new WeakSet()
let previousCheckers = new Set()
let reuse = { created: 0, reused: 0, reusedAcrossBuilds: 0 }
let completed = 0
let fcsMs = 0
let diagnostics = []

async function initialize() {
  if (compiler) return
  await import(pathToFileURL(path.join(root, 'node_modules/@fable-org/fable-standalone/dist/bundle.min.js')))
  const init = globalThis.__FABLE_STANDALONE__.init
  globalThis.__FABLE_STANDALONE__.init = () => {
    manager = init()
    return {
      ...manager,
      CreateChecker(...args) {
        const checker = manager.CreateChecker(...args)
        checkers.add(checker)
        reuse.created++
        return checker
      },
      ParseAndCheckProject(...args) {
        const started = performance.now()
        if (checked.has(args[0])) {
          reuse.reused++
          if (previousCheckers.has(args[0])) reuse.reusedAcrossBuilds++
        }
        checked.add(args[0])
        try {
          const result = manager.ParseAndCheckProject(...args)
          diagnostics = result.Errors.map(error => ({ message: error.Message, warning: error.IsWarning,
            file: path.basename(error.FileName ?? ''), line: error.StartLine, column: error.StartColumn }))
          return result
        } finally { fcsMs += performance.now() - started }
      },
    }
  }
  try {
    const module = await import(pathToFileURL(path.join(root, 'scripts/compiler.mjs')))
    compiler = await module.createCompiler(path.join(root, 'node_modules/@fable-org/fable-library-js'))
    bundler = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')))
  } finally { globalThis.__FABLE_STANDALONE__.init = init }
}

const statistics = () => ({ pid: process.pid, completed, checkers: checkers.size,
  memory: process.memoryUsage(), cpu: process.cpuUsage(), reuse })
const respond = value => { if (process.connected) process.send(value) }
process.on('disconnect', () => process.exit())
process.on('message', async request => {
  try {
    if (request.op === 'stats') {
      respond({ id: request.id, ok: true, ...statistics() })
      return
    }
    fcsMs = 0
    diagnostics = []
    await initialize()
    previousCheckers = new Set(checkers)
    reuse = { created: 0, reused: 0, reusedAcrossBuilds: 0 }
    const rows = []
    for (const input of request.inputs) {
      const output = input.temporary
      fs.mkdirSync(output, { recursive: true })
      const started = performance.now()
      const previous = fcsMs
      try {
        await compiler.compile(input.project, output)
        for (const file of input.includes.filter(file => file.endsWith('.fs'))) {
          if (!fs.existsSync(path.join(output, file.replace(/\.fs$/, '.js')))) throw new Error(`Compiler did not emit ${input.name}/${file}`)
        }
        const publicClass = path.basename(input.includes.at(-1), '.fs')
        const declaration = fs.readFileSync(input.project, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
        const exports = [...declaration.matchAll(/<PackageExport\s+([^>]+)\/?>/g)].map(match => {
          const attributes = Object.fromEntries([...match[1].matchAll(/(Include|Member)\s*=\s*["']([^"']+)["']/g)].map(value => [value[1], value[2]]))
          if (!input.includes.includes(attributes.Include) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(attributes.Member ?? '')) {
            throw new Error(`Invalid package export: ${input.name}`)
          }
          return `export { ${attributes.Member} } from ${JSON.stringify(path.join(output, attributes.Include.replace(/\.fs$/, '.js')))}`
        })
        const entry = path.join(output, publicClass + '.js')
        await bundler.build({
          stdin: { contents: exports.length ? exports.join('\n') : `export { ${publicClass} } from ${JSON.stringify(entry)}`, resolveDir: root },
          outfile: path.join(output, 'package', publicClass + '.js'), bundle: true, external: ['wanxiangli/*'],
          platform: 'node', format: 'esm', target: 'node22', legalComments: 'inline', absWorkingDir: output,
        })
        completed++
        rows.push({ name: input.name, ms: performance.now() - started, fcsMs: fcsMs - previous })
      } finally {
        for (const checker of checkers) manager.ClearCache(checker)
      }
    }
    bundler.stop()
    respond({ id: request.id, ok: true, rows, fcsMs, ...statistics() })
  } catch (error) {
    bundler?.stop()
    respond({ id: request.id, ok: false, error: error.message, diagnostics, ...statistics() })
  }
})
