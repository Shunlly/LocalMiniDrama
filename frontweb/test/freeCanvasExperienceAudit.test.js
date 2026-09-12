import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'
import {
  confirmFreeCanvasCreatedAsset,
  describeFreeCanvasAssetAddBlockReason,
  describeFreeCanvasAssetScopeMismatch,
  positiveFreeCanvasEntityId,
} from '../src/utils/freeCanvasMedia.js'
import {
  buildFreeCanvasConfigRuntime,
  resolveFreeCanvasConfigGenerationOutcome,
  toFreeCanvasConfigUserReason,
} from '../src/utils/freeCanvasConfigState.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('隐藏制作节点后空态和工具条都提供显示制作节点下一步', () => {
  const emptyStart = read('../src/components/dramaCanvas/FreeCanvasEmptyStart.vue')
  const overlays = read('../src/components/dramaCanvas/CanvasEmptyOverlays.vue')
  const workspace = read('../src/components/dramaCanvas/CanvasWorkspace.vue')
  const toolbar = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')
  const graph = read('../src/composables/useDramaCanvasGraph.js')

  assert.match(emptyStart, /aria-label="显示制作节点"/)
  assert.match(emptyStart, /setHideProductionNodes\(false\)/)
  assert.match(emptyStart, /制作节点已隐藏，可先显示回来/)
  assert.match(overlays, /:hide-production-nodes="hideProductionNodes"/)
  assert.match(overlays, /:set-hide-production-nodes="setHideProductionNodes"/)
  assert.match(workspace, /:hide-production-nodes="hideProductionNodes"/)
  assert.match(workspace, /:set-hide-production-nodes="setHideProductionNodes"/)
  assert.match(toolbar, /<span v-if="hideProductionNodes">显示制作节点<\/span>/)
  assert.match(toolbar, /emit\('toggle-hide-production', false\)/)
  assert.match(toolbar, /制作节点已隐藏，下一步可显示回来或新建自由节点/)
  assert.match(graph, /function setHideProductionNodes/)
})

test('选中节点时上下文条高于检查器，检查器底部给操作条留空', () => {
  const bar = read('../src/components/dramaCanvas/FreeCanvasContextBar.vue')
  const overlay = read('../src/components/dramaCanvas/CanvasOverlayHost.vue')
  assert.match(bar, /z-index: 1300/)
  assert.match(overlay, /z-index: 1200/)
  assert.match(overlay, /calc\(100vh - 286px\)/)
  assert.match(bar, /calc\(\(100vw - 380px\) \/ 2\)/)
})

test('配置生成失败原因去掉英文技术原文', () => {
  assert.equal(
    toFreeCanvasConfigUserReason('Internal Server Error', '生成失败，请稍后重试'),
    '生成失败，请稍后重试',
  )
  assert.equal(
    toFreeCanvasConfigUserReason('上游图片还没有可用的本地文件，请先添加可预览的图片', '生成失败，请稍后重试'),
    '上游图片还没有可用的本地文件，请先添加可预览的图片',
  )
  const runtime = buildFreeCanvasConfigRuntime(
    'config-1',
    {
      nodes: [{ id: 'config-1', type: 'config', status: 'failed', metadata: { lastError: 'Failed to fetch' } }],
      edges: [],
    },
    { gate: { ready: true, status: 'ready', reason: '', serviceType: 'image' } },
  )
  assert.match(runtime.reason, /上次生成失败/)
  assert.doesNotMatch(runtime.reason, /Failed to fetch/)
  const outcome = resolveFreeCanvasConfigGenerationOutcome({
    itemStatus: 'failed',
    error: new Error('network error'),
  })
  assert.match(outcome.lastError, /生成失败/)
})

test('保存到素材中心按素材编号确认，项目编号 12 与素材编号 99 不能互换', async () => {
  const save = remainingExtractNamedFunction(
    read('../src/composables/useDramaCanvasFreeCanvas.js'),
    'saveFreeCanvasNodeAsAsset',
  )
  const add = remainingExtractNamedFunction(
    read('../src/composables/useDramaCanvasFreeCanvasMedia.js'),
    'createFreeNodeFromAsset',
  )
  assert.match(save, /confirmFreeCanvasCreatedAsset\(created/)
  assert.match(save, /projectId: requestedProjectId/)
  assert.doesNotMatch(save, /assetsAPI\.get\([^\n]*dramaId/)
  assert.match(add, /describeFreeCanvasAssetAddBlockReason\(asset, dramaId\.value\)/)
  assert.match(add, /asset_ref: assetId/)
  assert.doesNotMatch(add, /asset_ref: asset\?\.id/)

  const lookedUp = []
  const confirmed = await confirmFreeCanvasCreatedAsset(
    { id: 99, drama_id: 12, type: 'image' },
    {
      projectId: 12,
      assetsApi: {
        async get(id) {
          lookedUp.push(id)
          return { id: 99, drama_id: 12, type: 'image' }
        },
      },
    },
  )
  assert.deepEqual(lookedUp, [99])
  assert.equal(positiveFreeCanvasEntityId(confirmed.id), 99)
  assert.notEqual(positiveFreeCanvasEntityId(12), positiveFreeCanvasEntityId(99))
  assert.equal(describeFreeCanvasAssetScopeMismatch({ id: 99, drama_id: 12 }, 12), '')
  assert.match(describeFreeCanvasAssetScopeMismatch({ id: 12, drama_id: 99 }, 12), /不属于当前项目/)
  assert.match(describeFreeCanvasAssetAddBlockReason({ id: 12, title: '项目对象' }, 12), /只能添加图片或视频素材/)
})
