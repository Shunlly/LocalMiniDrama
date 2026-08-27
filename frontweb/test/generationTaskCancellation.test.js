import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storeSource = readFileSync(new URL('../src/stores/generationTaskStore.js', import.meta.url), 'utf8')
const taskApiSource = readFileSync(new URL('../src/api/task.js', import.meta.url), 'utf8')

test('远端取消不确定和耗尽时前端保留 cancelling 并继续对账', () => {
  assert.match(storeSource, /REMOTE_CANCEL_RECONCILE_CODES = new Set\(\['REMOTE_CANCEL_UNCERTAIN', 'REMOTE_CANCEL_EXHAUSTED'\]\)/)
  assert.match(storeSource, /status: 'cancelling'/)
  assert.match(storeSource, /void pollTask\(taskId, meta, options\.onDone/)
  assert.match(storeSource, /remote\.status === 'cancelling'/)
  const cancelBlock = storeSource.slice(
    storeSource.indexOf('async function cancelTask'),
    storeSource.indexOf('/** 清除所有 running 任务')
  )
  const reconcileBranch = cancelBlock.slice(
    cancelBlock.indexOf('if (REMOTE_CANCEL_RECONCILE_CODES'),
    cancelBlock.indexOf("return { status: 'cancelling'")
  )
  assert.doesNotMatch(
    reconcileBranch,
    /stopPollingTask\(taskId/
  )
})

test('资源任务查询支持携带真实项目作用域', () => {
  assert.match(taskApiSource, /listByResource\(resourceId, options = \{\}\)/)
  assert.match(taskApiSource, /params\.drama_id = String\(options\.drama_id\)/)
  assert.match(storeSource, /listByResource\(String\(episodeId\), \{ drama_id: dramaId \}\)/)
  assert.match(storeSource, /listByResource\(String\(resourceId\), \{ drama_id: dramaId \}\)/)
})
