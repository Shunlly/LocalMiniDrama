import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeStoryboardListWindow,
  visibleStoryboardItems,
  pinStoryboardIndexes,
  isStoryboardDomId,
  parseStoryboardRevealId,
} from '../src/utils/storyboardListWindow.js'

test('分镜列表窗口只渲染视口附近的行，并保留钉住的插入位置', () => {
  const windowState = computeStoryboardListWindow({
    total: 40,
    scrollTop: 420 * 10,
    viewportHeight: 960,
  })
  assert.ok(windowState.size < 40)
  assert.ok(windowState.size >= 8)
  assert.ok(windowState.start > 0)
  assert.ok(windowState.end < 40)
  assert.ok(windowState.topSpacer > 0)
  assert.ok(windowState.bottomSpacer > 0)

  const pinned = pinStoryboardIndexes(40, [0, 39])
  assert.deepEqual(pinned.slice(0, 2), [0, 1])
  assert.ok(pinned.includes(38))
  assert.ok(pinned.includes(39))

  const forced = computeStoryboardListWindow({
    total: 40,
    scrollTop: 0,
    viewportHeight: 960,
    forceIndex: 30,
    pinnedIndexes: pinStoryboardIndexes(40, [30]),
  })
  assert.ok(forced.start <= 30)
  assert.ok(forced.end > 30)

  const items = visibleStoryboardItems(
    Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })),
    windowState,
  )
  assert.equal(items.length, windowState.size)
  assert.equal(items[0].i, windowState.start)
  assert.equal(items.at(-1).i, windowState.end - 1)
})

test('分镜锚点 id 能解析到窗口露出目标', () => {
  assert.equal(isStoryboardDomId('sb-12'), true)
  assert.equal(isStoryboardDomId('anchor-storyboard'), false)
  assert.equal(parseStoryboardRevealId('sb-12'), '12')
  assert.equal(parseStoryboardRevealId('12'), '12')
})
