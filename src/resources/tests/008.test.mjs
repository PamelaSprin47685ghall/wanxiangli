import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderLanguageStore, providerLanguageStore } from '../../../dist/resources/Resources.js'

test('SPEC[resources-008] ProviderLanguageStore defaults to English and resolves default ladder', () => {
  const store = new ProviderLanguageStore()
  assert.equal(store.current(), 'English')
  assert.equal(store.hostConfigPreference(), undefined)
  assert.equal(store.forSessionText('session-any'), 'English')

  const res = store.resolveLadder(null, null, null, null, null)
  assert.deepEqual(res, { ok: true, value: 'English', error: '' })
})

test('SPEC[resources-008] setHostConfigPreference injects preference and clearHostConfigPreference resets it', () => {
  const store = new ProviderLanguageStore()
  assert.equal(store.hostConfigPreference(), undefined)

  store.setHostConfigPreference('zh-CN')
  assert.equal(store.hostConfigPreference(), 'zh-CN')

  // resolveLadder without explicit hostConfig falls back to stored hostConfigPreference
  const res = store.resolveLadder(null, null, null, null, null)
  assert.deepEqual(res, { ok: true, value: 'SimplifiedChinese', error: '' })

  store.clearHostConfigPreference()
  assert.equal(store.hostConfigPreference(), undefined)
  const resCleared = store.resolveLadder(null, null, null, null, null)
  assert.deepEqual(resCleared, { ok: true, value: 'English', error: '' })

  // null raw clears
  store.setHostConfigPreference('zh-CN')
  assert.equal(store.hostConfigPreference(), 'zh-CN')
  store.setHostConfigPreference(null)
  assert.equal(store.hostConfigPreference(), undefined)
})

test('SPEC[resources-008] observation ladder priority: explicit > hostConfig > vscodeNls > posixLocale > intlLocale > English', () => {
  const store = new ProviderLanguageStore()
  store.setHostConfigPreference('zh-CN')

  // 1. Explicit env wins over host config
  const explicitEn = store.resolveLadder('en', null, 'zh-cn', 'zh_CN.UTF-8', 'zh-CN')
  assert.deepEqual(explicitEn, { ok: true, value: 'English', error: '' })

  // 2. Host config wins over vscodeNls / locales when explicit is null
  const hostZh = store.resolveLadder(null, null, 'en-US', 'en_US.UTF-8', 'en-US')
  assert.deepEqual(hostZh, { ok: true, value: 'SimplifiedChinese', error: '' })

  // When hostConfig is cleared:
  store.clearHostConfigPreference()

  // 3. vscodeNls wins when explicit and hostConfig are null
  const nlsZh = store.resolveLadder(null, null, 'zh-cn', 'en_US.UTF-8', 'en-US')
  assert.deepEqual(nlsZh, { ok: true, value: 'SimplifiedChinese', error: '' })

  // 4. posixLocale wins when vscodeNls is null
  const posixZh = store.resolveLadder(null, null, null, 'zh_CN.UTF-8', 'en-US')
  assert.deepEqual(posixZh, { ok: true, value: 'SimplifiedChinese', error: '' })

  // 5. intlLocale wins when posixLocale is null
  const intlZh = store.resolveLadder(null, null, null, null, 'zh-CN')
  assert.deepEqual(intlZh, { ok: true, value: 'SimplifiedChinese', error: '' })

  // 6. Default fallback to English
  const def = store.resolveLadder(null, null, null, null, 'en-US')
  assert.deepEqual(def, { ok: true, value: 'English', error: '' })
})

test('SPEC[resources-008] invalid language preference fails closed', () => {
  const store = new ProviderLanguageStore()
  const invalidExplicit = store.resolveLadder('klingon', null, null, null, null)
  assert.equal(invalidExplicit.ok, false)
  assert.match(invalidExplicit.error, /unrecognized/)

  store.setHostConfigPreference('valyrian')
  const invalidHost = store.resolveLadder(null, null, null, null, null)
  assert.equal(invalidHost.ok, false)
  assert.match(invalidHost.error, /unrecognized/)
})

test('SPEC[resources-008] refresh switches live language and returns external name', () => {
  const store = new ProviderLanguageStore()
  assert.equal(store.current(), 'English')

  const updated = store.refresh(() => 'zh-CN')
  assert.equal(updated, 'SimplifiedChinese')
  assert.equal(store.current(), 'SimplifiedChinese')
  assert.equal(store.forSessionText('session-x'), 'SimplifiedChinese')

  store.refresh(() => 'en')
  assert.equal(store.current(), 'English')

  assert.throws(() => store.refresh(() => 'invalid-lang'), /unrecognized/)
})

test('SPEC[resources-008] independent instances and providerLanguageStore singleton are isolated', () => {
  const custom = new ProviderLanguageStore('zh-CN')
  assert.equal(custom.current(), 'SimplifiedChinese')

  // Singleton starts at English (or whatever previous tests refreshed, reset it to English)
  providerLanguageStore.refresh(() => 'English')
  providerLanguageStore.clearHostConfigPreference()
  assert.equal(providerLanguageStore.current(), 'English')
  assert.equal(providerLanguageStore.hostConfigPreference(), undefined)

  custom.setHostConfigPreference('zh-CN')
  assert.equal(custom.hostConfigPreference(), 'zh-CN')
  assert.equal(providerLanguageStore.hostConfigPreference(), undefined)

  providerLanguageStore.setHostConfigPreference('en')
  assert.equal(providerLanguageStore.hostConfigPreference(), 'en')
  assert.equal(custom.hostConfigPreference(), 'zh-CN')

  // Clean up singleton for subsequent tests
  providerLanguageStore.clearHostConfigPreference()
  providerLanguageStore.refresh(() => 'English')
})

test('SPEC[resources-008] resolveFromObservations uses internal hostConfigPreference', () => {
  const store = new ProviderLanguageStore()
  store.setHostConfigPreference('zh-CN')
  const res = store.resolveFromObservations(null, 'en-US', 'en_US.UTF-8', 'en-US')
  assert.deepEqual(res, { ok: true, value: 'SimplifiedChinese', error: '' })
})
