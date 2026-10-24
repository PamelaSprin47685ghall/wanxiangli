module Wanxiangli.RuntimeWorker

let source =
    """
import * as fs from 'node:fs';
import * as vm from 'node:vm';
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
let input = Buffer.alloc(0), ended = false, canceled, entry, context, synchronousMembers, outputBound;
const pending = new Set();
const deferredReplies = new Map();
function waitForPipe() { Atomics.wait(sleepCell, 0, 0, 1); }
function writeMessage(message) {
  const bytes = Buffer.from(JSON.stringify(message) + '\n');
  let offset = 0;
  while (offset < bytes.length) {
    try { offset += fs.writeSync(1, bytes, offset, bytes.length - offset); }
    catch (error) {
      if (error.code !== 'EAGAIN' && error.code !== 'EWOULDBLOCK') throw error;
      waitForPipe();
    }
  }
}
function readMessage() {
  for (;;) {
    const newline = input.indexOf(10);
    if (newline >= 0) {
      const line = input.subarray(0, newline).toString('utf8');
      input = input.subarray(newline + 1);
      return JSON.parse(line);
    }
    const bytes = Buffer.allocUnsafe(16384);
    let length;
    try { length = fs.readSync(0, bytes, 0, bytes.length, null); }
    catch (error) {
      if (error.code !== 'EAGAIN' && error.code !== 'EWOULDBLOCK') throw error;
      waitForPipe(); continue;
    }
    if (length === 0) throw Object.assign(new Error('The program host closed its input.'), { code: 'PROGRAM_HOST_CLOSED' });
    input = Buffer.concat([input, bytes.subarray(0, length)]);
  }
}
function failure(error) {
  const detail = error && error.__jsFailure;
  return { type: 'failed',
    code: detail && detail.code || error && error.code || (error && error.__jsAbandoned ? 'PROGRAM_ABANDONED' : 'PROGRAM_FAILED'),
    reason: detail && detail.reason || error && error.message || String(error) };
}
function terminal(message) { if (!ended) { ended = true; writeMessage(message); process.exit(0); } }
function cancelReply() { return { ok: false, code: 'PROGRAM_ABANDONED', reason: canceled || 'The program was canceled.' }; }
function acceptControl(message) {
  if (message.type !== 'cancel') return false;
  canceled = message.reason || 'The program was canceled.';
  for (const id of pending) {
    if (!deferredReplies.has(id)) deferredReplies.set(id, { type: 'reply', id, envelope: cancelReply() });
  }
  return true;
}
function deliver(message) {
  if (message.type === 'reply' && pending.delete(message.id)) entry.settle(JSON.stringify({ id: message.id, ...message.envelope }));
}
function deferReply(message) {
  if (message.type === 'reply' && pending.has(message.id) && !deferredReplies.has(message.id)) deferredReplies.set(message.id, message);
}
function bridge(text) {
  const message = JSON.parse(text);
  if (message.type === 'completed' || message.type === 'failed') {
    if (message.type === 'completed') {
      const value = JSON.stringify(message.value);
      if (value === undefined) terminal({ type: 'failed', code: 'PROGRAM_RESULT_NOT_SERIALIZABLE', reason: 'The program must return JSON data.' });
      if (Buffer.byteLength(value, 'utf8') > outputBound) terminal({ type: 'failed', code: 'RESULT_TOO_LARGE', reason: 'The program result exceeds its output bound.' });
    }
    terminal(message); return '{}';
  }
  if (message.type !== 'request') throw new Error('Invalid program message.');
  message.blocking = synchronousMembers.has(message.member) || synchronousMembers.has(message.member.split('.').at(-1));
  if (!message.blocking) { pending.add(message.id); writeMessage(message); return '{}'; }
  writeMessage(message); writeMessage({ type: 'phase', state: 'waiting' });
  for (;;) {
    const response = readMessage();
    if (acceptControl(response)) {
      writeMessage({ type: 'phase', state: 'executing' }); return JSON.stringify(cancelReply());
    }
    if (response.type === 'reply' && response.id === message.id) {
      writeMessage({ type: 'phase', state: 'executing' }); return JSON.stringify(response.envelope);
    }
    deferReply(response);
  }
}
const bootstrap = `
(function (sendText, namesText, syncText) {
  const encode = JSON.stringify, decode = JSON.parse;
  const names = decode(namesText), synchronous = new Set(decode(syncText)), waiting = new Map();
  const OwnedPromise = Promise;
  let nextId = 0;
  const api = Object.create(null);
  function sdkError(reply) {
    const error = new Error(reply.reason || reply.code || 'SDK operation failed.');
    error.code = reply.code || 'SDK_ERROR';
    error.__jsFailure = { code: error.code, reason: error.message };
    if (error.code === 'PROGRAM_ABANDONED') error.__jsAbandoned = true;
    return error;
  }
  function result(reply) { if (!reply.ok) throw sdkError(reply); return reply.value; }
  function invoke(member, args) {
    const id = ++nextId;
    const blocking = synchronous.has(member) || synchronous.has(member.split('.').at(-1));
    const request = encode({ type: 'request', id, member, args, blocking, stack: new Error().stack });
    if (blocking) return result(decode(sendText(request)));
    return new OwnedPromise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try {
        const immediate = decode(sendText(request));
        if (immediate.ok === false) { waiting.delete(id); reject(sdkError(immediate)); }
      } catch (error) { waiting.delete(id); reject(error); }
    });
  }
  for (const name of names) {
    const parts = name.split('.');
    let owner = api;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(owner, part)) owner[part] = Object.create(null);
      owner = owner[part];
    }
    Object.defineProperty(owner, parts.at(-1), { enumerable: true, value: function (...args) { return invoke(name, args); } });
  }
  function freeze(value) {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
    return Object.freeze(value);
  }
  freeze(api);
  function fail(error) {
    const detail = error && error.__jsFailure;
    sendText(encode({ type: 'failed',
      code: detail && detail.code || error && error.code || (error && error.__jsAbandoned ? 'PROGRAM_ABANDONED' : 'PROGRAM_FAILED'),
      reason: detail && detail.reason || error && error.message || String(error) }));
  }
  function finish(value) {
    try { sendText(encode({ type: 'completed', value })); }
    catch (error) { fail(Object.assign(new Error('The program result cannot be serialized.'), { code: 'PROGRAM_RESULT_NOT_SERIALIZABLE' })); }
  }
  return {
    settle(text) {
      const reply = decode(text), waiter = waiting.get(reply.id);
      if (!waiter) return;
      waiting.delete(reply.id);
      if (reply.ok) waiter.resolve(reply.value); else waiter.reject(sdkError(reply));
    },
    start(Program) { OwnedPromise.resolve().then(() => new Program(api).run()).then(finish, fail); }
  };
})(globalThis.__bridge, globalThis.__memberNames, globalThis.__syncNames)
`;
function flush() { vm.runInContext('', context); }
function observeIdle() { writeMessage({ type: 'phase', state: pending.size ? 'waiting' : 'executing' }); }
function pump() {
  if (ended) return;
  try {
    if (deferredReplies.size) {
      const [id, message] = deferredReplies.entries().next().value;
      deferredReplies.delete(id);
      writeMessage({ type: 'phase', state: 'executing' });
      deliver(message);
      flush(); observeIdle(); setImmediate(pump); return;
    }
    observeIdle();
    const message = readMessage();
    writeMessage({ type: 'phase', state: 'executing' });
    if (!acceptControl(message)) deliver(message);
    flush(); observeIdle(); setImmediate(pump);
  } catch (error) { terminal(failure(error)); }
}
try {
  const spec = readMessage();
  outputBound = spec.outputBoundBytes || 131072;
  const synchronous = ['cat','stat','ls','where','whereAll','write','mkdir','mv','rm','call','park','unpark','abandon','signal','send', ...(spec.syncMembers || [])];
  synchronousMembers = new Set(synchronous);
  context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  context.__bridge = text => {
    try { return bridge(text); }
    catch (error) { const detail = failure(error); return JSON.stringify({ ok: false, code: detail.code, reason: detail.reason }); }
  };
  context.__memberNames = JSON.stringify(spec.members); context.__syncNames = JSON.stringify(synchronous);
  entry = new vm.Script(bootstrap, { filename: 'program-members.js' }).runInContext(context);
  delete context.__bridge; delete context.__memberNames; delete context.__syncNames;
  writeMessage({ type: 'phase', state: 'executing' });
  let Program;
  try {
    Program = new vm.Script(spec.baseClass + '\n' + spec.program + '\n;if (typeof Js !== "function" || Object.getPrototypeOf(Js.prototype) !== JsProgram.prototype || typeof Js.prototype.run !== "function" || Js.prototype.run.constructor.name !== "AsyncFunction") throw new Error("Define class Js extends JsProgram with async run()."); Js', { filename: 'named-program.js' }).runInContext(context);
  } catch (error) {
    terminal({ type: 'failed', code: error && error.code || 'INVALID_PROGRAM', reason: error.message || String(error) });
  }
  entry.start(Program); flush(); observeIdle(); setImmediate(pump);
} catch (error) { terminal(failure(error)); }
"""
