import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildCanvasReferenceDisplaySlots,
  canvasReferenceDisplayName,
  canvasReferenceKindLabel,
  canvasReferenceSourceLabel,
} from '../src/composables/useCanvasReferenceDisplay.js'
import { canvasUserError, isCanvasUserAbort } from '../src/composables/useCanvasUserError.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const canvasSource = read('../src/views/DramaCanvas.vue')
const emptyStateSource = read('../src/components/dramaCanvas/CanvasEmptyState.vue')
const assetNodeSource = read('../src/components/dramaCanvas/CanvasAssetNode.vue')
const assetPanelSource = read('../src/components/dramaCanvas/CanvasAssetPanel.vue')
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const mediaNodeSource = read('../src/components/dramaCanvas/CanvasMediaNode.vue')
const mediaPanelSource = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
const scriptPanelSource = read('../src/components/dramaCanvas/CanvasScriptPanel.vue')
const contextMenuSource = read('../src/components/dramaCanvas/CanvasContextMenu.vue')

test('canvasUserError 把英文技术错误翻成中文，中文原文原样返回', () => {
  assert.equal(canvasUserError({ message: 'Network Error' }, '参考图生成失败'), '参考图生成失败')
  assert.equal(canvasUserError({ message: 'timeout of 600000ms exceeded' }, '保存失败'), '连接画布服务超时，请稍后重试')
  assert.equal(canvasUserError({ message: 'Request failed with status code 500' }, '生成失败'), '生成失败')
  assert.equal(canvasUserError({ message: '请先填写角色名称' }, '保存失败'), '请先填写角色名称')
  assert.equal(canvasUserError({ response: { status: 503 } }, '保存失败'), '画布服务暂时不可用（HTTP 503）')
  assert.equal(canvasUserError({ response: { data: { error: { message: '配额已用完' } } } }, '生成失败'), '配额已用完')
  assert.equal(canvasUserError('cancel'), '操作已取消')
  assert.equal(isCanvasUserAbort('cancel'), true)
  assert.equal(isCanvasUserAbort({ name: 'AbortError' }), true)
})

test('canvasReferenceDisplay 英文自由参考图名转成中文，并标出来源', () => {
  assert.equal(canvasReferenceKindLabel('scene'), '场景')
  assert.equal(canvasReferenceKindLabel('character'), '角色')
  assert.equal(canvasReferenceKindLabel('prop'), '道具')
  assert.equal(canvasReferenceKindLabel('free'), '自由')
  assert.equal(canvasReferenceDisplayName({ kind: 'free', name: 'Free reference', freeIndex: 0 }), '自由参考图 1')
  assert.equal(canvasReferenceDisplayName({ kind: 'free', name: 'Media library reference', index: 2 }), '自由参考图 2')
  assert.equal(canvasReferenceSourceLabel({ kind: 'character', name: '小明', url: '/static/a.png' }), '角色参考图：小明')
  assert.equal(canvasReferenceSourceLabel({ kind: 'scene', name: '教室', url: '' }), '场景「教室」暂无参考图')
})

test('buildCanvasReferenceDisplaySlots 为空时给出可绑定提示数据，缺图素材单独占位', () => {
  const empty = buildCanvasReferenceDisplaySlots()
  assert.deepEqual(empty, [])

  const slots = buildCanvasReferenceDisplaySlots({
    filledSlots: [
      { kind: 'character', name: '配角', url: '/static/b.png', index: 1 },
      { kind: 'free', name: 'Free reference', url: '/static/free.png', index: 2 },
    ],
    sceneId: 8,
    characterIds: [1, 2],
    propIds: [9],
    scenes: [{ id: 8, location: '教室' }],
    characters: [
      { id: 1, name: '主角' },
      { id: 2, name: '配角', image_url: '/static/b.png' },
    ],
    propsList: [{ id: 9, name: '雨伞' }],
    resolveUrl: (entity) => entity?.image_url || '',
  })

  assert.equal(slots.length, 5)
  assert.deepEqual(slots.map((slot) => [slot.kind, slot.name, Boolean(slot.url), slot.pending]), [
    ['scene', '教室', false, true],
    ['character', '主角', false, true],
    ['character', '配角', true, false],
    ['prop', '雨伞', false, true],
    ['free', 'Free reference', true, false],
  ])
  assert.equal(canvasReferenceSourceLabel(slots[0]), '场景「教室」暂无参考图')
  assert.equal(canvasReferenceDisplayName(slots[4]), '自由参考图 1')
})

