import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

export function remainingReadSource(relativePath, metaUrl) {
  return readFileSync(new URL(relativePath, metaUrl), 'utf8')
}

export function remainingSourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `缺少源码标记: ${startMarker}`)
  if (endMarker == null) return source.slice(start)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `缺少源码标记: ${endMarker}`)
  return source.slice(start, end)
}

export function remainingImportedFunctionSource(...values) {
  return values.map((value) => {
    if (typeof value === 'function') return Function.prototype.toString.call(value)
    return String(value ?? '')
  }).join('\n')
}

export function remainingExtractNamedFunction(source, name) {
  const asyncMarker = `async function ${name}`
  const syncMarker = `function ${name}`
  const start = source.indexOf(asyncMarker) >= 0
    ? source.indexOf(asyncMarker)
    : source.indexOf(syncMarker)
  assert.ok(start >= 0, `缺少函数 ${name}`)
  let parenthesisDepth = 0
  let bodyStart = -1
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    if (source[index] === '(') parenthesisDepth += 1
    if (source[index] === ')') parenthesisDepth -= 1
    if (parenthesisDepth === 0 && source[index] === '{') {
      bodyStart = index
      break
    }
  }
  assert.ok(bodyStart >= 0, `缺少函数体 ${name}`)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`函数未结束: ${name}`)
}

export async function remainingImportBetween(source, startMarker, endMarker) {
  const snippet = remainingSourceBetween(source, startMarker, endMarker)
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(snippet)}`)
}
