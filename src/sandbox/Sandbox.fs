module Wanxiangli.Sandbox.Sandbox

open Fable.Core
open Fable.Core.JsInterop

/// Independent JS sandbox runner: DONT_CONTEXTIFY context + realm membrane.
/// Host supplies api / base class / model source. Values crossing into the
/// program are copied or wrapped into the sandbox realm so
/// constructor.constructor cannot reach the real Node process. The returned
/// programPromise drains afterEvaluate microtasks under the vm timeout, so a
/// sync infinite loop after await still dies as PROGRAM_TIMEOUT.

[<Import("createContext", "node:vm")>]
let private createContext (sandbox: obj) (options: obj) : obj = jsNative

[<Import("runInContext", "node:vm")>]
let private runInContext (code: string) (context: obj) (options: obj) : obj = jsNative

[<Import("constants", "node:vm")>]
let private vmConstants: obj = jsNative

let private installSource =
    """
(function () {
  "use strict";
  var Object = globalThis.Object;
  var Array = globalThis.Array;
  var Promise = globalThis.Promise;
  var Error = globalThis.Error;
  var Proxy = globalThis.Proxy;
  var Reflect = globalThis.Reflect;
  var WeakMap = globalThis.WeakMap;
  var String = globalThis.String;
  var JSON = globalThis.JSON;
  var isArray = Array.isArray;
  var getOwnNames = Object.getOwnPropertyNames;
  var slot = null;
  globalThis.__put = function (v) { slot = v; };
  globalThis.__take = function () { var s = slot; slot = null; return s; };
  globalThis.__makeRunner = function (hostApi, hostDeadlineRef, hostNow, baseClassSource, modelSource) {
    var hostToGuest = new WeakMap();
    var guestToHost = new WeakMap();
    function isPrimitive(v) {
      return v === null || (typeof v !== "object" && typeof v !== "function");
    }
    function copyError(hostErr) {
      var g = new Error(String(hostErr && hostErr.message != null ? hostErr.message : hostErr));
      if (hostErr && typeof hostErr.name === "string") g.name = hostErr.name;
      if (hostErr && hostErr.__jsFailure && typeof hostErr.__jsFailure === "object") {
        g.__jsFailure = {
          code: String(hostErr.__jsFailure.code || ""),
          reason: String(hostErr.__jsFailure.reason || hostErr.__jsFailure.code || ""),
        };
      }
      if (hostErr && hostErr.__jsAbandoned) g.__jsAbandoned = true;
      if (hostErr && hostErr.__jsDelivered) g.__jsDelivered = wrap(hostErr.__jsDelivered);
      return g;
    }
    function looksLikeError(v) {
      return (
        v &&
        typeof v === "object" &&
        typeof v.message === "string" &&
        (typeof v.name === "string" || v.__jsFailure || v.__jsAbandoned || v.__jsDelivered)
      );
    }
    function bridgeInstance(guestInst) {
      if (guestToHost.has(guestInst)) return guestToHost.get(guestInst);
      var proxy = new Proxy(guestInst, {
        get: function (target, prop) {
          if (prop === "constructor") return undefined;
          var v = Reflect.get(target, prop, target);
          if (typeof v !== "function") {
            if (isPrimitive(v)) return v;
            return unwrap(v);
          }
          return function () {
            var hostArgs = Array.prototype.slice.call(arguments);
            var guestArgs = hostArgs.map(wrap);
            try {
              return unwrap(Reflect.apply(v, target, guestArgs));
            } catch (e) {
              throw unwrap(e);
            }
          };
        },
        set: function () { return false; },
        defineProperty: function () { return false; },
        deleteProperty: function () { return false; },
        getPrototypeOf: function () { return null; },
      });
      guestToHost.set(guestInst, proxy);
      hostToGuest.set(proxy, guestInst);
      return proxy;
    }
    function wrap(hostValue) {
      if (isPrimitive(hostValue)) return hostValue;
      if (hostToGuest.has(hostValue)) return hostToGuest.get(hostValue);
      if (looksLikeError(hostValue)) {
        var ge = copyError(hostValue);
        hostToGuest.set(hostValue, ge);
        guestToHost.set(ge, hostValue);
        return ge;
      }
      if (typeof hostValue.then === "function") {
        var gp = new Promise(function (resolve, reject) {
          hostValue.then(
            function (v) { resolve(wrap(v)); },
            function (e) { reject(wrap(e)); }
          );
        });
        hostToGuest.set(hostValue, gp);
        guestToHost.set(gp, hostValue);
        return gp;
      }
      if (typeof hostValue === "function") {
        var guestFn = function () {
          if (hostNow() > Number(hostDeadlineRef.current)) {
            var err = new Error("program exceeded its deadline");
            err.__jsFailure = { code: "PROGRAM_TIMEOUT", reason: "program exceeded its deadline" };
            throw err;
          }
          var guestArgs = Array.prototype.slice.call(arguments);
          var hostArgs = guestArgs.map(unwrap);
          try {
            return wrap(Reflect.apply(hostValue, unwrap(this), hostArgs));
          } catch (e) {
            throw wrap(e);
          }
        };
        hostToGuest.set(hostValue, guestFn);
        guestToHost.set(guestFn, hostValue);
        return guestFn;
      }
      if (isArray(hostValue)) {
        var ga = [];
        hostToGuest.set(hostValue, ga);
        guestToHost.set(ga, hostValue);
        for (var i = 0; i < hostValue.length; i++) ga[i] = wrap(hostValue[i]);
        return ga;
      }
      var go = {};
      hostToGuest.set(hostValue, go);
      guestToHost.set(go, hostValue);
      var names = getOwnNames(hostValue);
      for (var j = 0; j < names.length; j++) {
        var k = names[j];
        try { go[k] = wrap(hostValue[k]); } catch (_e) {}
      }
      return go;
    }
    function unwrap(guestValue) {
      if (isPrimitive(guestValue)) return guestValue;
      if (guestToHost.has(guestValue)) return guestToHost.get(guestValue);
      if (typeof guestValue === "function") {
        var hostFn = function () {
          var hostArgs = Array.prototype.slice.call(arguments);
          var guestArgs = hostArgs.map(wrap);
          try {
            if (new.target) {
              var inst = Reflect.construct(guestValue, guestArgs, guestValue);
              return bridgeInstance(inst);
            }
            return unwrap(Reflect.apply(guestValue, wrap(this), guestArgs));
          } catch (e) {
            throw unwrap(e);
          }
        };
        guestToHost.set(guestValue, hostFn);
        hostToGuest.set(hostFn, guestValue);
        return hostFn;
      }
      if (typeof guestValue.then === "function") {
        var hp = new Promise(function (resolve, reject) {
          guestValue.then(
            function (v) { resolve(unwrap(v)); },
            function (e) { reject(unwrap(e)); }
          );
        });
        guestToHost.set(guestValue, hp);
        hostToGuest.set(hp, guestValue);
        return hp;
      }
      if (isArray(guestValue)) {
        var ha = [];
        guestToHost.set(guestValue, ha);
        hostToGuest.set(ha, guestValue);
        for (var i2 = 0; i2 < guestValue.length; i2++) ha[i2] = unwrap(guestValue[i2]);
        return ha;
      }
      var ho = {};
      guestToHost.set(guestValue, ho);
      hostToGuest.set(ho, guestValue);
      var gnames = getOwnNames(guestValue);
      for (var j2 = 0; j2 < gnames.length; j2++) {
        var gk = gnames[j2];
        try { ho[gk] = unwrap(guestValue[gk]); } catch (_e2) {}
      }
      return ho;
    }
    var api = wrap(hostApi);
    var body =
      "(async () => {\n" +
      baseClassSource +
      "\n" +
      modelSource +
      "\n" +
      "let __result;\n" +
      "try { __result = await new Js(api).run(); }\n" +
      "catch (__e) {\n" +
      "  if (__e && __e.__jsFailure && typeof __e.__jsFailure.code === 'string') {\n" +
      "    return JSON.stringify({\n" +
      "      __jsHostFailed: true,\n" +
      "      code: __e.__jsFailure.code,\n" +
      "      reason: String(__e.__jsFailure.reason || __e.__jsFailure.code)\n" +
      "    });\n" +
      "  }\n" +
      "  if (__e && __e.__jsAbandoned) {\n" +
      "    return JSON.stringify({ __jsAbandoned: true });\n" +
      "  }\n" +
      "  if (__e && __e.__jsDelivered) {\n" +
      "    return JSON.stringify({ __jsDelivered: true, view: __e.__jsDelivered.view });\n" +
      "  }\n" +
      "  return JSON.stringify({ __jsProgramFailed: true, message: String((__e && __e.message) || __e) });\n" +
      "}\n" +
      "try {\n" +
      "  const __json = JSON.stringify(__result);\n" +
      "  return typeof __json === 'string' ? __json : JSON.stringify({ __jsInvalidReturn: true });\n" +
      "}\n" +
      "catch (__e2) { return JSON.stringify({ __jsInvalidReturn: true }); }\n" +
      "})()";
    var runBody = new Function("api", "JSON", "return (" + body + ");");
    return runBody(api, JSON);
  };
})();
"""

