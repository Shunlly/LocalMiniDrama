import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describeDraftImagePlaceholderCopy } from '../src/components/filmCreate/filmCreateStoryboardImageColumnCopy.js'

const columnSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardImageColumn.vue', import.meta.url),
  'utf8',
)
const copySource = readFileSync(
  new URL('../src/components/filmCreate/filmCreateStoryboardImageColumnCopy.js', import.meta.url),
  'utf8',
)

test('草稿占位给出可执行下一步，不再提不存在的正式模式开关', () => {
  const copy = describeDraftImagePlaceholderCopy()
  assert.equal(copy.title, '草稿占位')
  assert.equal(copy.nextStep, '尚未生成可预览的分镜图，点下方生成分镜参考图，或手动上传。')
  assert.match(copy.nextStep, /点下方生成分镜参考图/)
  assert.match(copy.nextStep, /手动上传/)
  assert.doesNotMatch(copy.nextStep, /正式模式/)
  assert.match(columnSource, /draftPlaceholderCopy\.title/)
  assert.match(columnSource, /draftPlaceholderCopy\.nextStep/)
  assert.match(columnSource, /生成分镜参考图/)
  assert.doesNotMatch(columnSource, /可切换到正式模式或手动上传/)
  assert.match(copySource, /点下方生成分镜参考图，或手动上传/)
})
