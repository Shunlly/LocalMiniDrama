import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toUserFacingError, isUserFacingAbort } from '../src/utils/userFacingError.js'

test('toUserFacingError 会吃掉英文技术信息并保留中文业务错误', () => {
  assert.equal(toUserFacingError({ message: 'Network Error' }, '保存失败'), '保存失败')
  assert.equal(toUserFacingError({ message: '请先填写名称' }, '保存失败'), '请先填写名称')
  assert.equal(toUserFacingError('cancel'), '操作已取消')
  assert.equal(isUserFacingAbort({ name: 'AbortError' }), true)
})

test('Network Error / Failed to fetch / HTTP 500 / AbortError 对用户是中文，且不展示 drama_id', () => {
  assert.equal(toUserFacingError({ message: 'Failed to fetch' }, '保存失败'), '保存失败')
  assert.equal(toUserFacingError(Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }), '加载失败'), '加载失败')
  assert.equal(
    toUserFacingError({ name: 'AbortError', message: 'The user aborted a request.' }, '保存失败'),
    '操作已取消',
  )
  const http500 = toUserFacingError({
    response: { status: 500, data: { error: { message: 'Internal Server Error' } } },
  }, '保存失败')
  assert.match(http500, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(http500, /Internal Server Error/i)
  assert.doesNotMatch(http500, /Failed to fetch/i)
  assert.equal(
    toUserFacingError({ response: { status: 500 } }, '保存失败'),
    '服务暂时不可用（HTTP 500）',
  )
  assert.equal(toUserFacingError({ message: 'HTTP 500' }, '保存失败'), '保存失败')
  assert.equal(toUserFacingError({ message: 'drama_id 对应的项目不存在' }, '保存失败'), '保存失败')
  const missingDrama = toUserFacingError({
    response: { status: 400, data: { error: { message: '缺少 drama_id' } } },
  }, '保存失败')
  assert.match(missingDrama, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(missingDrama, /drama_id/)
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
    '../src/composables/filmCreate/useCharacters.js',
    '../src/composables/filmCreate/useScenes.js',
    '../src/composables/filmCreate/useFilmCreateRefImageDrop.js',
  ]
  for (const rel of files) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.match(source, /toUserFacingError/)
    assert.doesNotMatch(source, /ElMessage\.error\(e\??\.message/)
  }
})


test('制作资源生成失败不直出 e.message 且不静默取消', () => {
  const files = [
    '../src/composables/filmCreate/useCharacters.js',
    '../src/composables/filmCreate/useScenes.js',
    '../src/composables/filmCreate/useProps.js',
    '../src/composables/filmCreate/useFilmCreateStoryboardImageGeneration.js',
  ]
  for (const rel of files) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.match(source, /errorMsg = toUserFacingError\(e, '生成失败'\)/)
    assert.match(source, /errorMsg = toUserFacingError\(pollRes\.error, '生成失败'\)/)
    assert.match(source, /errorMsg = toUserFacingError\(e, '生成失败'\)\s*if \(isUserFacingAbort\(e\)\) return/)
    assert.match(source, /生成超时，请稍后重试/)
    assert.match(source, /操作已取消/)
    assert.doesNotMatch(source, /errorMsg = e\.message/)
    assert.doesNotMatch(
      source,
      /catch \(e\) \{\s*if \(isUserFacingAbort\(e\)\) return\s*(?:console\.error\(e\)\s*)?(?:char|scene|prop|sb)\.errorMsg/,
    )
  }
  assert.equal(toUserFacingError({ message: 'Invalid API key sk-secret' }, '生成失败'), '生成失败')
  assert.equal(toUserFacingError({ name: 'AbortError', message: 'canceled' }, '生成失败'), '操作已取消')
})

