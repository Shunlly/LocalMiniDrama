import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIST_WINDOW_MIN_RENDERED,
  computeListWindow,
  scrollTopForIndex,
  visibleWindowItems,
} from '../src/utils/listWindow.js'

function labels(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `项${index + 1}` }))
}

test('小列表仍整表返回，大列表只覆盖视口附近的行', () => {
  const small = computeListWindow({ total: 5, scrollTop: 0, viewportHeight: 256, rowHeight: 32 })
  assert.deepEqual(small, { start: 0, end: 5, topSpacer: 0, bottomSpacer: 0, size: 5 })

  const top = computeListWindow({ total: 80, scrollTop: 0, viewportHeight: 256, rowHeight: 32 })
  assert.equal(top.start, 0)
  assert.ok(top.size < 80)
  assert.ok(top.size >= LIST_WINDOW_MIN_RENDERED)
  assert.equal(top.topSpacer, 0)
  assert.ok(top.bottomSpacer > 0)

  const items = visibleWindowItems(labels(80), top)
  assert.equal(items.length, top.size)
  assert.equal(items[0].index, 0)
  assert.equal(items.at(-1).index, top.end - 1)
  assert.equal(items.some((entry) => entry.index === 79), false)
})

test('滚动后窗口跟着移动，不再挂载首尾整表', () => {
  const mid = computeListWindow({
    total: 80,
    scrollTop: 40 * 32,
    viewportHeight: 256,
    rowHeight: 32,
  })
  assert.ok(mid.start >= 30)
  assert.ok(mid.end <= 60)
  assert.ok(mid.size < 24)
  assert.ok(mid.topSpacer > 0)
  assert.ok(mid.bottomSpacer > 0)

  const items = visibleWindowItems(labels(80), mid)
  assert.equal(items.some((entry) => entry.index === 0), false)
  assert.equal(items.some((entry) => entry.index === 79), false)
  assert.equal(items[0].item.name, `项${mid.start + 1}`)
})

test('定位某行时滚动位置能把该行送进窗口', () => {
  const rowHeight = 32
  const viewportHeight = 256
  const scrollTop = scrollTopForIndex(79, { rowHeight, viewportHeight })
  const windowState = computeListWindow({
    total: 80,
    scrollTop,
    viewportHeight,
    rowHeight,
  })
  assert.ok(windowState.start <= 79)
  assert.ok(windowState.end > 79)
  assert.ok(windowState.size < 80)
  assert.equal(visibleWindowItems(labels(80), windowState).some((entry) => entry.index === 79), true)
})
