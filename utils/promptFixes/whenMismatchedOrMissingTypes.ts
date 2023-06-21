import chalk from 'chalk'
import { ErrorType, ReplacementType } from '../types'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _____
//  |_   _|   _ _ __   ___  ___
//    | || | | | '_ \ / _ \/ __|
//    | || |_| | |_) |  __/\__ \
//    |_| \__, | .__/ \___||___/
//        |___/|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenMismatchedOrMissingTypes(whenContext) {
  const { problems, context, suggest, stack, sourceName, targetName } = whenContext
  if (context.captured || !problems.length) return
  const { errorType, functionName } = context
  let { addChoice } = whenContext

  const layer = stack[0]
  const { sourceInfo, targetInfo } = layer
  switch (true) {
    //
    // SIMPLE MISMATCH
    case errorType === ErrorType.mismatch: {
      const suffix = functionName ? ` in function ${functionName}()` : ''
      const source = chalk.green(sourceInfo.nodeText)
      const target = chalk.green(targetInfo.nodeText)
      addChoice = addChoice.bind(null, `Fix ${targetName} ${target} type !== ${sourceName} ${source} type${suffix}?`)
      addChoice(`Convert ${sourceName} ${source} type`, [
        { primeInfo: sourceInfo, otherInfo: targetInfo, type: ReplacementType.convertType },
      ])
      addChoice(`Union ${targetName} ${target} type`, [
        { primeInfo: targetInfo, otherInfo: sourceInfo, type: ReplacementType.unionType },
      ])
      break
    }

    //
    // MAKES NO SENSE
    case errorType === ErrorType.simpleToObject:
      if (!functionName) {
        suggest(`Did you mean to use an object`, sourceInfo.nodeLink)
      }
      break

    //
    // MAKES NO SENSE
    case errorType === ErrorType.objectToSimple:
      if (!functionName) {
        suggest(
          `Did you mean to assign just one property of ${chalk.greenBright(sourceInfo.fullText)}`,
          sourceInfo.nodeLink
        )
      }
      break

    //
    // PLACEHOLDER
    case sourceInfo.isPlaceholder: {
      const { targetMap, placeholderInfo } = context
      const targetKey = placeholderInfo.placeholderTarget ? placeholderInfo.placeholderTarget.key : sourceInfo.targetKey

      // mismatched type
      const placeholderTargetInfo = targetMap[targetKey]
      if (placeholderTargetInfo) {
        const source = chalk.green(placeholderInfo.nodeText)
        const target = chalk.green(placeholderTargetInfo.nodeText)
        placeholderInfo.type = context.cache.getType(placeholderInfo.typeId)
        placeholderTargetInfo.type = context.cache.getType(placeholderTargetInfo.typeId)
        addChoice = addChoice.bind(null, `Fix ${targetName} ${target} type !== ${sourceName} ${source}?`)
        addChoice(`Convert ${sourceName} ${source} type`, [
          { primeInfo: placeholderInfo, otherInfo: placeholderTargetInfo, type: ReplacementType.convertType },
        ])
        addChoice(`Union ${targetName} ${target} type`, [
          { primeInfo: placeholderTargetInfo, otherInfo: placeholderInfo, type: ReplacementType.unionType },
        ])
      } else {
        const targetType = context.cache.getType(placeholderInfo.placeholderTarget.typeId)
        const declarations = targetType.getSymbol()?.getDeclarations()
        const declaration = declarations[0]
        const target = chalk.green(declaration.name ? declaration.name.escapedText : 'literal')
        targetInfo.declaredId = context.cache.saveNode(declaration)
        addChoice = addChoice.bind(null, `Fix missing property?`)
        if (errorType === ErrorType.missingIndex) {
          addChoice(`Add this index to ${target} map`, [
            { primeInfo: targetInfo, otherInfo: placeholderInfo, type: ReplacementType.insertProperty },
          ])
        } else {
          addChoice(`Add optional property to ${targetName} ${target} type`, [
            { primeInfo: targetInfo, otherInfo: placeholderInfo, type: ReplacementType.insertOptionalProperty },
          ])
        }
      }
      break
    }

    //
    // SHAPE PROBLEMS
    case errorType === ErrorType.propMismatch:
      addChoice = addChoice.bind(null, `Fix mismatched property types?`)
      return addShapeChoice(`Union property types`, addChoice, whenContext)

    case errorType === ErrorType.targetPropMissing:
      addChoice = addChoice.bind(null, `Fix missing properties?`)
      return addShapeChoice(`Add properties as optional to ${targetName}`, addChoice, whenContext)

    case errorType === ErrorType.bothMissing:
      addChoice = addChoice.bind(null, `Fix missing properties??`)
      return addShapeChoice(`Add or convert properties in ${targetName} to optional `, addChoice, whenContext)

    case errorType === ErrorType.both:
      addChoice = addChoice.bind(null, `Fix missing and mismatched properties?`)
      return addShapeChoice(`Union property types and add properties as optional`, addChoice, whenContext)
  }
}

function addShapeChoice(prompt, addChoice, { problems, stack, suggest, context }) {
  const nodeInfos: any = []
  const problem = problems[0]
  const layer = stack[0]
  const { targetInfo } = layer

  // edge case
  didYouMeanThisChildProperty(suggest, context, stack)

  // fix any property type mismatches
  problem.mismatch.forEach((key) => {
    nodeInfos.push({
      primeInfo: context.sourceMap[key],
      otherInfo: context.targetMap[key],
      type: ReplacementType.unionType,
    })
  })

  // make any required target properties optional if missing in source
  problem?.reversed?.missing.forEach((key) => {
    nodeInfos.push({
      primeInfo: context.targetMap[key],
      type: ReplacementType.makeOptional,
    })
  })

  // add any missing source properties as optional target properties
  if (problem.missing.length) {
    const targetType = context.cache.getType(problem.targetInfo.typeId)
    const declarations = targetType.getSymbol()?.getDeclarations()
    const declaration = declarations[0]
    targetInfo.declaredId = context.cache.saveNode(declaration)
    problem.missing.forEach((key) => {
      nodeInfos.push({
        primeInfo: targetInfo,
        otherInfo: context.sourceMap[key],
        type: ReplacementType.insertOptionalProperty,
      })
    })
  }

  if (nodeInfos.length) {
    addChoice(prompt, nodeInfos)
  }
}

// ===============================================================================
// when you use 'resource', but you should 'resource.resource' instead %-)
// ===============================================================================

function didYouMeanThisChildProperty(suggest, context, stack) {
  if (context.sourceMap) {
    const layer = stack[stack.length - 1]
    const { sourceInfo, targetInfo } = layer
    const match: any = Object.values(context.sourceMap).find((source: any) => {
      return !source.isFunc && source.typeText === targetInfo.typeText
    })
    if (match) {
      suggest(
        `Did you mean to use this ${chalk.magenta(
          `${sourceInfo.nodeText}.${match.nodeText}`
        )} instead of this ${chalk.magenta(sourceInfo.nodeText)}`,
        targetInfo.nodeLink
      )
    }
  }
}
