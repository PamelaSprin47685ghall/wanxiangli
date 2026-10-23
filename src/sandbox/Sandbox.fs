module Wanxiangli.Sandbox.Sandbox

open Fable.Core
open Fable.Core.JsInterop

/// Independent JS sandbox runner: DONT_CONTEXTIFY context + realm membrane.
/// Host supplies api / base class / model source. Values crossing into the
/// program are copied or wrapped into the sandbox realm so
/// constructor.constructor cannot reach the real Node process. The returned
/// programPromise drains afterEvaluate microtasks under the vm timeout, so a
/// sync infinite loop after await still dies as PROGRAM_TIMEOUT.

[<ImportAll("node:vm")>]
let private vm: obj = jsNative

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
  // Capture intrinsic methods before any model code runs, and invoke them via
  // the captured Reflect.apply. The membrane shares its realm with the model
  // program (DONT_CONTEXTIFY), so a model that monkeypatches e.g.
  // WeakMap.prototype.has would otherwise see the raw host value the membrane
  // passes to that method. Holding direct references defeats later tampering.
  var ReflectApply = Reflect.apply;
  var ReflectGet = Reflect.get;
  var ReflectConstruct = Reflect.construct;
  var WeakMapHas = WeakMap.prototype.has;
  var WeakMapGet = WeakMap.prototype.get;
  var WeakMapSet = WeakMap.prototype.set;
  function mapHas(m, k) { return ReflectApply(WeakMapHas, m, [k]); }
  function mapGet(m, k) { return ReflectApply(WeakMapGet, m, [k]); }
  function mapSet(m, k, v) { ReflectApply(WeakMapSet, m, [k, v]); }
  function argsToArray(a) { var out = []; for (var i = 0; i < a.length; i++) out[i] = a[i]; return out; }
  function mapArray(arr, fn) { var out = []; for (var i = 0; i < arr.length; i++) out[i] = fn(arr[i]); return out; }
  var slot = null;
  globalThis.__put = function (v) { slot = v; };
  globalThis.__take = function () { var s = slot; slot = null; return s; };
  globalThis.__makeRunner = function (hostApi, hostDeadlineRef, hostNow, hostThen, hostKick, baseClassSource, modelSource) {
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
      return g;
    }
    function looksLikeError(v) {
      return (
        v &&
        typeof v === "object" &&
        typeof v.message === "string" &&
        (typeof v.name === "string" || v.__jsFailure || v.__jsAbandoned)
      );
    }
    function bridgeInstance(guestInst) {
      if (mapHas(guestToHost, guestInst)) return mapGet(guestToHost, guestInst);
      var proxy = new Proxy(guestInst, {
        get: function (target, prop) {
          if (prop === "constructor") return undefined;
          var v = ReflectGet(target, prop, target);
          if (typeof v !== "function") {
            if (isPrimitive(v)) return v;
            return unwrap(v);
          }
          return function () {
            var hostArgs = argsToArray(arguments);
            var guestArgs = mapArray(hostArgs, wrap);
            try {
              return unwrap(ReflectApply(v, target, guestArgs));
            } catch (e) {
              throw unwrap(e);
            } finally {
              hostKick();
            }
          };
        },
        set: function () { return false; },
        defineProperty: function () { return false; },
        deleteProperty: function () { return false; },
        getPrototypeOf: function () { return null; },
      });
      mapSet(guestToHost, guestInst, proxy);
      mapSet(hostToGuest, proxy, guestInst);
      return proxy;
    }
    function wrap(hostValue) {
      if (isPrimitive(hostValue)) return hostValue;
      if (mapHas(hostToGuest, hostValue)) return mapGet(hostToGuest, hostValue);
      if (looksLikeError(hostValue)) {
        var ge = copyError(hostValue);
        mapSet(hostToGuest, hostValue, ge);
        mapSet(guestToHost, ge, hostValue);
        return ge;
      }
      if (typeof hostValue.then === "function") {
        // hostThen subscribes with host-realm reactions, which run on the host
        // microtask queue and wake the driver; a guest-realm reaction would sit
        // in the afterEvaluate queue until something else drained it.
        var gp = new Promise(function (resolve, reject) {
          hostThen(
            hostValue,
            function (v) { resolve(wrap(v)); },
            function (e) { reject(wrap(e)); }
          );
        });
        mapSet(hostToGuest, hostValue, gp);
        mapSet(guestToHost, gp, hostValue);
        return gp;
      }
      if (typeof hostValue === "function") {
        var guestFn = function () {
          if (hostNow() > Number(hostDeadlineRef.current)) {
            var err = new Error("program exceeded its deadline");
            err.__jsFailure = { code: "PROGRAM_TIMEOUT", reason: "program exceeded its deadline" };
            throw err;
          }
          var guestArgs = argsToArray(arguments);
          var hostArgs = mapArray(guestArgs, unwrap);
          try {
            return wrap(ReflectApply(hostValue, unwrap(this), hostArgs));
          } catch (e) {
            throw wrap(e);
          }
        };
        mapSet(hostToGuest, hostValue, guestFn);
        mapSet(guestToHost, guestFn, hostValue);
        return guestFn;
      }
      if (isArray(hostValue)) {
        var ga = [];
        mapSet(hostToGuest, hostValue, ga);
        mapSet(guestToHost, ga, hostValue);
        for (var i = 0; i < hostValue.length; i++) ga[i] = wrap(hostValue[i]);
        return ga;
      }
      var go = {};
      mapSet(hostToGuest, hostValue, go);
      mapSet(guestToHost, go, hostValue);
      var names = getOwnNames(hostValue);
      for (var j = 0; j < names.length; j++) {
        var k = names[j];
        try { go[k] = wrap(hostValue[k]); } catch (_e) {}
      }
      return go;
    }
    function unwrap(guestValue) {
      if (isPrimitive(guestValue)) return guestValue;
      if (mapHas(guestToHost, guestValue)) return mapGet(guestToHost, guestValue);
      if (typeof guestValue === "function") {
        var hostFn = function () {
          var hostArgs = argsToArray(arguments);
          var guestArgs = mapArray(hostArgs, wrap);
          try {
            if (new.target) {
              var inst = ReflectConstruct(guestValue, guestArgs, guestValue);
              return bridgeInstance(inst);
            }
            return unwrap(ReflectApply(guestValue, wrap(this), guestArgs));
          } catch (e) {
            throw unwrap(e);
          } finally {
            hostKick();
          }
        };
        mapSet(guestToHost, guestValue, hostFn);
        mapSet(hostToGuest, hostFn, guestValue);
        return hostFn;
      }
      if (typeof guestValue.then === "function") {
        var hp = new Promise(function (resolve, reject) {
          guestValue.then(
            function (v) { resolve(unwrap(v)); },
            function (e) { reject(unwrap(e)); }
          );
        });
        mapSet(guestToHost, guestValue, hp);
        mapSet(hostToGuest, hp, guestValue);
        return hp;
      }
      if (isArray(guestValue)) {
        var ha = [];
        mapSet(guestToHost, guestValue, ha);
        mapSet(hostToGuest, ha, guestValue);
        for (var i2 = 0; i2 < guestValue.length; i2++) ha[i2] = unwrap(guestValue[i2]);
        return ha;
      }
      var ho = {};
      mapSet(guestToHost, guestValue, ho);
      mapSet(hostToGuest, ho, guestValue);
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
        (vm, installSource, api, deadlineMs, deadlineEpochMs, baseClassSource, modelSource)
        """
(function(vm, INSTALL, api, deadlineMs, deadlineEpochMs, baseClass, model) {
  var vmConstants = vm.constants;
  var createContext = vm.createContext;
  var runInContext = vm.runInContext;
  var IDLE_POLL_MS = 50;
  var ctx = createContext(vmConstants.DONT_CONTEXTIFY, { microtaskMode: "afterEvaluate" });
  runInContext(INSTALL, ctx, { timeout: 5000 });
  var deadlineRef = { current: Number(deadlineEpochMs) };
  var hostNow = function () { return Date.now(); };
  // Wake protocol. With microtaskMode "afterEvaluate" the program's reactions
  // only run inside runInContext, so the driver must re-enter the context
  // after anything that can enqueue them: a host promise the program awaits
  // settling (hostThen) or the host calling into program code (hostKick from
  // the membrane). Between wakes the driver sleeps instead of spinning, so an
  // idle program (parked, or awaiting a host promise) burns no CPU and does
  // not by itself keep the process alive.
  var kicked = false;
  var wake = null;
  var hostKick = function () {
    kicked = true;
    if (wake !== null) { var w = wake; wake = null; w(); }
  };
  var hostThen = function (p, onValue, onError) {
    p.then(
      function (v) { try { onValue(v); } finally { hostKick(); } },
      function (e) { try { onError(e); } finally { hostKick(); } }
    );
  };
  var put = runInContext("__put", ctx);
  put({ api: api, deadlineRef: deadlineRef, hostNow: hostNow, hostThen: hostThen, hostKick: hostKick, base: baseClass, model: model });
  var progPromise;
  try {
    progPromise = runInContext(
      "(function(){ var t = __take(); var make = __makeRunner; delete globalThis.__put; delete globalThis.__take; delete globalThis.__makeRunner; return make(t.api, t.deadlineRef, t.hostNow, t.hostThen, t.hostKick, t.base, t.model); })()",
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
      kicked = false;
      runInContext("void 0", ctx, { timeout: remaining });
      if (box.done) break;
      if (kicked) continue;
      // Idle: sleep until a wake, the (possibly reset) deadline, or a slow
      // re-poll for reactions no wake covers. The timer is unref'd: an idle
      // program is not work the process must stay alive for (the pre-membrane
      // runner did not keep it alive either); pending host work it awaits
      // holds the loop on its own.
      await new Promise(function (r) {
        var timer = null;
        wake = function () { if (timer !== null) clearTimeout(timer); r(); };
        var untilDeadline = Number(deadlineRef.current) - Date.now();
        timer = setTimeout(function () { wake = null; r(); }, Math.max(1, Math.min(IDLE_POLL_MS, untilDeadline + 1)));
        if (typeof timer.unref === "function") timer.unref();
      });
    }
    if (box.failed) throw box.error;
    return box.value;
  })();
  return { deadlineRef: deadlineRef, programPromise: driven };
})($0, $1, $2, $3, $4, $5, $6)
"""

type SandboxMessages =
    abstract run:
        api: obj * deadlineMs: float * deadlineEpochMs: float * baseClassSource: string * modelSource: string -> obj

    /// Re-arm the async deadline of a run this object started. The deadline
    /// reference stays inside the sandbox; the caller names the run by handle.
    abstract extendDeadline: handle: obj * epochMs: float -> unit

/// Realm-membrane sandbox. Each call is independent; the factory holds no state.
let Sandbox () : SandboxMessages =
    // The deadline reference of each run belongs to this sandbox instance:
    // the handle the caller holds is the only name it can use.
    let deadlines: obj = emitJsExpr (vm) "new WeakMap()"

    { new SandboxMessages with
        member _.run(api, deadlineMs, deadlineEpochMs, baseClassSource, modelSource) =
            let launched = launch api deadlineMs deadlineEpochMs baseClassSource modelSource
            let handle: obj = emitJsExpr (launched) "({ programPromise: $0.programPromise })"
            emitJsExpr (deadlines, handle, launched) "$0.set($1, $2.deadlineRef)"
            handle

        member _.extendDeadline(handle, epochMs) =
            (emitJsExpr
                (deadlines, handle, epochMs)
                """
(function(deadlines, handle, epochMs) {
  var deadlineRef = deadlines.get(handle);
  if (!deadlineRef) throw new Error("sandbox: unknown run handle");
  deadlineRef.current = Number(epochMs);
})($0, $1, $2)
""": unit)
    }
