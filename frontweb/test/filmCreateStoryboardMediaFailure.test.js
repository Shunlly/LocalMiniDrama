import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createStoryboardMediaStateController,
  isStoryboardMediaStateError,
  submitStoryboardVideoAfterAccepted,
} from '../src/utils/storyboardMedia.js'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const mediaComposableSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardMedia.js', import.meta.url), 'utf8')
const pipelineRunSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePipelineRun.js', import.meta.url), 'utf8')
const pipelineStagesSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePipelineStages.js', import.meta.url), 'utf8')
const batchGenerationSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateBatchGeneration.js', import.meta.url), 'utf8')
const episodeComposeSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateEpisodeCompose.js', import.meta.url), 'utf8')
const storyboardImageGenerationSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardImageGeneration.js', import.meta.url), 'utf8')
const storyboardVideoGenerationSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardVideoGeneration.js', import.meta.url), 'utf8')
const linkedRegenSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateLinkedStoryboardRegen.js', import.meta.url), 'utf8')
const tailFrameSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateTailFrameLink.js', import.meta.url), 'utf8')
const navigationGuardsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateNavigationGuards.js', import.meta.url), 'utf8')
const projectLoadSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateProjectLoad.js', import.meta.url), 'utf8')
const routeSyncSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateRouteSync.js', import.meta.url), 'utf8')
const taskPollingSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateTaskPolling.js', import.meta.url), 'utf8')
const mediaPreviewSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateMediaPreview.js', import.meta.url), 'utf8')
const taskRecoverySource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateTaskRecovery.js', import.meta.url), 'utf8')
const storyboardAccessorsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardAccessors.js', import.meta.url), 'utf8')
const storyboardStateSyncSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardStateSync.js', import.meta.url), 'utf8')
const storyboardVideoFieldsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardVideoFields.js', import.meta.url), 'utf8')
const refImageDropSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateRefImageDrop.js', import.meta.url), 'utf8')
const stylePromptsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStylePrompts.js', import.meta.url), 'utf8')
const workspaceNavSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateWorkspaceNav.js', import.meta.url), 'utf8')
const aiConfigWorkspaceSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateAiConfigWorkspace.js', import.meta.url), 'utf8')
const deliveryActionsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateDeliveryActions.js', import.meta.url), 'utf8')
const scriptEstimatesSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateScriptEstimates.js', import.meta.url), 'utf8')
const taskCancelSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateTaskCancel.js', import.meta.url), 'utf8')
const scriptDraftSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateScriptDraft.js', import.meta.url), 'utf8')
const resourceGenerateSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateResourceGenerate.js', import.meta.url), 'utf8')
const actionLogSource = readFileSync(new URL('../src/utils/filmCreateActionLog.js', import.meta.url), 'utf8')
const source = pipelineRunSource + '\n' + pipelineStagesSource + '\n' + batchGenerationSource + '\n' + episodeComposeSource + '\n' + storyboardImageGenerationSource + '\n' + storyboardVideoGenerationSource + '\n' + tailFrameSource + '\n' + linkedRegenSource + '\n' + navigationGuardsSource + '\n' + projectLoadSource + '\n' + routeSyncSource + '\n' + taskPollingSource + '\n' + mediaPreviewSource + '\n' + taskRecoverySource + '\n' + storyboardAccessorsSource + '\n' + storyboardStateSyncSource + '\n' + storyboardVideoFieldsSource + '\n' + refImageDropSource + '\n' + stylePromptsSource + '\n' + workspaceNavSource + '\n' + aiConfigWorkspaceSource + '\n' + deliveryActionsSource + '\n' + scriptEstimatesSource + '\n' + taskCancelSource + '\n' + scriptDraftSource + '\n' + resourceGenerateSource + '\n' + actionLogSource + '\n' + filmCreateSource + '\n' + mediaComposableSource
const resourcePanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')
const filmCreateUiSource = source + '\n' + resourcePanelSource

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('storyboard media loaders delegate cache and endpoint state to the race-safe controller', () => {
  const loader = sourceBetween(
    'async function loadStoryboardMedia',
    'async function loadSingleStoryboardMedia',
  )
  const singleLoader = sourceBetween(
    'async function loadSingleStoryboardMedia',
    'function captureStoryboardMediaRefresh',
  )

  assert.match(source, /createStoryboardMediaStateController/)
  assert.match(source, /const storyboardMediaStateController = createStoryboardMediaStateController\(/)
  assert.match(loader, /storyboardMediaStateController\.beginFull\(/)
  assert.match(loader, /storyboardMediaStateController\.commitSuccess\(/)
  assert.match(loader, /storyboardMediaStateController\.commitFailure\(/)
  assert.match(singleLoader, /storyboardMediaStateController\.beginSingle\(/)
  assert.match(singleLoader, /storyboardMediaStateController\.commitSuccess\(/)
  assert.match(singleLoader, /storyboardMediaStateController\.commitFailure\(/)
  assert.doesNotMatch(source, /let storyboardMediaLoadRequestId =/)

  assert.match(
    source,
    /v-if="projectDependencyWarning \|\| storyboardMediaLoadError"[\s\S]*storyboardMediaLoadError[\s\S]*@click="retryProjectDependencies"/,
  )
})

test('paid storyboard generation paths fail closed until media reload succeeds', () => {
  assert.match(source, /const storyboardMediaActionReason = computed\(\(\) =>/)
  assert.match(
    source,
    /const productionPipelineActionDisabledReason = computed\(\(\) => \([\s\S]*storyboardMediaActionReason\.value/,
  )
  assert.match(
    source,
    /const batchActionDisabledReason = computed\(\(\) => \([\s\S]*storyboardMediaActionReason\.value/,
  )

  for (const [startMarker, endMarker] of [
    ['async function startBatchImageGeneration', 'async function startBatchVideoGeneration'],
    ['async function startBatchVideoGeneration', 'function getFinalizeMergeOptions'],
    ['async function startOneClickPipeline', 'async function startTextFrameworkPipeline'],
    ['async function startRepairPipeline', '/** 修复缺失'],
  ]) {
    const handler = sourceBetween(startMarker, endMarker)
    assert.match(handler, /if \(storyboardMediaActionReason\.value\) \{[\s\S]*ElMessage\.warning\(storyboardMediaActionReason\.value\)[\s\S]*return/)
  }

  assert.match(source, /loadStoryboardMedia\(\{ failClosed: true \}\)/)
})

test('every storyboard Provider write has the same immediate synchronous assertion', () => {
  assert.match(
    source,
    /function assertStoryboardMediaReady\(\) \{[\s\S]*storyboardMediaStateController\.assertReady\(/,
  )

  const providerWrites = [...source.matchAll(/(?:imagesAPI|videosAPI)\.create/g)]
  assert.equal(providerWrites.length, 10)
  for (const write of providerWrites) {
    const prefix = source.slice(Math.max(0, write.index - 100), write.index)
    assert.match(
      prefix,
      /assertStoryboardMediaReady\(\)\s*(?:const res = await|return)\s*$/,
      `missing immediate media assertion before Provider write at source offset ${write.index}`,
    )
  }
})

test('linked-resource regeneration checks entry, confirmation, loop, and fail-closed errors', () => {
  const linked = sourceBetween(
    'async function onRegenAffectedSbImages',
    'return {\n    onRegenAffectedSbImages',
  )
  const confirmation = linked.indexOf('await ElMessageBox.confirm')
  const loop = linked.indexOf('for (let i = 0; i < affectedBoards.length; i++)')
  const providerWrite = linked.indexOf('imagesAPI.create')
  const assertions = [...linked.matchAll(/assertStoryboardMediaReady\(\)/g)].map((match) => match.index)

  assert.ok(assertions.some((index) => index < confirmation), 'must check before confirmation')
  assert.ok(assertions.some((index) => index > confirmation && index < loop), 'must recheck after confirmation')
  assert.ok(assertions.some((index) => index > loop && index < providerWrite), 'must check during the loop')
  assert.match(linked, /if \(isStoryboardMediaStateError\(e\)\) throw e/)
  assert.match(
    filmCreateUiSource,
    /<ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">/,
  )
})

test('batch workers and pipeline retries stop rather than aggregate media-state failures', () => {
  const batchImage = sourceBetween(
    'async function startBatchImageGeneration',
    'async function startBatchVideoGeneration',
  )
  const batchVideo = sourceBetween(
    'async function startBatchVideoGeneration',
    'function getFinalizeMergeOptions',
  )
  const retry = sourceBetween(
    'async function pipelineWithRetry',
    'async function confirmProductionPipelineCost',
  )

  assert.match(batchImage, /if \(isStoryboardMediaStateError\(e\)\) throw e/)
  assert.match(batchVideo, /if \(isStoryboardMediaStateError\(e\)\) throw e/)
  assert.match(retry, /isStoryboardMediaStateError/)
  assert.match(retry, /throw mediaStateError/)
})

test('project and episode transitions reset the controller context', () => {
  const episodeApply = sourceBetween(
    'function applySelectedEpisode',
    'async function refreshProjectDependencies',
  )
  const routeApply = sourceBetween(
    'function applyRouteToStore',
    'onMounted(async () =>',
  )

  assert.match(episodeApply, /resetStoryboardMediaContext\(/)
  assert.match(routeApply, /resetStoryboardMediaContext\(/)
})

test('initial project load aligns the controller with the selected episode before media requests', () => {
  const loadDrama = sourceBetween(
    'async function loadDrama',
    'async function retryFilmProjectLoad',
  )
  const alignContext = loadDrama.indexOf('ensureStoryboardMediaContext(')
  const refreshMedia = loadDrama.indexOf('await refreshProjectDependencies(')

  assert.ok(alignContext >= 0, 'loadDrama must align the selected episode context')
  assert.ok(refreshMedia > alignContext, 'context must be aligned before media requests start')
})

test('paid pipelines recheck media after asynchronous preflight before submitting work', () => {
  const batchVideoStart = sourceBetween(
    'async function startBatchVideoGeneration',
    'function getFinalizeMergeOptions',
  )
  const videoPreflight = batchVideoStart.indexOf('await refreshVideoGenerationCapability()')
  const videoRecheck = batchVideoStart.indexOf('if (storyboardMediaActionReason.value)', videoPreflight)
  assert.ok(videoPreflight >= 0 && videoRecheck > videoPreflight)

  for (const [startMarker, endMarker] of [
    ['async function startOneClickPipeline', 'async function startTextFrameworkPipeline'],
    ['async function startRepairPipeline', '/** 修复缺失'],
  ]) {
    const starter = sourceBetween(startMarker, endMarker)
    const readiness = starter.indexOf('await refreshProductionReadiness()')
    const readinessRecheck = starter.indexOf('if (storyboardMediaActionReason.value)', readiness)
    const confirmation = starter.indexOf('await confirmProductionPipelineCost()')
    const confirmationRecheck = starter.indexOf('if (storyboardMediaActionReason.value)', confirmation)
    assert.ok(readiness >= 0 && readinessRecheck > readiness)
    assert.ok(confirmation >= 0 && confirmationRecheck > confirmation)
  }

  const oneClickRun = sourceBetween(
    'async function runOneClickPipeline',
    'async function startRepairPipeline',
  )
  const repairRun = sourceBetween(
    'async function runRepairPipeline',
    'function hasActivePipelineWork',
  )
  assert.match(
    oneClickRun,
    /try \{\s*if \(!textOnly && storyboardMediaActionReason\.value\) throw new Error\(storyboardMediaActionReason\.value\)/,
  )
  assert.match(
    repairRun,
    /await loadDrama\(\)\s*if \(storyboardMediaActionReason\.value\) throw new Error\(storyboardMediaActionReason\.value\)/,
  )

  const pauseCheck = sourceBetween('async function checkPause', '/** 每生成好一个图片')
  const ownedRun = sourceBetween('async function executeOwnedPipelineRun', 'async function startOneClickPipeline')
  assert.match(source, /let pipelineRequiresStoryboardMedia = false/)
  assert.match(
    pauseCheck,
    /pipelineRequiresStoryboardMedia && storyboardMediaActionReason\.value[\s\S]*throw new Error\(storyboardMediaActionReason\.value\)/,
  )
  assert.match(ownedRun, /requireStoryboardMedia = false/)
  assert.match(ownedRun, /pipelineRequiresStoryboardMedia = requireStoryboardMedia/)
  assert.match(
    source,
    /executeOwnedPipelineRun\(\s*\(\) => runOneClickPipeline\(false\),\s*\{ requireStoryboardMedia: true \},?\s*\)/,
  )
  assert.match(source, /executeOwnedPipelineRun\(runRepairPipeline, \{ requireStoryboardMedia: true \}\)/)
  assert.match(source, /executeOwnedPipelineRun\(\(\) => runOneClickPipeline\(true\)\)/)
})

test('single and batch video submission defer selection clearing until Provider acceptance', () => {
  const single = sourceBetween(
    'async function onGenerateSbVideo',
    'async function onLinkTailFrameToNext',
  )
  const batch = sourceBetween(
    'async function startBatchVideoGeneration',
    'function getFinalizeMergeOptions',
  )

  assert.match(source, /submitStoryboardVideoAfterAccepted/)
  assert.match(single, /await submitStoryboardVideoAfterAccepted\(\{[\s\S]*createVideo:[\s\S]*videosAPI\.create/)
  assert.match(batch, /await submitStoryboardVideoAfterAccepted\(\{[\s\S]*createVideo:[\s\S]*videosAPI\.create/)
})

test('task recovery and polling callbacks capture their original storyboard-media context', () => {
  const recovery = sourceBetween(
    'async function recoverAndSyncEpisodeTasks',
    '// 任务恢复结束',
  )
  const singleLoader = sourceBetween(
    'async function loadSingleStoryboardMedia',
    'function captureStoryboardMediaRefresh',
  )

  assert.match(recovery, /const mediaContext = currentStoryboardMediaContext\(did, eid\)/)
  assert.match(recovery, /onStoryboardMedia: \(sbId\) => loadSingleStoryboardMedia\(sbId, mediaContext\)/)
  assert.match(recovery, /onDramaRefresh: captureDramaRefresh\(mediaContext\)/)
  assert.match(singleLoader, /if \(!sbId \|\| !expectedContext\) return \{ stale: true \}/)
  assert.match(singleLoader, /isCurrentContext\(expectedContext\)/)
  assert.match(singleLoader, /currentEpisodeStoryboardIds\(\)/)
  assert.match(source, /pollTask\([\s\S]*?captureStoryboardMediaRefresh\(/)
  assert.match(source, /pollTaskWithPause\([\s\S]*?captureStoryboardMediaRefresh\(/)
  assert.match(source, /pollTaskWithPause\([\s\S]*?captureDramaRefresh\(\)/)
})

test('a late media failure leaves the selected video untouched and prevents all writes', async () => {
  const context = { projectId: 7, episodeId: 71 }
  const controller = createStoryboardMediaStateController()
  controller.setContext(context)
  const initial = controller.beginFull([101])
  for (const request of initial) controller.commitSuccess(request, [])

  let providerWrites = 0
  let backendClearWrites = 0
  let selectedVideoId = 99
  let releaseSubmission
  const submissionGate = new Promise((resolve) => { releaseSubmission = resolve })
  const submission = submitStoryboardVideoAfterAccepted({
    createVideo: async () => {
      await submissionGate
      controller.assertReady(context)
      providerWrites += 1
      return { task_id: 'should-not-exist' }
    },
    clearSelection: () => { selectedVideoId = null },
    clearPersistedSelection: async () => { backendClearWrites += 1 },
  })

  const lateRefresh = controller.beginSingle(101, {
    expectedContext: context,
    storyboardIds: [101],
  })
  controller.commitFailure(
    lateRefresh.find((request) => request.endpoint === 'images'),
    new Error('late image failure'),
  )
  controller.commitSuccess(
    lateRefresh.find((request) => request.endpoint === 'videos'),
    [],
  )
  releaseSubmission()

  await assert.rejects(submission, (error) => isStoryboardMediaStateError(error))
  assert.equal(providerWrites, 0)
  assert.equal(backendClearWrites, 0)
  assert.equal(selectedVideoId, 99)
})
