import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const digest = value => createHash('sha256').update(value).digest('hex')

export function files(directory, prefix = '', ancestors = []) {
  if (!fs.existsSync(directory)) return {}
  const real = fs.realpathSync(directory)
  if (ancestors.includes(real)) throw new Error(`Cyclic directory link: ${directory}`)
  const result = {}
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name)
    const relative = prefix + name
    const stat = fs.statSync(full)
    if (stat.isDirectory()) Object.assign(result, files(full, relative + '/', [...ancestors, real]))
    else if (stat.isFile()) result[relative] = digest(fs.readFileSync(full))
  }
  return result
}

export function codeKey(root) {
  const executable = fs.realpathSync(process.execPath)
  const stat = fs.statSync(executable)
  const scripts = fs.readdirSync(path.join(root, 'scripts')).filter(name => name.endsWith('.mjs')).sort()
  return digest(JSON.stringify([process.version, process.platform, process.arch, executable,
    stat.size, stat.mtimeMs, scripts.map(name => [name, digest(fs.readFileSync(path.join(root, 'scripts', name)))])]))
}

export function settings() {
  const positive = (name, fallback) => {
    const value = Number(process.env[name] ?? fallback)
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
    return value
  }
  return { idleMs: positive('WANXIANGLI_BUILD_IDLE_MS', 600000),
    projectLimit: positive('WANXIANGLI_CHECKER_PROJECT_LIMIT', 128) }
}

export const runtimeKey = root => digest(JSON.stringify([codeKey(root), settings()]))

export function toolchainKey(root) {
  const hash = createHash('sha256').update(codeKey(root))
  for (const name of ['package.json', 'package-lock.json']) {
    const file = path.join(root, name)
    hash.update(JSON.stringify([name, fs.existsSync(file) ? digest(fs.readFileSync(file)) : null]))
  }
  for (const name of ['@fable-org', 'esbuild', '@esbuild', 'dirname-filename-esm']) {
    const directory = path.join(root, 'node_modules', name)
    if (!fs.existsSync(directory)) throw new Error(`Missing compiler dependency: ${name}`)
    hash.update(JSON.stringify([name, files(directory)]))
  }
  return hash.digest('hex')
}

export function discover(root) {
  const projects = new Map()
  for (const entry of fs.readdirSync(path.join(root, 'src'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const folder = path.join(root, 'src', entry.name)
    const names = fs.readdirSync(folder).filter(name => name.endsWith('.fsproj'))
    if (names.length > 1) throw new Error(`One project is allowed per module: ${entry.name}`)
    if (names.length) projects.set(entry.name, path.join(folder, names[0]))
  }
  return projects
}

export function moduleInput(name, project, toolchain) {
  const declaration = fs.readFileSync(project, 'utf8')
  const xml = declaration.replace(/<!--[\s\S]*?-->/g, '')
  if (/<ProjectReference\b|<Import\b/.test(xml)) throw new Error(`Module ${name} must compile without other source projects`)
  const includes = [...xml.matchAll(/<Compile\s+[^>]*Include\s*=\s*("[^"]*|'[^']*)/g)]
    .map(match => match[1].slice(1).trim().replaceAll('\\', '/'))
  if (!includes.length) throw new Error(`No sources declared: ${name}`)
  const hash = createHash('sha256').update(JSON.stringify([toolchain, name, path.basename(project), declaration, includes]))
  for (const file of includes) {
    if (path.isAbsolute(file) || file.split('/').includes('..') || /[*?]/.test(file)) throw new Error(`Source must be local and explicit: ${name}/${file}`)
    const content = fs.readFileSync(path.join(path.dirname(project), file))
    hash.update(JSON.stringify([file, content.length]))
    hash.update(content)
  }
  return { name, project, includes, key: hash.digest('hex') }
}

export function cached(root, input) {
  try {
    const stamp = JSON.parse(fs.readFileSync(path.join(root, '.build-stamps', input.name + '.json')))
    const outputs = files(path.join(root, 'dist', input.name))
    return stamp.key === input.key && Object.keys(outputs).length > 0
      && JSON.stringify(stamp.outputs) === JSON.stringify(outputs)
  } catch { return false }
}