let private launch
    (api: obj)
    (deadlineMs: float)
    (deadlineEpochMs: float)
    (baseClassSource: string)
    (modelSource: string)
    : obj =
    emitJsExpr
        (vmConstants, createContext, runInContext, installSource, api, deadlineMs, deadlineEpochMs, baseClassSource, modelSource)
        """
(function(vmConstants, createContext, runInContext, INSTALL, api, deadlineMs, deadlineEpochMs, baseClass, model) {
  var ctx = createContext(vmConstants.DONT_CONTEXTIFY, { microtaskMode: "afterEvaluate" });
  runInContext(INSTALL, ctx, { timeout: 5000 });
  var deadlineRef = { current: Number(deadlineEpochMs) };
  var hostNow = function () { return Date.now(); };
  var put = runInContext("__put", ctx);
  put({ api: api, deadlineRef: deadlineRef, hostNow: hostNow, base: baseClass, model: model });
  var progPromise;
  try {
    progPromise = runInContext(
      "(function(){ var t = __take(); var make = __makeRunner; delete globalThis.__put; delete globalThis.__take; delete globalThis.__makeRunner; return make(t.api, t.deadlineRef, t.hostNow, t.base, t.model); })()",
      ctx,
      { timeout: Number(deadlineMs) }
    );
  } catch (e) {
    return { deadlineRef: deadlineRef, programPromise: Promise.reject(e) };
  }
  var box = { done: false, value: null, error: null, failed: false };
  var register = runInContext(
    "(function(p, box){ Promise.resolve(p).then(function(v){ box.done = true; box.value = v; }, function(e){ box.done = true; box.failed = true; box.error = e; }); })",
    ctx
  );
  register(progPromise, box);
  var driven = (async function () {
    while (!box.done) {
      var now = Date.now();
      var deadlineNow = Number(deadlineRef.current);
      if (now > deadlineNow) {
        var err = new Error("Script execution timed out");
        err.code = "ERR_SCRIPT_EXECUTION_TIMEOUT";
        throw err;
      }
      var remaining = Math.max(1, Math.min(Number(deadlineMs), deadlineNow - now));
      try {
        runInContext("void 0", ctx, { timeout: remaining });
      } catch (e2) {
        if (e2 && e2.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") throw e2;
        throw e2;
      }
      if (box.done) break;
      await new Promise(function (r) { setImmediate(r); });
    }
    if (box.failed) throw box.error;
    return box.value;
  })();
  return { deadlineRef: deadlineRef, programPromise: driven };
})($0, $1, $2, $3, $4, $5, $6, $7, $8)
"""

