import test from 'node:test'
import assert from 'node:assert/strict'
import {
  InstalledResourceSlot,
  runtimeResourcesSlot,
  providerResourcesSlot,
  proseResourcesSlot
} from '../../../dist/resources/Resources.js'

test('SPEC[resources-slot-1] uninstalled slot require() throws exact missingErrorMessage', () => {
  const slot = new InstalledResourceSlot('Custom resource not installed; setup required')
  assert.equal(slot.isInstalled(), false)
  assert.equal(slot.tryGet(), undefined)
  assert.throws(
    () => slot.require(),
    (err) => {
      assert.equal(err.message, 'Custom resource not installed; setup required')
      return true
    }
  )
})

test('SPEC[resources-slot-2] preset slots throw exact missing error messages when uninstalled', () => {
  // Ensure preset slots are cleared to test uninstalled state
  runtimeResourcesSlot.clear()
  providerResourcesSlot.clear()
  proseResourcesSlot.clear()

  assert.equal(runtimeResourcesSlot.isInstalled(), false)
  assert.throws(
    () => runtimeResourcesSlot.require(),
    (err) => {
      assert.equal(
        err.message,
        'RuntimeResources not installed; call RuntimeResources.install (RuntimeResources.load ()) at plugin init'
      )
      return true
    }
  )

  assert.equal(providerResourcesSlot.isInstalled(), false)
  assert.throws(
    () => providerResourcesSlot.require(),
    (err) => {
      assert.equal(err.message, 'ProviderResources not installed')
      return true
    }
  )

  assert.equal(proseResourcesSlot.isInstalled(), false)
  assert.throws(
    () => proseResourcesSlot.require(),
    (err) => {
      assert.equal(err.message, 'ProviderProse not installed')
      return true
    }
  )
})

test('SPEC[resources-slot-3] install makes require and tryGet return original object', () => {
  const slot = new InstalledResourceSlot('missing')
  const payload = { id: 'test-resource', catalog: { key: 'value' }, count: 42 }

  slot.install(payload)

  assert.equal(slot.isInstalled(), true)
  assert.strictEqual(slot.require(), payload)
  assert.strictEqual(slot.tryGet(), payload)
})

test('SPEC[resources-slot-4] repeated install overwrites and updates value', () => {
  const slot = new InstalledResourceSlot('missing')
  const initial = { version: 1 }
  const updated = { version: 2 }

  slot.install(initial)
  assert.strictEqual(slot.require(), initial)
  assert.strictEqual(slot.tryGet(), initial)

  slot.install(updated)
  assert.strictEqual(slot.require(), updated)
  assert.strictEqual(slot.tryGet(), updated)
})

test('SPEC[resources-slot-5] clear resets slot to uninstalled state', () => {
  const slot = new InstalledResourceSlot('slot cleared')
  slot.install({ active: true })
  assert.equal(slot.isInstalled(), true)

  slot.clear()

  assert.equal(slot.isInstalled(), false)
  assert.equal(slot.tryGet(), undefined)
  assert.throws(
    () => slot.require(),
    (err) => {
      assert.equal(err.message, 'slot cleared')
      return true
    }
  )

  // clear is idempotent
  slot.clear()
  assert.equal(slot.isInstalled(), false)
})

test('SPEC[resources-slot-6] multiple slot instances are completely isolated and do not interfere', () => {
  const slotA = new InstalledResourceSlot('slot A missing')
  const slotB = new InstalledResourceSlot('slot B missing')

  const valA = { name: 'A' }
  const valB = { name: 'B' }

  slotA.install(valA)
  assert.equal(slotA.isInstalled(), true)
  assert.equal(slotB.isInstalled(), false)
  assert.throws(() => slotB.require(), /slot A missing/ ? /slot B missing/ : false)

  slotB.install(valB)
  assert.equal(slotA.isInstalled(), true)
  assert.equal(slotB.isInstalled(), true)
  assert.strictEqual(slotA.require(), valA)
  assert.strictEqual(slotB.require(), valB)

  slotA.clear()
  assert.equal(slotA.isInstalled(), false)
  assert.equal(slotB.isInstalled(), true)
  assert.strictEqual(slotB.require(), valB)
  assert.throws(() => slotA.require(), /slot A missing/)
})
