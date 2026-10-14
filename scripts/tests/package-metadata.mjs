export function packedPackage(stdout, name = 'wanxiangli') {
  const parsed = JSON.parse(stdout)
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error('npm pack returned an unexpected package count')
    return parsed[0]
  }
  if (parsed && typeof parsed === 'object' && parsed[name]) return parsed[name]
  throw new Error('npm pack returned an unsupported JSON shape')
}
