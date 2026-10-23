import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = path.join(root, 'src')
const compiler = path.join(root, 'node_modules/@fable-org/fable-compiler-js/index.js')
function discoverProjects() {
  const projects = new Map()
  for (const directory of readdirSync(source, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const folder = path.join(source, directory.name)
    const files = readdirSync(folder).filter(file => file.endsWith('.fsproj'))
    if (files.length > 1) throw new Error(`One project is allowed per module: ${directory.name}`)
    if (files.length === 1) projects.set(directory.name, path.join(folder, files[0]))
  }
  return projects
}
const projects = discoverProjects()

const args = process.argv.slice(2)
// 增量构建：模块输入（fsproj、其显式源文件、工具链版本、本脚本）未变且产物完好时跳过。
// `--force` 或 WANXIANGLI_BUILD_FORCE=1 强制全部重编。
const force = args.includes('--force') || /^(1|true|yes)$/i.test(process.env.WANXIANGLI_BUILD_FORCE ?? '')
const selected = args.filter(arg => arg !== '--force')
const allModules = selected.length === 0
if (allModules) selected.push(...projects.keys())
if (selected.length === 0) throw new Error('No implemented modules found')
for (const name of selected) {
  if (!projects.has(name)) throw new Error(`Unknown module: ${name}`)
}

mkdirSync(path.join(root, '.build'), { recursive: true })
mkdirSync(path.join(root, 'dist'), { recursive: true })

const stamps = path.join(root, '.build-stamps')
const sha256 = data => createHash('sha256').update(data).digest('hex')
function packageVersion(name) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}
// 工具链指纹：编译器、Fable 运行库（被打包进产物）、esbuild、Node 主版本与构建脚本本身。
function toolchainKey() {
  return sha256(JSON.stringify({
    compiler: packageVersion('@fable-org/fable-compiler-js'),
    fableLibrary: packageVersion('@fable-org/fable-library-js'),
    esbuild: packageVersion('esbuild'),
    node: process.versions.node.split('.')[0],
    script: sha256(readFileSync(fileURLToPath(import.meta.url))),
  }))
}
const toolchain = toolchainKey()

function moduleKey(name, project, declaration, includes) {
  const hash = createHash('sha256')
  hash.update(`toolchain\0${toolchain}\0module\0${name}\0fsproj\0${path.basename(project)}\0`)
  hash.update(declaration)
  for (const file of includes) {
    const content = readFileSync(path.join(path.dirname(project), file))
    hash.update(`\0source\0${file}\0${content.length}\0`)
    hash.update(content)
  }
  return hash.digest('hex')
}

function listOutputs(directory, prefix = '') {
  const outputs = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(outputs, listOutputs(full, relative))
    else if (entry.isFile()) outputs[relative] = sha256(readFileSync(full))
  }
  return outputs
}

function readStamp(name) {
  try {
    return JSON.parse(readFileSync(path.join(stamps, `${name}.json`), 'utf8'))
  } catch {
    return null
  }
}

// 只有输入指纹相同、且 dist/<name> 的每个文件与记录的摘要逐一相同，才算缓存命中。
function cached(name, key, target) {
  const stamp = readStamp(name)
  if (!stamp || stamp.key !== key || !stamp.outputs) return false
  try {
    if (!statSync(target).isDirectory()) return false
    const actual = listOutputs(target)
    const expected = stamp.outputs
    const names = Object.keys(expected)
    return names.length > 0 && names.length === Object.keys(actual).length
      && names.every(file => actual[file] === expected[file])
  } catch {
    return false
  }
}

function writeStamp(name, key, target) {
  mkdirSync(stamps, { recursive: true })
  const file = path.join(stamps, `${name}.json`)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ key, outputs: listOutputs(target) }, null, 2)}\n`)
  renameSync(temporary, file)
}

function dropStamp(name) {
  rmSync(path.join(stamps, `${name}.json`), { force: true })
}

function moduleInputs(name, project) {
  const declaration = readFileSync(project, 'utf8')
  const xml = declaration.replace(/<!--[\s\S]*?-->/g, '')
  if (/<ProjectReference\b|<Import\b/.test(xml)) {
    throw new Error(`Module ${name} must compile without other source projects`)
  }
  // 与 Fable ProjectParser 一样读取属性，不依赖属性顺序、引号或等号两侧空白。
  const includes = [...xml.matchAll(/<Compile\s+[^>]*Include\s*=\s*("[^"]*|'[^']*)/g)]
    .map(match => match[1].slice(1).trim().replaceAll('\\', '/'))
  if (includes.length === 0) throw new Error(`No sources declared: ${name}`)
  for (const file of includes) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || /[*?]/.test(file)) {
      throw new Error(`Source must be local and explicit: ${name}/${file}`)
    }
  }
  return { name, project, includes, key: moduleKey(name, project, declaration, includes) }
}

function assertInputsUnchanged(input) {
  let current
  try {
    current = moduleInputs(input.name, input.project)
  } catch (cause) {
    dropStamp(input.name)
    throw new Error(`Inputs changed during build: ${input.name}; run the build again`, { cause })
  }
  if (current.key !== input.key) {
    dropStamp(input.name)
    throw new Error(`Inputs changed during build: ${input.name}; run the build again`)
  }
}

const inputs = selected.map(name => moduleInputs(name, projects.get(name)))

for (const input of inputs) {
  const { name, project, includes, key } = input
  const temporary = path.join(root, '.build', `${name}-${process.pid}`)
  const target = path.join(root, 'dist', name)
  if (!force && cached(name, key, target)) {
    console.log(`[build] ${name}: cached`)
    continue
  }
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
      // 以临时目录为工作目录，产物里的模块路径注释不再带进程号，相同输入得到相同字节。
      absWorkingDir: temporary,
    })
    assertInputsUnchanged(input)
    dropStamp(name)
    rmSync(target, { recursive: true, force: true })
    renameSync(bundle, target)
    writeStamp(name, key, target)
    console.log(`[build] ${name}: ${(performance.now() - start).toFixed(0)} ms`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (toolchainKey() !== toolchain) {
  for (const name of selected) dropStamp(name)
  throw new Error('Inputs changed during build: toolchain; run the build again')
}
// 缓存命中的模块也必须复查，后续模块编译期间仍可能保存它们的源码。
for (const input of inputs) assertInputsUnchanged(input)
const finalProjects = discoverProjects()
if ((allModules && finalProjects.size !== projects.size)
  || selected.some(name => finalProjects.get(name) !== projects.get(name))) {
  throw new Error('Inputs changed during build: module projects; run the build again')
}