test('DramaCanvas 侧栏空态可键盘新建，自由画布空态有说明', () => {
  assert.match(canvasSource, /class="sidebar-empty" role="status"/)
  assert.match(canvasSource, /暂无角色/)
  assert.match(canvasSource, /暂无场景/)
  assert.match(canvasSource, /暂无道具/)
  assert.match(canvasSource, /aria-label="新建角色"/)
  assert.match(canvasSource, /aria-label="新建场景"/)
  assert.match(canvasSource, /aria-label="新建道具"/)
  assert.match(canvasSource, /:aria-label="`定位角色\$\{c\.name \|\| '未命名'\}`"/)
  assert.match(canvasSource, /id="free-canvas-empty-desc"/)
  assert.match(canvasSource, /还没有自由节点/)
  assert.match(emptyStateSource, /aria-label="返回列表模式"/)
})

test('素材节点和面板空态显示暂无参考图，失败可重试', () => {
  assert.match(assetNodeSource, /暂无参考图/)
  assert.match(assetNodeSource, /key: 'empty', label: '无图'/)
  assert.match(assetPanelSource, /暂无参考图/)
  assert.match(assetPanelSource, /还没有参考图，可在下方生成/)
  assert.match(assetPanelSource, /重新生成参考图/)
  assert.match(assetPanelSource, /v-if="canGenerate \|\| generating \|\| entityStatus === 'failed'"/)
  assert.match(assetPanelSource, /generateError/)
  assert.match(assetPanelSource, /role="alert"/)
  assert.match(assetPanelSource, /aria-label="收起面板"/)
  assert.match(assetPanelSource, /@keydown\.esc\.stop\.prevent="closePanel"/)
  assert.match(assetPanelSource, /canvasUserError/)
  assert.doesNotMatch(assetPanelSource, /Network Error/)
})

test('分镜面板参考图用来源中文标签，空态和缺图占位可见', () => {
  assert.match(storyboardPanelSource, /尚未加入参考图/)
  assert.match(storyboardPanelSource, /canvasReferenceKindLabel/)
  assert.match(storyboardPanelSource, /canvasReferenceSourceLabel/)
  assert.match(storyboardPanelSource, /reference-missing/)
  assert.match(storyboardPanelSource, /class="reference-empty" role="status"/)
  assert.match(storyboardPanelSource, /buildCanvasReferenceDisplaySlots/)
  assert.doesNotMatch(storyboardPanelSource, /scene: '场', character: '角', prop: '物', free: '自'/)
  assert.match(storyboardPanelSource, /aria-label="收起面板"/)
  assert.match(storyboardPanelSource, /canvasUserError/)
})

test('媒体面板区分生成与重新生成，音频空态和英文省略号已去掉', () => {
  assert.match(mediaPanelSource, /生成首帧/)
  assert.match(mediaPanelSource, /重新生成首帧/)
  assert.match(mediaPanelSource, /生成尾帧/)
  assert.match(mediaPanelSource, /待生成首帧/)
  assert.match(mediaPanelSource, /待生成尾帧/)
  assert.match(mediaPanelSource, /暂无配音/)
  assert.match(mediaPanelSource, /生视频中…/)
  assert.match(mediaPanelSource, /生图中…/)
  assert.match(mediaPanelSource, /重试中…/)
  assert.doesNotMatch(mediaPanelSource, /生视频中\.\.\./)
  assert.doesNotMatch(mediaPanelSource, /重试中\.\.\./)
  assert.match(mediaPanelSource, /aria-label="收起面板"/)
  assert.match(mediaNodeSource, /\.canvas-media-node\.pending/)
  assert.match(mediaNodeSource, /待生成首帧/)
  assert.match(mediaNodeSource, /pending-frame/)
})

test('剧本面板提取失败不再静默，右键菜单键盘可达', () => {
  assert.match(scriptPanelSource, /canvasUserError\(e, '提取失败'\)/)
  assert.match(scriptPanelSource, /aria-label="收起面板"/)
  assert.match(scriptPanelSource, /@keydown\.esc\.stop\.prevent="closePanel"/)
  assert.match(contextMenuSource, /role="menu"/)
  assert.match(contextMenuSource, /role="menuitem"/)
})

test('画布页用户 toast 不再直出 e.message', () => {
  assert.match(canvasSource, /from '@\/composables\/useCanvasUserError'/)
  assert.match(canvasSource, /function safeFreeCanvasError\(error, fallback\) \{[\s\S]*return canvasUserError\(error, fallback/)
  assert.doesNotMatch(canvasSource, /ElMessage\.(error|warning)\(e\?\.message/)
  assert.doesNotMatch(canvasSource, /ElMessage\.(error|warning)\((?:error\?\.message|`[^`]*\$\{error\?\.message)/)
  assert.match(canvasSource, /if \(isCanvasUserAbort\(e\)\) return/)
})
