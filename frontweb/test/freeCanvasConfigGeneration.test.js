import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const inspectorSource = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
const composableSource = read('../src/composables/useDramaCanvasFreeCanvas.js')

test('inspector shows a Chinese generate action and keeps it disabled when not ready', () => {
  assert.match(inspectorSource, />\s*生成\s*</)
  assert.match(inspectorSource, /:aria-label="generateButtonAriaLabel"/)
  assert.match(inspectorSource, /return '生成'/)
  assert.match(inspectorSource, /当前不能生成，请先完成 AI 配置/)
  assert.match(
    inspectorSource,
    /const generateDisabled = computed\(\(\) => \(\s*props\.readonly \|\| props\.busy \|\| !props\.configRuntime\?\.canGenerate\s*\)\)/,
  )
  assert.match(inspectorSource, /function emitGenerate\(\) \{[\s\S]*if \(!props\.node \|\| generateDisabled\.value\) return/)
  assert.match(inspectorSource, /emit\('generate-config', props\.node\.id\)/)
  assert.match(inspectorSource, /v-if="configRuntime\.canConfigure"/)
  assert.match(inspectorSource, />\s*AI 配置\s*</)
})

test('free canvas config generation calls existing image and video APIs and real task cancel', () => {
  assert.match(composableSource, /aiAPI\.list\(serviceType/)
  assert.match(composableSource, /imagesAPI\.create\(body\)/)
  assert.match(composableSource, /videosAPI\.create\(body\)/)
  assert.match(composableSource, /taskAPI\.cancel/)
  assert.match(composableSource, /createFreeCreateTaskOwner/)
  assert.match(composableSource, /pollFreeCreateTask/)
  assert.match(composableSource, /buildFreeCreateGenerationPayload/)
  assert.match(composableSource, /async function generateFreeCanvasConfig/)
  assert.match(composableSource, /item\.type === 'video' \? videosAPI\.create\(body\) : imagesAPI\.create\(body\)/)

  const generate = remainingExtractNamedFunction(composableSource, 'generateFreeCanvasConfig')
  assert.match(generate, /resolveFreeCanvasConfigGenerationOutcome/)
  assert.match(generate, /attachConfigGenerationResult/)
  assert.match(generate, /cancelRequested/)
  assert.match(generate, /configGenerationEpochByNode.get\(String\(nodeId\)\) !== run.ownerId/)
  assert.doesNotMatch(generate, /status: 'idle'[\s\S]*cancelRequested/)

  const attach = remainingExtractNamedFunction(composableSource, 'attachConfigGenerationResult')
  assert.match(attach, /if \(!outcome\.createResult\)/)
  assert.match(attach, /createFreeNode\(draft\.type/)
  assert.match(attach, /createFreeEdge\(String\(nodeId\), resultNode\.id/)

  const cancel = remainingExtractNamedFunction(composableSource, 'cancelFreeCanvasConfig')
  assert.match(cancel, /taskAPI\.cancel/)
  assert.match(cancel, /owner\.cancel\('用户停止等待'\)/)
  assert.match(cancel, /setFreeCanvasConfigOperationState\(nodeId, 'cancelled'/)
  assert.doesNotMatch(cancel, /createResult: true/)
})

test('retrying a ready config node starts generation instead of only refreshing the gate', () => {
  const retry = remainingExtractNamedFunction(composableSource, 'retryFreeCanvasConfig')
  assert.match(retry, /runtime\.canGenerate \|\| runtime\.status === 'failed' \|\| runtime\.status === 'cancelled'/)
  assert.match(retry, /await generateFreeCanvasConfig\(nodeId\)/)
})

test('generate-config is wired through overlay bindings instead of reusing retry-config', () => {
  const overlaySource = read('../src/components/dramaCanvas/CanvasOverlayHost.vue')
  const bindingsSource = read('../src/components/dramaCanvas/dramaCanvasControlBindings.js')
  const pageBindingsSource = read('../src/composables/useDramaCanvasPageBindings.js')
  const viewSource = read('../src/views/DramaCanvas.vue')
  const derivedSource = read('../src/components/dramaCanvas/dramaCanvasDerivedState.js')
  assert.match(inspectorSource, /'generate-config'/)
  assert.match(overlaySource, /@generate-config="generateFreeCanvasConfig"/)
  assert.match(bindingsSource, /generateFreeCanvasConfig: ctx.generateFreeCanvasConfig/)
  assert.match(pageBindingsSource, /generateFreeCanvasConfig: ctx.generateFreeCanvasConfig/)
  assert.match(viewSource, /generateFreeCanvasConfig,/)
  assert.match(derivedSource, /image: productionActions\.value\.image/)
  assert.match(derivedSource, /gates: \{/)
  assert.match(derivedSource, /capabilities: \{/)
})
