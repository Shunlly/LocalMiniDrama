import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { taskAPI } from '../src/api/task.js'
import { remainingExtractNamedFunction, remainingSourceBetween } from './helpers/remainingSourceBetween.js'

const storeSource = readFileSync(new URL('../src/stores/generationTaskStore.js', import.meta.url), 'utf8')

test('远程取消不确定和耗尽时前端保持 cancelling 并继续轮询', () => {
  assert.match(storeSource, /REMOTE_CANCEL_RECONCILE_CODES = new Set\(\['REMOTE_CANCEL_UNCERTAIN', 'REMOTE_CANCEL_EXHAUSTED'\]\)/)
  const cancelBlock = remainingExtractNamedFunction(storeSource, 'cancelTask')
  assert.match(cancelBlock, /status: 'cancelling'/)
  assert.match(cancelBlock, /void pollTask\(taskId, meta, options\.onDone/)
  const reconcileBranch = remainingSourceBetween(
    cancelBlock,
    'if (REMOTE_CANCEL_RECONCILE_CODES',
    "return { status: 'cancelling'",
  )
  assert.doesNotMatch(reconcileBranch, /stopPollingTask\(taskId/)
})

test('资源级任务查询支持携带真实项目编号', async () => {
  const calls = []
  const originalGet = taskAPI.listByResource
  // 通过 remainingImported source 不够，直接断言导出函数会写入 drama_id
  const source = String(taskAPI.listByResource)
  assert.match(source, /params\.drama_id = String\(options\.drama_id\)/)
  assert.match(storeSource, /listByResource\(String\(episodeId\), \{ drama_id: dramaId \}\)/)
  assert.match(storeSource, /listByResource\(String\(resourceId\), \{ drama_id: dramaId \}\)/)
  assert.equal(typeof originalGet, 'function')
})
