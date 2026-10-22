// Naive pre-membrane runner: a plain-JS fixture of the pre-membrane runner the
// library used to ship. It creates a contextified vm context (no
// DONT_CONTEXTIFY), puts the host api and the deadline reference on the
// context global, and wraps the api in a shallow Proxy. It exists only so the
// base-red tests can prove the membrane denies what the naive runner allows.
// It is not part of the production surface.
import vm from 'node:vm'

export function runNaive(api, deadlineMs, baseClassSource, modelSource) {
  const deadlineRef = { current: Date.now() + 60000 }
  const ctx = vm.createContext({ api, __deadlineRef: deadlineRef })
  const code =
    '(async () => {\n' + baseClassSource + '\n' + modelSource + '\n' +
    "const __wrap = (target) => new Proxy(target, { get(target, prop) { const value = target[prop]; if (typeof value === 'function') return (...args) => value(...args); if (value && typeof value === 'object') return __wrap(value); return value; } });\n" +
    'const __api = __wrap(api);\n' +
    'let __result;\n' +
    'try { __result = await new Js(__api).run(); }\n' +
    "catch (__e) { return JSON.stringify({ __jsProgramFailed: true, message: String((__e && __e.message) || __e) }); }\n" +
    'return JSON.stringify(__result);\n' +
    '})()'
  try {
    return { programPromise: vm.runInContext(code, ctx, { timeout: Number(deadlineMs) }), deadlineRef }
  } catch (e) {
    return { programPromise: Promise.reject(e), deadlineRef }
  }
}
