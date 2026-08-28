import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const wrapperPath = path.join(sourceRoot, 'components', 'AccessibleDialog.vue')
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

function collectVueFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectVueFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.vue') ? [entryPath] : []
  })
}

test('business Vue files use AccessibleDialog instead of el-dialog', () => {
  const violations = collectVueFiles(sourceRoot)
    .filter((filePath) => path.resolve(filePath) !== path.resolve(wrapperPath))
    .flatMap((filePath) => {
      const relativePath = path.relative(sourceRoot, filePath).replaceAll(path.sep, '/')
      return readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .flatMap((line, index) => (
          /<\/?el-dialog\b/.test(line) ? [`${relativePath}:${index + 1}`] : []
        ))
    })

  assert.deepEqual(violations, [])
})

test('main registers AccessibleDialog globally with its PascalCase name', () => {
  assert.match(
    mainSource,
    /const AccessibleDialog = defineAsyncComponent\(\(\) => import\(['"]\.\/components\/AccessibleDialog\.vue['"]\)\)/,
  )
  assert.match(
    mainSource,
    /app\.component\(\s*['"]AccessibleDialog['"]\s*,\s*AccessibleDialog\s*\)/,
  )
})

test('AccessibleDialog remains the non-recursive el-dialog boundary', () => {
  const wrapperSource = readFileSync(wrapperPath, 'utf8')

  assert.match(wrapperSource, /<el-dialog\b/)
  assert.match(wrapperSource, /<\/el-dialog>/)
  assert.doesNotMatch(wrapperSource, /<\/?AccessibleDialog\b/)
})
