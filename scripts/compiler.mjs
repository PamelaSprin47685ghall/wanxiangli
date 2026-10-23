import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startAsPromise } from '@fable-org/fable-library-js/Async.js'
import { ofArray } from '@fable-org/fable-library-js/Set.js'
import { comparePrimitives } from '@fable-org/fable-library-js/Util.js'

const normalize = value => path.resolve(value).replaceAll('\\', '/')

export async function createCompiler(libDir) {
  // 此版本的模块导入会执行 CLI 入口，先阻止它读取构建脚本的参数。
  const argv = process.argv
  let compiler
  try {
    process.argv = [process.execPath, 'fable', '--version']
    compiler = await import('@fable-org/fable-compiler-js/dist/app.min.js')
  } finally {
    process.argv = argv
  }
  const manager = compiler.initFable()
  const checkers = new Map()

  function checkerFor(references, reader, options) {
    const assemblies = new Map(references.map(reference => {
      const name = reference.endsWith('.dll') ? reference : `${reference}.dll`
      return [name, reader(name)]
    }))
    const hashes = [...assemblies].map(([name, bytes]) =>
      [name, createHash('sha256').update(bytes).digest('hex')])
    const key = JSON.stringify([references, options, hashes])
    if (!checkers.has(key)) {
      checkers.set(key, manager.CreateChecker(references, name => {
        if (!assemblies.has(name)) throw new Error(`Unknown assembly: ${name}`)
        return assemblies.get(name)
      }, options))
    }
    return checkers.get(key)
  }

  return {
    async compile(project, outDir) {
      const options = {
        outDir: normalize(outDir), libDir: normalize(libDir), benchmark: true,
        optimize: false, sourceMaps: false, typedArrays: undefined,
        language: 'JavaScript', printAst: false,
      }
      let parsed
      const init = globalThis.__FABLE_STANDALONE__.init
      try {
        // 仍用 Fable 读取工程及编译选项；benchmark 仅关闭其不返回 Promise 的输出循环。
        globalThis.__FABLE_STANDALONE__.init = () => ({
          ...manager,
          CreateChecker: checkerFor,
          ParseAndCheckProject(checker, projectFile, files, sources, ...rest) {
            manager.ClearCache(checker)
            const result = manager.ParseAndCheckProject(checker, projectFile, files, sources, ...rest)
            parsed = { result, files }
            return result
          },
        })
        compiler.parseFiles(normalize(project), options)
      } finally {
        globalThis.__FABLE_STANDALONE__.init = init
      }
      compiler.printErrors(true, parsed.result.Errors)

      const projectDir = path.dirname(normalize(project))
      const directories = new Map()
      const deduplicate = (directory, addTarget) => {
        const key = normalize(directory).toLocaleLowerCase()
        if (!directories.has(key)) {
          directories.set(key, addTarget(ofArray([...directories.values()], { Compare: comparePrimitives })))
        }
        return directories.get(key)
      }
      for (const file of parsed.files.filter(file => !file.endsWith('.fsi'))) {
        const started = performance.now()
        const result = manager.CompileToTargetAst(options.libDir, parsed.result, file, options.typedArrays, options.language)
        console.log(`File: ${file}, Fable time: ${Math.round(performance.now() - started)} ms`)
        compiler.printErrors(true, result.FableErrors)
        const target = compiler.Imports_getTargetAbsolutePath(deduplicate, file, projectDir, options.outDir)
          .replace(/\.[^/.]+$/, '.js')
        const writer = new compiler.SourceWriter(file, target, projectDir, options, '.js', deduplicate)
        await startAsPromise(manager.PrintTargetAst(result, writer))
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, compiler.SourceWriter__get_Result(writer))
      }
    },
  }
}
