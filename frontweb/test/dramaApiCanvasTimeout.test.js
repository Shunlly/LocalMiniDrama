import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dramaApiSource = readFileSync(new URL('../src/api/drama.js', import.meta.url), 'utf8')

test('canvas persistence uses a bounded request timeout', () => {
  assert.match(
    dramaApiSource,
    /saveCanvasLayout\([\s\S]*?request\.put\(`\/dramas\/\$\{id\}\/canvas-layout`, body, \{ timeout: 30000 \}\)/,
  )
})