/// Naive pre-membrane runner used only by library base-red tests.
let private launchNaive
    (api: obj)
    (deadlineMs: float)
    (baseClassSource: string)
    (modelSource: string)
    : obj =
    emitJsExpr
        (createContext, runInContext, api, deadlineMs, baseClassSource, modelSource)
        """
(function(createContext, runInContext, api, deadlineMs, baseClass, model) {
  var deadlineRef = { current: Date.now() + 60000 };
  var ctx = createContext({ api: api, __deadlineRef: deadlineRef });
  var code =
    "(async () => {\n" + baseClass + "\n" + model + "\n" +
    "const __wrap = (target) => new Proxy(target, { get(target, prop) { const value = target[prop]; if (typeof value === 'function') return (...args) => value(...args); if (value && typeof value === 'object') return __wrap(value); return value; } });\n" +
    "const __api = __wrap(api);\n" +
    "let __result;\n" +
    "try { __result = await new Js(__api).run(); }\n" +
    "catch (__e) { return JSON.stringify({ __jsProgramFailed: true, message: String((__e && __e.message) || __e) }); }\n" +
    "return JSON.stringify(__result);\n" +
    "})()";
  try {
    return { programPromise: runInContext(code, ctx, { timeout: Number(deadlineMs) }), deadlineRef: deadlineRef };
  } catch (e) {
    return { programPromise: Promise.reject(e), deadlineRef: deadlineRef };
  }
})($0, $1, $2, $3, $4, $5)
"""

type SandboxMessages =
    abstract run: api: obj * deadlineMs: float * deadlineEpochMs: float * baseClassSource: string * modelSource: string -> obj
    abstract runNaive: api: obj * deadlineMs: float * baseClassSource: string * modelSource: string -> obj
    abstract resetDeadline: deadlineRef: obj * epochMs: float -> unit

/// Realm-membrane sandbox. Each call is independent; the factory holds no state.
let Sandbox () : SandboxMessages =
    { new SandboxMessages with
        member _.run(api, deadlineMs, deadlineEpochMs, baseClassSource, modelSource) =
            launch api deadlineMs deadlineEpochMs baseClassSource modelSource

        member _.runNaive(api, deadlineMs, baseClassSource, modelSource) =
            launchNaive api deadlineMs baseClassSource modelSource

        member _.resetDeadline(deadlineRef, epochMs) =
            emitJsExpr (deadlineRef, epochMs) "$0.current = Number($1)" |> ignore }
