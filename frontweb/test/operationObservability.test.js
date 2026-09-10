import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { cancelPipelineTasksAroundRun } from '../src/utils/filmPipelineControl.js'
import {
  getOperationLogs,
  installOperationLogSink,
  resetOperationLogs,
} from '../src/utils/operationLog.js'
import { trackFilmCreateAction } from '../src/utils/filmCreateActionLog.js'
import { useFilmCreatePipelineRun } from '../src/composables/filmCreate/useFilmCreatePipelineRun.js'
import { useFilmCreatePipelineStages } from '../src/composables/filmCreate/useFilmCreatePipelineStages.js'
import { remainingImportedFunctionSource } from './helpers/remainingSourceBetween.js'
import { requestCoreJson } from '../src/utils/coreJsonRequest.js'
import { REQUEST_ERROR_CATEGORY } from '../src/utils/requestError.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('制作页、项目列表、AI 配置和任务取消都接入本地操作日志', () => {
  const filmCreateSource = read('../src/views/FilmCreate.vue')
  const filmListSource = read('../src/views/FilmList.vue')
  const aiConfigSource = read('../src/components/AIConfigContent.vue')
  const storeSource = read('../src/stores/generationTaskStore.js')
  const pipelineSource = remainingImportedFunctionSource(useFilmCreatePipelineRun, useFilmCreatePipelineStages)

  assert.equal(typeof trackFilmCreateAction, 'function')
  assert.match(pipelineSource, /trackFilmCreateAction\('pipeline_stop_start'/)
  assert.match(pipelineSource, /trackFilmCreateAction\(cancellationComplete \? 'pipeline_stop_complete' : 'pipeline_stop_failed'/)
  assert.match(pipelineSource, /trackFilmCreateAction\('text_framework_generate_start'/)

  assert.match(filmListSource, /import \{ createOperationId, logOperation \} from '@\/utils\/operationLog'/)
  assert.match(filmListSource, /operation: 'project_list_load'/)
  assert.match(filmListSource, /phase: 'start'/)
  assert.match(filmListSource, /phase: 'success'/)
  assert.match(filmListSource, /phase: 'error'/)
  assert.match(filmListSource, /phase: 'cancel'/)

  assert.match(aiConfigSource, /import \{ createOperationId, logOperation \} from '@\/utils\/operationLog'/)
  assert.match(aiConfigSource, /operation: 'ai_config_test'/)
  assert.match(aiConfigSource, /phase: 'error'/)

  assert.match(storeSource, /import \{ logOperation \} from '@\/utils\/operationLog'/)
  assert.match(storeSource, /operation: 'generation_task_cancel'/)
  assert.match(storeSource, /phase: 'cancel'/)
})

test('全流程任务取消会留下开始和结果日志', async () => {
  resetOperationLogs()
  const captured = []
  const restore = installOperationLogSink((record) => captured.push(record))
  try {
    const result = await cancelPipelineTasksAroundRun({
      getTaskIds: () => ['task-1'],
      runPromise: Promise.resolve(),
      cancelTask: async () => {},
    })
    assert.equal(result.complete, true)
  } finally {
    restore()
  }
  const logs = getOperationLogs().filter((item) => item.operation === 'pipeline_task_cancel')
  assert.deepEqual(logs.map((item) => item.phase), ['start', 'success'])
  assert.equal(captured.length >= 2, true)
})


test('core JSON 与成片下载失败都会留下带 requestId 和 category 的 http_request 日志', async () => {
  resetOperationLogs()
  const coreSource = read('../src/utils/coreJsonRequest.js')
  const deliverySource = read('../src/utils/filmCreateDelivery.js')
  assert.match(coreSource, /ensureRequestId/)
  assert.match(coreSource, /logOperation/)
  assert.match(coreSource, /operation: 'http_request'/)
  assert.match(deliverySource, /prepareFetchRequest/)
  assert.match(deliverySource, /finalizeFetchRequestFailure/)

  await assert.rejects(
    requestCoreJson('/items', {
      fetchImpl: async (_url, options) => new Response(JSON.stringify({
        success: false,
        error: { code: 'BAD_REQUEST', message: '名称不能为空' },
      }), {
        status: 400,
        headers: { 'content-type': 'application/json', 'x-request-id': options.headers['X-Request-Id'] },
      }),
    }),
  )
  const logs = getOperationLogs().filter((item) => item.operation === 'http_request')
  assert.equal(logs.length, 1)
  assert.equal(logs[0].phase, 'error')
  assert.equal(logs[0].details.category, REQUEST_ERROR_CATEGORY.HTTP_4XX)
  assert.match(String(logs[0].operationId || logs[0].details.requestId || ''), /^[A-Za-z0-9._:-]{1,128}$/)
  assert.equal(logs[0].error, '名称不能为空')
  assert.doesNotMatch(JSON.stringify(logs), /无法连接服务/)
})
