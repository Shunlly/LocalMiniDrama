import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createDramaDetailGuardedApis } from '../src/components/dramaDetail/dramaDetailGuardedApis.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailGuardedApis.js')

test('剧集详情守卫 API 不会把剧集 ID 当成项目 ID 传入生命周期', () => {
  const calls = []
  const lifecycle = {
    guardNotifier(value) {
      calls.push(['notifier', value])
      return { kind: 'notifier', value }
    },
    guardApi(value) {
      calls.push(['api', value])
      return { kind: 'api', value }
    },
  }
  const dramaAPI = { name: 'drama', dramaId: 11 }
  const characterAPI = { name: 'character', episodeId: 22 }
  const result = createDramaDetailGuardedApis(lifecycle, {
    ElMessage: { name: 'message' },
    dramaAPI,
    characterAPI,
  })
  assert.equal(result.ElMessage.kind, 'notifier')
  assert.equal(result.dramaAPI.value, dramaAPI)
  assert.equal(result.characterAPI.value, characterAPI)
  assert.notEqual(dramaAPI.dramaId, characterAPI.episodeId)
  assert.equal(calls.some((item) => item[0] === 'api' && item[1] === characterAPI), true)
  assert.match(pageSource, /createDramaDetailGuardedApis\(projectLifecycle/)
  assert.match(helperSource, /export function createDramaDetailGuardedApis\(/)
  assert.doesNotMatch(helperSource, /useDramaDetail/)
})
