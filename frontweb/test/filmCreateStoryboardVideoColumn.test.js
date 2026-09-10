import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const columnSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardVideoColumn.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')
const columnCss = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardVideoColumn.css', import.meta.url),
  'utf8',
)

const describeSbVideoGridReference = new Function(
  `'use strict'; ${remainingExtractNamedFunction(columnSource, 'describeSbVideoGridReference')}; return describeSbVideoGridReference;`,
)()

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
const OTHER_STORYBOARD_ID = 88
const GRID_IMAGE_ID = 101
const OTHER_GRID_IMAGE_ID = 202
const STORYBOARD_NUMBER = 3

assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(DRAMA_ID, STORYBOARD_ID)
assert.notEqual(EPISODE_ID, STORYBOARD_ID)
assert.notEqual(STORYBOARD_ID, OTHER_STORYBOARD_ID)
assert.notEqual(STORYBOARD_ID, GRID_IMAGE_ID)
assert.notEqual(EPISODE_ID, GRID_IMAGE_ID)
assert.notEqual(DRAMA_ID, GRID_IMAGE_ID)
assert.notEqual(GRID_IMAGE_ID, OTHER_GRID_IMAGE_ID)

function baseSb(overrides = {}) {
  return {
    id: STORYBOARD_ID,
    storyboard_number: STORYBOARD_NUMBER,
    drama_id: DRAMA_ID,
    episode_id: EPISODE_ID,
    video_reference_image_id: 0,
    ...overrides,
  }
}

function quadGrid(id = GRID_IMAGE_ID) {
  return { id, frame_type: 'quad_grid', status: 'completed', image_url: `/static/grid-${id}.png` }
}

function nineGrid(id = OTHER_GRID_IMAGE_ID) {
  return { id, frame_type: 'nine_grid', status: 'completed', image_url: `/static/grid-${id}.png` }
}

const panelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('制作页把宫格参考回调接到分镜视频列', () => {
  assert.match(panelSource, /:get-sb-grid-images="getSbGridImages"/)
  assert.match(panelSource, /:get-sb-video-reference-grid="getSbVideoReferenceGrid"/)
  assert.match(panelSource, /:on-open-video-params="onOpenVideoParamsDialog"/)
  assert.match(filmCreateSource, /storyboardPanel: \{[\s\S]*getSbGridImages/)
  assert.match(filmCreateSource, /storyboardPanel: \{[\s\S]*getSbVideoReferenceGrid/)
})

test('分镜视频列可独立编译', () => {
  const parsed = parse(columnSource, { filename: 'FilmCreateStoryboardVideoColumn.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, {
    id: 'storyboard-video-column-grid-ref',
    inlineTemplate: true,
  }))
})

test('宫格参考相关 props 可选且默认空，不破坏现有分镜面板接线', () => {
  assert.match(columnSource, /getSbGridImages:\s*\{\s*type:\s*Function,\s*default:\s*undefined\s*\}/)
  assert.match(columnSource, /getSbVideoReferenceGrid:\s*\{\s*type:\s*Function,\s*default:\s*undefined\s*\}/)
  assert.match(columnSource, /onOpenVideoParams:\s*\{\s*type:\s*Function,\s*default:\s*undefined\s*\}/)
  assert.doesNotMatch(columnSource, /getSbGridImages:\s*\{[^}]*required:\s*true/)
  assert.doesNotMatch(columnSource, /getSbVideoReferenceGrid:\s*\{[^}]*required:\s*true/)
  assert.doesNotMatch(columnSource, /onOpenVideoParams:\s*\{[^}]*required:\s*true/)
  assert.match(columnSource, /sb:\s*\{\s*type:\s*Object,\s*required:\s*true\s*\}/)
  assert.match(columnSource, /onOpenSbPromptDialog:\s*\{\s*type:\s*Function,\s*required:\s*true\s*\}/)
})

test('视频列始终展示宫格参考状态和无障碍中文标签', () => {
  assert.match(columnSource, /class="sb-video-grid-ref"/)
  assert.match(columnSource, /role="status"/)
  assert.match(columnSource, /:aria-label="gridRefState\.ariaLabel"/)
  assert.match(columnSource, /\{\{ gridRefState\.statusText \}\}/)
  assert.match(columnSource, /\{\{ gridRefState\.hintText \}\}/)
  assert.match(columnSource, /v-if="gridRefState\.canOpenParams"/)
  assert.match(columnSource, /:aria-label="gridRefState\.actionAriaLabel"/)
  assert.match(columnSource, /@click="onOpenGridRefParams"/)
  assert.match(columnSource, /已选宫格参考/)
  assert.match(columnSource, /未选宫格参考/)
  assert.match(columnSource, /请到「视频参数」中选择宫格参考图/)
  assert.match(columnSource, /请先生成宫格图，再到「视频参数」中选择/)
  assert.match(columnCss, /\.sb-video-grid-ref\s*\{/)
  const ariaLabels = [...columnSource.matchAll(/(?:^|\s)(?:aria-label|:aria-label)\s*=\s*(["'`])([\s\S]*?)\1/g)]
    .map((match) => match[2])
  assert.ok(ariaLabels.length > 0)
  for (const value of ariaLabels) {
    assert.doesNotMatch(value, /\b(grid|video params|select|reference|open)\b/i)
    if (!value.includes('gridRefState')) {
      assert.match(value, /[\u4e00-\u9fff]/)
    }
  }
})

test('未传入取值器时，按分镜自身的宫格参考图 id 显示状态', () => {
  const empty = describeSbVideoGridReference({
    sb: baseSb({ video_reference_image_id: 0 }),
    storyboardIndex: 0,
  })
  const selected = describeSbVideoGridReference({
    sb: baseSb({ video_reference_image_id: GRID_IMAGE_ID }),
    storyboardIndex: 0,
  })
  const otherBoard = describeSbVideoGridReference({
    sb: baseSb({
      id: OTHER_STORYBOARD_ID,
      storyboard_number: 8,
      video_reference_image_id: OTHER_GRID_IMAGE_ID,
    }),
    storyboardIndex: 7,
  })

  assert.equal(empty.hasSelected, false)
  assert.equal(empty.statusText, '未选宫格参考')
  assert.equal(empty.hintText, '请到「视频参数」中选择宫格参考图')
  assert.equal(empty.canOpenParams, false)
  assert.equal(empty.actionText, '')
  assert.equal(empty.ariaLabel, '分镜3未选宫格参考')
  assert.match(empty.actionAriaLabel, /打开分镜3视频参数选择宫格参考图/)

  assert.equal(selected.hasSelected, true)
  assert.equal(selected.statusText, '已选宫格参考')
  assert.equal(selected.hintText, `宫格整图 #${GRID_IMAGE_ID}`)
  assert.equal(selected.ariaLabel, '分镜3已选宫格参考')
  assert.notEqual(selected.statusText, empty.statusText)
  assert.equal(otherBoard.hasSelected, true)
  assert.equal(otherBoard.hintText, `宫格整图 #${OTHER_GRID_IMAGE_ID}`)
  assert.notEqual(otherBoard.hintText, selected.hintText)
  assert.doesNotMatch(selected.hintText, new RegExp(String(DRAMA_ID)))
  assert.doesNotMatch(selected.hintText, new RegExp(String(EPISODE_ID)))
  assert.doesNotMatch(selected.hintText, new RegExp(String(STORYBOARD_ID)))
})

test('取值器返回的宫格图优先于分镜字段，且不会把项目/剧集 id 当成宫格图', () => {
  const calls = []
  const selectedGrid = describeSbVideoGridReference({
    sb: baseSb({ video_reference_image_id: 0 }),
    getSbGridImages: (storyboardId) => {
      calls.push(['grid', storyboardId])
      assert.equal(storyboardId, STORYBOARD_ID)
      assert.notEqual(storyboardId, DRAMA_ID)
      assert.notEqual(storyboardId, EPISODE_ID)
      return [quadGrid(GRID_IMAGE_ID), nineGrid(OTHER_GRID_IMAGE_ID)]
    },
    getSbVideoReferenceGrid: (sb) => {
      calls.push(['selected', sb.id])
      assert.equal(sb.id, STORYBOARD_ID)
      assert.notEqual(sb.id, GRID_IMAGE_ID)
      return nineGrid(OTHER_GRID_IMAGE_ID)
    },
    onOpenVideoParams: () => {},
  })
  const staleId = describeSbVideoGridReference({
    sb: baseSb({ video_reference_image_id: GRID_IMAGE_ID }),
    getSbGridImages: (storyboardId) => {
      assert.equal(storyboardId, STORYBOARD_ID)
      return [quadGrid(GRID_IMAGE_ID)]
    },
    getSbVideoReferenceGrid: () => null,
  })

  assert.equal(selectedGrid.hasSelected, true)
  assert.equal(selectedGrid.statusText, '已选宫格参考')
  assert.equal(selectedGrid.hintText, `九宫格整图 #${OTHER_GRID_IMAGE_ID}`)
  assert.equal(selectedGrid.canOpenParams, true)
  assert.equal(selectedGrid.actionText, '更换')
  assert.equal(selectedGrid.actionAriaLabel, '打开分镜3视频参数更换宫格参考图')
  assert.deepEqual(calls, [['grid', STORYBOARD_ID], ['selected', STORYBOARD_ID]])

  assert.equal(staleId.hasSelected, false)
  assert.equal(staleId.statusText, '未选宫格参考')
  assert.equal(staleId.hintText, '请到「视频参数」中选择宫格参考图')
  assert.notEqual(staleId.statusText, selectedGrid.statusText)
})

test('有宫格图但未选时提示去视频参数；没有宫格图时说明先生成', () => {
  const hasImages = describeSbVideoGridReference({
    sb: baseSb(),
    getSbGridImages: (storyboardId) => {
      assert.equal(storyboardId, STORYBOARD_ID)
      return [quadGrid(GRID_IMAGE_ID)]
    },
    onOpenVideoParams: (sb) => sb,
  })
  const noImages = describeSbVideoGridReference({
    sb: baseSb({ id: OTHER_STORYBOARD_ID, storyboard_number: 8 }),
    storyboardIndex: 7,
    getSbGridImages: (storyboardId) => {
      assert.equal(storyboardId, OTHER_STORYBOARD_ID)
      assert.notEqual(storyboardId, STORYBOARD_ID)
      return []
    },
  })
  const fallbackVerified = describeSbVideoGridReference({
    sb: baseSb({ video_reference_image_id: String(GRID_IMAGE_ID) }),
    getSbGridImages: (storyboardId) => {
      assert.equal(storyboardId, STORYBOARD_ID)
      return [quadGrid(GRID_IMAGE_ID)]
    },
  })
  const fallbackMissing = describeSbVideoGridReference({
    sb: baseSb({ video_reference_image_id: GRID_IMAGE_ID }),
    getSbGridImages: () => [nineGrid(OTHER_GRID_IMAGE_ID)],
  })

  assert.equal(hasImages.hasSelected, false)
  assert.equal(hasImages.hintText, '请到「视频参数」中选择宫格参考图')
  assert.equal(hasImages.canOpenParams, true)
  assert.equal(hasImages.actionText, '去选择')
  assert.equal(hasImages.actionAriaLabel, '打开分镜3视频参数选择宫格参考图')

  assert.equal(noImages.hasSelected, false)
  assert.equal(noImages.hintText, '请先生成宫格图，再到「视频参数」中选择')
  assert.equal(noImages.ariaLabel, '分镜8未选宫格参考')
  assert.notEqual(noImages.hintText, hasImages.hintText)

  assert.equal(fallbackVerified.hasSelected, true)
  assert.equal(fallbackVerified.hintText, `四宫格整图 #${GRID_IMAGE_ID}`)
  assert.equal(fallbackMissing.hasSelected, false)
  assert.notEqual(fallbackVerified.hasSelected, fallbackMissing.hasSelected)
})

test('打开视频参数入口只在回调是函数时可用，并传入当前分镜', () => {
  const withFn = describeSbVideoGridReference({
    sb: baseSb(),
    onOpenVideoParams: (sb) => sb,
  })
  const withNull = describeSbVideoGridReference({
    sb: baseSb(),
    onOpenVideoParams: null,
  })
  assert.equal(withFn.canOpenParams, true)
  assert.equal(withNull.canOpenParams, false)
  assert.match(columnSource, /if \(typeof props\.onOpenVideoParams === 'function'\)/)
  assert.match(columnSource, /props\.onOpenVideoParams\(props\.sb\)/)
  assert.doesNotMatch(columnSource, /onOpenVideoParamsDialog/)
})