test('剧集详情页用户错误走统一中文转义', () => {
  const page = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('../src/components/dramaDetail/dramaDetailResourceEdit.js', import.meta.url), 'utf8')
  assert.match(page, /import \{ dramaDetailUserError, characterRoleLabel, propTypeLabel \} from '@\/components\/dramaDetail\/dramaDetailResourceEdit\.js'/)
  assert.match(helper, /import \{ toUserFacingError \} from '@\/utils\/userFacingError'/)
  assert.match(helper, /function dramaDetailUserError\(error, fallback = '操作失败，请稍后重试', serviceLabel = '项目服务'\) \{\s*return toUserFacingError\(error, fallback, \{ serviceLabel \}\)/)
  assert.doesNotMatch(page, /if \(raw && !TECHNICAL_ENGLISH_RE\.test\(raw\)/)
  assert.doesNotMatch(helper, /if \(raw && !TECHNICAL_ENGLISH_RE\.test\(raw\)/)
})


test('流水线/批量生成失败不再直出 e.message', () => {
  const pipelineFiles = [
    '../src/composables/filmCreate/useFilmCreatePipelineStages.js',
    '../src/composables/filmCreate/useFilmCreatePipelineOneClick.js',
    '../src/composables/filmCreate/useFilmCreatePipelineRepair.js',
  ]
  const files = [
    ...pipelineFiles,
    '../src/composables/filmCreate/useFilmCreateBatchGeneration.js',
  ]
  for (const rel of files) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
    if (!rel.endsWith('useFilmCreatePipelineStages.js')) {
      assert.match(source, /toUserFacingError/)
    }
    assert.doesNotMatch(source, /addPipelineError\([^\n]*e\.message/)
    assert.doesNotMatch(source, /batch(?:Image|Video)Errors\.value\.push\(`[^`]*\$\{e\.message/)
  }

  const pipelineSource = pipelineFiles.map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')).join('\n')

  assert.match(pipelineSource, /import \{ isUserFacingAbort, toUserFacingError \} from '@\/utils\/userFacingError'/)
  assert.match(pipelineSource, /if \(isUserFacingAbort\(e\)\) throw e/)
  assert.match(pipelineSource, /addPipelineError\('提取角色', toUserFacingError\(e, '提取角色失败'\)\)/)
  assert.match(pipelineSource, /toPipelinePollUserFacingError\(result, '提取角色失败', '提取角色超时，请稍后重试'\)/)
  assert.match(pipelineSource, /toUserFacingError\(msg, '润色失败'\)/)
  assert.match(pipelineSource, /addPipelineError\('流程', toUserFacingError\(e, '流程失败'\)\)/)
  assert.match(pipelineSource, /生成超时，请稍后重试/)
  assert.doesNotMatch(pipelineSource, /e\.message \|\| String\(e\)/)
  assert.doesNotMatch(pipelineSource, /addPipelineError\('润色全能分镜', `镜#[^`]*\$\{msg\}`\)/)

  const batchSource = readFileSync(new URL(files[files.length - 1], import.meta.url), 'utf8')
  assert.match(batchSource, /if \(isUserFacingAbort\(e\)\) continue/)
  assert.match(batchSource, /toUserFacingError\(pollRes\.error, '生成失败'\)/)
  assert.match(batchSource, /toUserFacingError\(pollRes\.error, '生成超时，请稍后重试'\)/)
  assert.match(batchSource, /toUserFacingError\(e, '提交失败'\)/)
  assert.doesNotMatch(batchSource, /isUserFacingAbort\(e\) \? '操作已取消'/)
})

test('请求拦截器和 fetch 失败 toast 走 toUserFacingError', () => {
  const requestSource = readFileSync(new URL('../src/utils/request.js', import.meta.url), 'utf8')
  const coreSource = readFileSync(new URL('../src/utils/coreJsonRequest.js', import.meta.url), 'utf8')
  assert.match(requestSource, /import \{ toUserFacingError \} from '\.\/userFacingError\.js'/)
  assert.match(requestSource, /toUserFacingError\(error, described/)
  assert.doesNotMatch(requestSource, /if \(backendMsg\) error\.message = backendMsg/)
  assert.match(coreSource, /import \{ toUserFacingError \} from '\.\/userFacingError\.js'/)
  assert.match(coreSource, /toUserFacingError\(error, described/)
})

test('失败文案在确有 requestId 时附带请求编号，空值不加括号', () => {
  assert.equal(
    toUserFacingError({ message: '请先填写名称', requestId: 'trace-ok-1' }, '保存失败'),
    '请先填写名称（请求编号：trace-ok-1）',
  )
  assert.equal(
    toUserFacingError({ message: '请先填写名称', requestId: '' }, '保存失败'),
    '请先填写名称',
  )
  assert.doesNotMatch(
    toUserFacingError({ message: '请先填写名称' }, '保存失败'),
    /请求编号/,
  )
  const emptyId = toUserFacingError({ message: '请先填写名称', requestId: '   ' }, '保存失败')
  assert.equal(emptyId, '请先填写名称')
  assert.doesNotMatch(emptyId, /（/)
})

test('取消保持中文且不附带请求编号，超时保持中文并在有 id 时附带编号', () => {
  assert.equal(
    toUserFacingError({ code: 'ERR_CANCELED', name: 'CanceledError', requestId: 'trace-ok-1' }),
    '操作已取消',
  )
  assert.doesNotMatch(
    toUserFacingError({ name: 'AbortError', message: 'The user aborted a request.', requestId: 'trace-ok-1' }),
    /请求编号/,
  )
  assert.equal(
    toUserFacingError({ code: 'ECONNABORTED', requestId: 'trace-ok-1' }),
    '连接服务超时，请稍后重试（请求编号：trace-ok-1）',
  )
  assert.equal(
    toUserFacingError({ code: 'ECONNABORTED' }),
    '连接服务超时，请稍后重试',
  )
  assert.doesNotMatch(toUserFacingError({ code: 'ECONNABORTED' }), /timeout of/i)
})

test('不安全 requestId 会被安全值替换，不会出现在用户文案里', () => {
  assert.equal(
    toUserFacingError({
      message: '保存失败',
      requestId: '../secret\r\nInjected: yes',
      config: { requestId: 'safe-trace-1' },
    }),
    '保存失败（请求编号：safe-trace-1）',
  )
  const unsafeOnly = toUserFacingError({
    message: '保存失败',
    requestId: '../secret\r\nInjected: yes',
  })
  assert.equal(unsafeOnly, '保存失败')
  assert.doesNotMatch(unsafeOnly, /secret/)
  assert.doesNotMatch(unsafeOnly, /请求编号/)
})
