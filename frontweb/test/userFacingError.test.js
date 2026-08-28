import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toUserFacingError, isUserFacingAbort } from '../src/utils/userFacingError.js'

test('toUserFacingError ?????????????????', () => {
  assert.equal(toUserFacingError({ message: 'Network Error' }, '保存失败'), '保存失败')
  assert.equal(toUserFacingError({ message: '请先填写名称' }, '保存失败'), '请先填写名称')
  assert.equal(toUserFacingError('cancel'), '操作已取消')
  assert.equal(isUserFacingAbort({ name: 'AbortError' }), true)
})

test('制作页取消/配音/上传失败不再直出 e.message', () => {
  const files = [
    '../src/composables/filmCreate/useFilmCreateTaskCancel.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardTts.js',
    '../src/composables/filmCreate/useFilmCreateResourceUpload.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardUpload.js',
    '../src/components/EpisodeBatchImportDialog.vue',
    '../src/composables/filmCreate/useProps.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardPrompts.js',
    '../src/composables/filmCreate/useFilmCreateScriptWorkspace.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardImageGeneration.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardCrud.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardAccessors.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardVideoFields.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardReferences.js',
    '../src/composables/filmCreate/useFilmCreateUniversalSegment.js',
    '../src/composables/filmCreate/useFilmCreateTailFrameLink.js',
  ]
  for (const rel of files) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.match(source, /toUserFacingError/)
    assert.doesNotMatch(source, /ElMessage\.error\(e\??\.message/)
  }
})
