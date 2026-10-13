import { readdirSync, readFileSync, mkdirSync, rmSync, renameSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = path.join(root, 'src')
const compiler = path.join(root, 'node_modules/@fable-org/fable-compiler-js/index.js')
const projects = new Map()

for (const directory of readdirSync(source, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue
  const folder = path.join(source, directory.name)
  const files = readdirSync(folder).filter(file => file.endsWith('.fsproj'))
  if (files.length > 1) throw new Error(`One project is allowed per module: ${directory.name}`)
  if (files.length === 1) projects.set(directory.name, path.join(folder, files[0]))
}

const selected = process.argv.slice(2)
if (selected.length === 0) selected.push(...projects.keys())
if (selected.length === 0) throw new Error('No implemented modules found')
for (const name of selected) {
  if (!projects.has(name)) throw new Error(`Unknown module: ${name}`)
}

mkdirSync(path.join(root, '.build'), { recursive: true })
mkdirSync(path.join(root, 'dist'), { recursive: true })

for (const name of selected) {
  const project = projects.get(name)
  const declaration = readFileSync(project, 'utf8')
  if (/<ProjectReference\b|<Import\b/.test(declaration)) {
    throw new Error(`Module ${name} must compile without other source projects`)
  }
  const includes = [...declaration.matchAll(/<Compile\s+Include="([^"]+)"/g)].map(match => match[1])
  if (includes.length === 0) throw new Error(`No sources declared: ${name}`)
  for (const file of includes) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || /[*?]/.test(file)) {
      throw new Error(`Source must be local and explicit: ${name}/${file}`)
    }
  }
  const temporary = path.join(root, '.build', `${name}-${process.pid}`)
  const target = path.join(root, 'dist', name)
  rmSync(temporary, { recursive: true, force: true })
  const start = performance.now()
  try {
    const result = spawnSync(process.execPath, [compiler, project, temporary,
      '--fableLib', path.join(root, 'node_modules/@fable-org/fable-library-js')], { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Compilation failed: ${name}`)
    for (const file of includes.filter(file => file.endsWith('.fs'))) {
      if (!existsSync(path.join(temporary, file.replace(/\.fs$/, '.js')))) {
        throw new Error(`Compiler did not emit ${name}/${file}`)
      }
    }
    const publicClass = path.basename(includes.at(-1), '.fs')
    const entry = path.join(temporary, `${publicClass}.js`)
    const bundle = path.join(temporary, 'package')
    await build({
      stdin: { contents: `export { ${publicClass} } from ${JSON.stringify(entry)}`, resolveDir: root },
      outfile: path.join(bundle, `${publicClass}.js`),
      bundle: true,
      external: ['wanxiangli/*'],
      platform: 'node',
      format: 'esm',
      target: 'node22',
      legalComments: 'inline',
    })
    rmSync(target, { recursive: true, force: true })
    renameSync(bundle, target)
    console.log(`[build] ${name}: ${(performance.now() - start).toFixed(0)} ms`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
