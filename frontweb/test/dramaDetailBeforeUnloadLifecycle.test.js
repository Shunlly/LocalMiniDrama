import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createProjectInstanceLifecycle } from '../src/utils/projectInstanceLifecycle.js'

const source = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')

test('DramaDetail 卸载标记会挡住初始加载完成后的 beforeunload 注册', () => {
  assert.match(
    source,
    /let dramaDetailUnmounted = false\s*onMounted\(async \(\) => \{\s*await retryDramaLoad\(\)\s*if \(dramaDetailUnmounted\) return\s*window\.addEventListener\('beforeunload', handleInfoBeforeUnload\)/,
  )
  assert.match(
    source,
    /onBeforeUnmount\(\(\) => \{\s*dramaDetailUnmounted = true\s*projectLifecycle\.dispose\(\)\s*clearInfoSaveTimer\(\)\s*window\.removeEventListener\('beforeunload', handleInfoBeforeUnload\)/,
  )
})

test('DramaDetail 卸载后会跳过延迟打开的批量导入弹窗', () => {
  assert.match(
    source,
    /if \(isDramaReady\.value && route\.query\.importBatch\) \{\s*setTimeout\(\(\) => \{\s*if \(dramaDetailUnmounted\) return\s*episodeBatchImportDialogRef\.value\?\.openDialog\?\.\(\)/,
  )
})

test('项目实例生命周期在 dispose 后拒绝延迟完成的操作', async () => {
  const lifecycle = createProjectInstanceLifecycle()
  const events = []
  const pending = lifecycle.execute(async () => {
    events.push('start')
    await Promise.resolve()
    events.push('resume')
    return 'loaded'
  })

  lifecycle.dispose()
  await assert.rejects(pending, (error) => error?.code === 'PROJECT_INSTANCE_DISPOSED')
  assert.deepEqual(events, ['start', 'resume'])
  assert.equal(lifecycle.isActive(), false)
  await assert.rejects(
    lifecycle.execute(() => events.push('after-dispose')),
    (error) => error?.code === 'PROJECT_INSTANCE_DISPOSED',
  )
  assert.deepEqual(events, ['start', 'resume'])
})
