import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CasebookMaintenanceLaw } from 'wanxiangli/casebook-maintenance'

const law = new CasebookMaintenanceLaw()
// Frozen from the host's own CasebookCapture.computeMaintenanceDiff (wanxiangshu master 1c43198b5 dist),
// generated from the host's own diff output.
const golden = JSON.parse(readFileSync(new URL('./fixtures/host-diffs.json', import.meta.url), 'utf8'))

// Zero-context unified-diff applier, written independently of the law: proves the diff really maps B to T.
function apply(before, diff) {
  if (diff === '') return before
  const lines = diff.split(/(?<=\n)/)
  let index = 0
  const header = lines[index++]
  assert.match(header, /^diff --git a\/(.+) b\/\1\n$/)
  const deleted = lines[index] === 'deleted file\n'
  if (lines[index] === 'new file\n') { assert.equal(before, null); index += 1 }
  else if (deleted) { assert.notEqual(before, null); index += 1 }
  index += 2 // --- / +++
  const old = (before ?? '').split(/(?<=\n)/).filter(Boolean)
  const out = []
  let cursor = 0
  while (index < lines.length) {
    const hunk = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@\n$/.exec(lines[index++])
    assert.ok(hunk, 'hunk header')
    const [oldStart, removed, , added] = hunk.slice(1).map(Number)
    const from = removed === 0 ? oldStart : oldStart - 1
    out.push(...old.slice(cursor, from))
    const take = sign => {
      let text = lines[index++]
      assert.equal(text[0], sign)
      text = text.slice(1)
      if (lines[index] === '\\ No newline at end of file\n') { index += 1; text = text.slice(0, -1) }
      return text
    }
    for (let k = 0; k < removed; k += 1) assert.equal(take('-'), old[from + k])
    for (let k = 0; k < added; k += 1) out.push(take('+'))
    cursor = from + removed
  }
  out.push(...old.slice(cursor))
  if (deleted) { assert.equal(out.join(''), '', 'a delete removes every line'); return null }
  return out.join('')
}

test('SPEC[casebook-maintenance-1] file diffs equal the frozen host vectors byte for byte', () => {
  assert.equal(golden.length, 400)
  let changed = 0
  for (const { files, diffSummary } of golden) {
    const diffs = files.map(([path, before, after]) => law.fileDiff(path, before, after))
    const summary = law.summarize(diffs)
    assert.equal(summary.diffSummary, diffSummary, JSON.stringify(files))
    assert.equal(summary.refresh, diffSummary !== '')
    if (summary.refresh) changed += 1
  }
  assert.ok(changed > 200 && changed < 400, `both verdicts covered (${changed})`)
})

test('SPEC[casebook-maintenance-1] every diff maps B to T and no-change is the empty diff', () => {
  for (const { files } of golden) {
    for (const [path, before, after] of files) {
      const diff = law.fileDiff(path, before, after)
      if (before === after) { assert.equal(diff, ''); continue }
      assert.notEqual(diff, '', 'a real change must produce a diff')
      assert.equal(apply(before, diff), after, JSON.stringify([before, after, diff]))
    }
  }
  assert.equal(law.fileDiff('x', null, null), '')
  assert.equal(law.fileDiff('x', 'same\n', 'same\n'), '')
})

test('SPEC[casebook-maintenance-1] Missing↔Present are add and delete diffs, empty Present is not Missing', () => {
  assert.equal(law.fileDiff('n.txt', null, 'a\n'), 'diff --git a/n.txt b/n.txt\nnew file\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+a\n')
  assert.equal(law.fileDiff('d.txt', 'a', null), 'diff --git a/d.txt b/d.txt\ndeleted file\n--- a/d.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n\\ No newline at end of file\n')
  assert.equal(law.fileDiff('e.txt', null, ''), 'diff --git a/e.txt b/e.txt\nnew file\n--- /dev/null\n+++ b/e.txt\n')
  assert.equal(law.summarize([law.fileDiff('e.txt', '', null)]).refresh, true)
  assert.throws(() => law.fileDiff('x', undefined, 'a'))
  assert.throws(() => law.fileDiff(1, 'a', 'b'))
  assert.throws(() => law.summarize('not an array'))
})

test('SPEC[casebook-maintenance-2] only ENOENT is Missing; every other read failure is a fault', () => {
  assert.equal(law.readFailure('ENOENT'), 'missing')
  for (const code of ['EACCES', 'EISDIR', 'EIO', 'EMFILE', '', null, undefined, 2, 'enoent']) assert.equal(law.readFailure(code), 'fault', String(code))
})

test('SPEC[casebook-maintenance-3] truncation stays within budget, keeps head and tail and never splits a code point', () => {
  const text = 'HEAD\n' + 'x'.repeat(500) + '\nTAIL'
  const short = law.truncate(text, 100)
  assert.equal(short.isTruncated, true)
  assert.ok(short.text.length <= 100)
  assert.ok(short.text.startsWith('HEAD\n') && short.text.endsWith('\nTAIL'))
  assert.match(short.text, /截断/)
  assert.deepEqual(law.truncate(text, text.length), { text, isTruncated: false, notice: '' })
  for (let budget = 40; budget < 80; budget += 1) {
    const emoji = law.truncate('😀'.repeat(60), budget)
    assert.equal(emoji.text.isWellFormed(), true, `budget ${budget}`)
    assert.ok(emoji.text.length <= budget)
  }
  assert.throws(() => law.truncate(text, 1.5))
})
