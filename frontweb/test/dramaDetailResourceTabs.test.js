import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, nextTick } from 'vue'

import { createDramaDetailResourceTabs, DRAMA_DETAIL_RESOURCE_TABS } from '../src/components/dramaDetail/dramaDetailResourceTabs.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailResourceTabs.js')

test('资源库 Tab 键盘切换不把分集 ID 写进资源 Tab', async () => {
  assert.match(pageSource, /createDramaDetailResourceTabs\(/)
  assert.match(helperSource, /export function createDramaDetailResourceTabs\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const events = []
  const focused = []
  const originalDocument = globalThis.document
  globalThis.document = {
    getElementById(id) {
      return { focus() { focused.push(id) } }
    },
  }
  const scope = effectScope()
  try {
    const tabs = scope.run(() => createDramaDetailResourceTabs({
      loadCharList() { events.push('char') },
      loadSceneList() { events.push('scene') },
      loadPropList() { events.push('prop') },
    }))
    assert.equal(tabs.activeResTab.value, 'lib-char')
    assert.equal(DRAMA_DETAIL_RESOURCE_TABS.includes('lib-char'), true)
    tabs.onResourceTabKeydown({ key: 'ArrowRight', preventDefault() { events.push('prevent') } })
    assert.equal(tabs.activeResTab.value, 'lib-scene')
    assert.equal(events.includes('prevent'), true)
    tabs.openPreview('/static/cover.png')
    assert.equal(tabs.previewUrl.value, '/static/cover.png')
    await nextTick()
  } finally {
    scope.stop()
    globalThis.document = originalDocument
  }
})
