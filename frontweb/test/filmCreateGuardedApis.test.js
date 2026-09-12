import test from 'node:test'
import assert from 'node:assert/strict'

import { createFilmCreateGuardedApis } from '../src/components/filmCreate/filmCreateGuardedApis.js'

test('制作页守卫 API 不会把剧集 ID 当成项目 ID 传入生命周期', () => {
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
  const timelinesAPI = { name: 'timelines', episodeId: 22 }
  const result = createFilmCreateGuardedApis(lifecycle, {
    ElMessage: { name: 'message' },
    dramaAPI,
    timelinesAPI,
  })
  assert.equal(result.ElMessage.kind, 'notifier')
  assert.equal(result.dramaAPI.value, dramaAPI)
  assert.equal(result.timelinesAPI.value, timelinesAPI)
  assert.notEqual(dramaAPI.dramaId, timelinesAPI.episodeId)
  assert.equal(calls.some((item) => item[0] === 'api' && item[1] === timelinesAPI), true)
})
