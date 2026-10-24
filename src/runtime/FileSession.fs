module Wanxiangli.RuntimeFileSession

open Fable.Core
open Fable.Core.JsInterop

let private files: obj = importAll "node:fs"
let private paths: obj = importAll "node:path"

let private readText (path: string) : obj =
    match Wanxiangli.Fs.Utf8Fs.readUtf8Classified path with
    | Ok text -> createObj [ "ok" ==> true; "text" ==> text ]
    | Error failure -> Wanxiangli.Fs.Native.failureResult failure

let private commit (root: string) (mutation: obj) : obj =
    match Wanxiangli.Fs.MutationFs.commitStaged root (Wanxiangli.Fs.Transaction.mutationsOf (box [| mutation |])) with
    | Ok() -> Wanxiangli.Fs.Native.okUnit
    | Error failure -> Wanxiangli.Fs.Native.failureResult failure

[<Emit("""(function (spec, fs, path, readText, commit, resolvePath, filesystem) {
  const snapshots = new Map();
  const failure = (code, reason) => ({ ok: false, code, reason });
  function resolve(value) {
    if (typeof value !== 'string') throw Object.assign(new Error('A path must be a string.'), { code: 'INVALID_ARGUMENT' });
    return resolvePath(spec.root, value);
  }
  function canonical(absolute) {
    let current = absolute;
    const missing = [];
    for (;;) {
      try { return path.join(fs.realpathSync(current), ...missing.reverse()); }
      catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        missing.push(path.basename(current)); current = parent;
      }
    }
  }
  function guarded(operation, value, action) {
    try { return action(); }
    catch (error) {
      if (error.__jsFailure) return failure(error.__jsFailure.code, error.__jsFailure.reason);
      const code = error.code;
      if (code === 'ENOENT') return failure(operation === 'mkdir' ? 'PARENT_DIRECTORY_MISSING' : 'FILE_NOT_FOUND', 'The path does not exist: ' + value);
      if (code === 'ENOTEMPTY') return failure('DIRECTORY_NOT_EMPTY', 'The directory is not empty: ' + value);
      if (code === 'EXDEV') return failure('CROSS_DEVICE_MOVE', 'The source and destination are on different filesystems.');
      if (code === 'EEXIST' && operation === 'mkdir') return failure('DIRECTORY_EXISTS', 'The directory already exists: ' + value);
      if (code === 'ENOTDIR') return failure('PARENT_DIRECTORY_MISSING', 'A parent path is not a directory: ' + value);
      if (code === 'INVALID_ARGUMENT') return failure(code, 'The path or content has an invalid type.');
      return failure('FILE_READ_FAILED', 'The filesystem operation failed: ' + value);
    }
  }
  function before(mutation) {
    if (typeof spec.before !== 'function') return undefined;
    const token = spec.before(mutation);
    if (token && typeof token.then === 'function') throw Object.assign(new Error('File admission must be synchronous.'), {code:'ASYNC_FILE_ADMISSION'});
    return token;
  }
  function after(mutation, token) { if (typeof spec.after === 'function') spec.after(mutation, token); }
  function changed(key, text, value) {
    return snapshots.has(key) && snapshots.get(key) !== text
      ? failure('FILE_CHANGED', 'target changed since the read snapshot; no implicit retry: ' + value) : undefined;
  }
  function check(absolute, key, value) {
    if (!snapshots.has(key)) return {ok:true};
    const current = readText(absolute);
    if (!current.ok) return failure('FILE_CHANGED', 'target changed since the read snapshot; no implicit retry: ' + value);
    return changed(key, current.text, value) || current;
  }
  return {
    cat(value) {
      return guarded('cat', value, () => {
        const absolute = resolve(value), key = canonical(absolute), result = readText(absolute);
        if (!result.ok) return result;
        snapshots.set(key, result.text);
        if (typeof spec.read === 'function') spec.read(key, result.text);
        return result;
      });
    },
    write(value, text) {
      return guarded('write', value, () => {
        if (typeof text !== 'string') return failure('INVALID_ARGUMENT', 'File content must be a string.');
        const absolute = resolve(value), key = canonical(absolute);
        let physical;
        if (fs.existsSync(absolute)) {
          const current = readText(absolute);
          if (!current.ok) return current;
          const conflict = changed(key, current.text, value);
          if (conflict) return conflict;
          physical = {kind:'rewrite', path:absolute, originalText:current.text, newText:text};
        } else {
          if (snapshots.has(key)) return failure('FILE_CHANGED', 'The file was removed after its last read: ' + value);
          physical = {kind:'create', path:absolute, text};
        }
        const mutation = {...physical, path:value}, token = before(mutation), result = commit(spec.root, physical);
        if (!result.ok) return result;
        snapshots.set(canonical(absolute), text); after(mutation, token);
        return result;
      });
    },
    rm(value) {
      return guarded('remove', value, () => {
        const absolute = resolve(value), info = fs.lstatSync(absolute), key = canonical(absolute);
        const current = check(absolute, key, value); if (!current.ok) return current;
        const mutation = {kind:'remove',path:value}, token = before(mutation);
        if (info.isDirectory()) fs.rmdirSync(absolute); else fs.unlinkSync(absolute);
        if (!info.isSymbolicLink()) snapshots.delete(key);
        after(mutation, token); return {ok:true,removed:value};
      });
    },
    mv(value, destination) {
      return guarded('move', value, () => {
        const absolute=resolve(value), info=fs.lstatSync(absolute), target=resolve(destination);
        if (absolute === target) return {ok:true,moved:value,destination};
        const sourceIdentity = fs.lstatSync(absolute,{bigint:true});
        let targetIdentity;
        try { targetIdentity = fs.lstatSync(target,{bigint:true}); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (targetIdentity && sourceIdentity.ino !== 0n &&
            sourceIdentity.dev === targetIdentity.dev && sourceIdentity.ino === targetIdentity.ino) {
          return {ok:true,moved:value,destination};
        }
        const key=canonical(absolute), targetKey=canonical(target);
        const current=check(absolute,key,value); if(!current.ok)return current;
        const targetCurrent=check(target,targetKey,destination);if(!targetCurrent.ok)return targetCurrent;
        const mutation={kind:'move',path:value,destination},token=before(mutation);
        fs.renameSync(absolute,target);
        if(!info.isSymbolicLink()){
          const saved=[...snapshots].filter(([entry])=>entry===key||entry.startsWith(key+path.sep));
          const committedTargetKey=canonical(target);
          snapshots.delete(targetKey);
          for(const [entry] of saved)snapshots.delete(entry);
          for(const [entry,text] of saved)snapshots.set(committedTargetKey+entry.slice(key.length),text);
        }
        after(mutation,token);return {ok:true,moved:value,destination};
      });
    },
    mkdir(value) { return guarded('mkdir',value,()=>{fs.mkdirSync(resolve(value));return {ok:true};}); },
    stat(value) {
      return guarded('stat',value,()=>{
        try { const info=fs.statSync(resolve(value));return {ok:true,stat:{exists:true,size:info.size,mtime:info.mtime.toISOString(),isDir:info.isDirectory()}}; }
        catch(error){if(error.code==='ENOENT')return {ok:true,stat:{exists:false,size:0,mtime:null,isDir:false}};throw error;}
      });
    },
    ls(value) {
      return guarded('ls',value,()=>{
        const absolute=resolve(value===undefined?'.':value);
        fs.statSync(absolute);
        const root=canonical(spec.root), target=canonical(absolute);
        const relative=path.relative(root,target);
        const listingRoot=relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)?target:root;
        const result=filesystem.visibleEntries(listingRoot,target);
        if(!result.ok)return result;
        return {ok:true,entries:result.entries.map(entry=>entry.name+(entry.isDir?'/':''))};
      });
    }
  };
})($0, $1, $2, $3, $4, $5, $6)""")>]
let private createSession
    (_spec: obj)
    (_files: obj)
    (_paths: obj)
    (_readText: string -> obj)
    (_commit: string -> obj -> obj)
    (_resolvePath: string -> string -> string)
    (_filesystem: obj)
    : obj =
    jsNative

let FileSession (spec: obj) : obj =
    let filesystem = box (Wanxiangli.Fs.Filesystem.Filesystem spec)
    createSession spec files paths readText commit Wanxiangli.Fs.MutationFs.resolveToolPath filesystem
