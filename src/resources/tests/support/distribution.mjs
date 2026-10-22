import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/// The declared provider languages, mirroring `ProviderLanguage` in
/// `src/resources/Language.fs` (English -> en.md, SimplifiedChinese -> zh-CN.md).
export const declaredLanguages = [
  { label: 'en', fileName: 'en.md' },
  { label: 'zh-CN', fileName: 'zh-CN.md' }
]

const placeholderPattern = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g

/// Distinct `{{name}}` placeholder names of a template, in first-occurrence order.
export function placeholders(template) {
  const names = []
  for (const matched of template.matchAll(placeholderPattern)) {
    if (!names.includes(matched[1])) names.push(matched[1])
  }
  return names
}

function semanticDirectories(providerRoot) {
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(directory, entry.name)
      if (entry.name.startsWith('.')) continue
      const children = readdirSync(full, { withFileTypes: true })
      if (children.some((child) => child.isFile() && child.name.endsWith('.md'))) {
        found.push(full)
      } else {
        walk(full)
      }
    }
  }
  walk(providerRoot)
  return found
}

/// The distribution (发行完整性) check: every declared language leaf exists
/// for every semantic resource, and the language pair carries the same
/// `{{placeholder}}` set. Returns the list of violations; empty means intact.
export function checkDistribution(providerRoot) {
  const problems = []
  for (const directory of semanticDirectories(providerRoot)) {
    const templates = new Map()
    for (const language of declaredLanguages) {
      const leaf = join(directory, language.fileName)
      let text = null
      try {
        if (!statSync(leaf).isFile()) throw new Error('not a file')
        text = readFileSync(leaf, 'utf8')
      } catch {
        problems.push(`missing declared language leaf: ${language.label} in ${directory}`)
        continue
      }
      templates.set(language.label, text)
    }
    const [first, ...rest] = declaredLanguages
    if (!templates.has(first.label)) continue
    for (const language of rest) {
      if (!templates.has(language.label)) continue
      const firstSet = placeholders(templates.get(first.label)).sort()
      const otherSet = placeholders(templates.get(language.label)).sort()
      if (firstSet.join(',') !== otherSet.join(',')) {
        problems.push(
          `placeholder set mismatch in ${directory}: ${first.label}=[${firstSet.join(',')}] ${language.label}=[${otherSet.join(',')}]`
        )
      }
    }
  }
  return problems
}
