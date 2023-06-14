/* Copyright Contributors to the Open Cluster Management project */

import path from 'path'
import ts from 'typescript'
import { findProblems } from './findProblems'
import { getClosestTarget, getNodeLink } from './utils'
import { showProblemTables, showTableNotes } from './showTables'
import { applyFixes, showPromptFixes } from './promptFixes/showFixes'
import { cacheFile } from './cacheFile'
import { IFileCache } from './types'

let options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.CommonJS,
}
let checker: ts.TypeChecker
let isVerbose = false

// errors we ignore
const ignoreTheseErrors = [6133, 2304, 2448, 2454]

//======================================================================
//======================================================================
//======================================================================
//   ____        _  __  __ _
//  / ___| _ __ (_)/ _|/ _(_)_ __   __ _
//  \___ \| '_ \| | |_| |_| | '_ \ / _` |
//   ___) | | | | |  _|  _| | | | | (_| |
//  |____/|_| |_|_|_| |_| |_|_| |_|\__, |
//                                 |___/
//======================================================================
//======================================================================
//======================================================================

export function startSniffing(fileNames: string | any[] | readonly string[], verbose: boolean) {
  // Read tsconfig.json file
  if (Array.isArray(fileNames) && fileNames.length > 0) {
    const tsconfigPath = ts.findConfigFile(fileNames[0], ts.sys.fileExists, 'tsconfig.json')
    if (tsconfigPath) {
      const tsconfigFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
      options = ts.parseJsonConfigFileContent(tsconfigFile.config, ts.sys, path.dirname(tsconfigPath)).options
    } else {
      options = {
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
      }
    }
    isVerbose = verbose
    //options.isolatedModules = false
    console.log('starting...')
    const program = ts.createProgram(fileNames, options)
    checker = program.getTypeChecker()
    const syntactic = program.getSyntacticDiagnostics()
    if (syntactic.length) {
      console.log('Warning: there are syntax errors.')
    }
    console.log('looking...')
    startFixing(program.getSemanticDiagnostics(), fileNames)
  } else {
    console.log('No files specified.')
  }
}

//======================================================================
//======================================================================
//======================================================================
//   _____ _      _
//  |  ___(_)_  _(_)_ __   __ _
//  | |_  | \ \/ / | '_ \ / _` |
//  |  _| | |>  <| | | | | (_| |
//  |_|   |_/_/\_\_|_| |_|\__, |
//                        |___/
//======================================================================
//======================================================================
//======================================================================
async function startFixing(semanticDiagnostics: readonly ts.Diagnostic[], fileNames: string[]) {
  let hadProblem = false
  let anyProblem = false
  const fileCache = {}
  const missingSupport: string[] = []
  const processedNodes = new Set()
  console.log('\n\n')

  const programContext = {
    fileCache,
    options,
    checker,
    isVerbose,
  }

  let allProblems: { problems: any[]; stack: any[]; context: any }[] = []
  semanticDiagnostics.forEach(({ code: errorCode, file, start }) => {
    if (file && fileNames.includes(file.fileName)) {
      const fileName = file.fileName
      let cache = fileCache[fileName]
      if (!cache) {
        cache = fileCache[fileName] = cacheFile(file)
      }
      if (start) {
        let errorNode = cache.startToNode[start]
        if (errorNode) {
          if (!ignoreTheseErrors.includes(errorCode)) {
            hadProblem = false
            const closestTargetNode = getClosestTarget(checker, errorNode)
            const problemBeg = closestTargetNode.getStart()
            // compiler might throw multiple errors for the same problem -- only process one of them
            if (!processedNodes.has(problemBeg)) {
              const problems = findProblems(programContext, errorCode, errorNode, closestTargetNode, problemBeg, cache)
              if (problems.length) {
                allProblems = [...allProblems, ...problems]
                processedNodes.add(problemBeg)
                hadProblem = true
              } else {
                missingSupport.push(
                  `For error ${errorCode}, missing support ${ts.SyntaxKind[closestTargetNode.kind]} ${problemBeg}`
                )
                missingSupport.push(`${getNodeLink(closestTargetNode)}\n`)
              }
            }
          }
          anyProblem = anyProblem || hadProblem
        }
      }
    }
  })

  // show problems, prompt for fixes
  let anyQuit = false
  for (const problem of allProblems) {
    const { problems, stack, context } = problem
    showProblemTables(problems, context, stack)
    showTableNotes(problems, context)
    anyQuit = await showPromptFixes(problems, context, stack)
    console.log('\n\n')
    if (anyQuit) {
      break
    }
  }
  if (anyQuit) return

  // apply fixes, save files
  if (anyProblem) {
    await applyFixes(fileCache)
  }

  // show things we didn't know how to process
  if (missingSupport.length > 0) {
    missingSupport.forEach((miss) => console.log(miss))
  } else if (!anyProblem) {
    console.log(`\n--no squirrels--`)
  }
  console.log('\n\n--------------------------------------------------------------------------')
}
