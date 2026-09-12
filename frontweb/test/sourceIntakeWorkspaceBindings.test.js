import test from 'node:test'
import assert from 'node:assert/strict'
import { ref, unref } from 'vue'

import {
  createSourceIntakeWorkspaceBindings,
  createSourceIntakeWorkspaceComputeds,
} from '../src/components/sourceIntake/sourceIntakeWorkspaceBindings.js'
import {
  SOURCE_OCR_CONFIG_GUIDANCE,
  SOURCE_OCR_LOCAL_NEXT_STEP_HINT,
  SOURCE_OCR_NEXT_STEP_LABEL,
  SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE,
  SOURCE_TRANSCRIPTION_NEXT_STEP_LABEL,
  SOURCE_WORKFLOW_FAILURE_FALLBACK,
} from '../src/utils/sourceWorkflowState.js'

function failedRun(error, filename = 'scan.png') {
  return {
    id: 'run-failed',
    type: 'novel2anime',
    status: 'failed',
    error,
    steps: [
      {
        id: 1,
        step_key: 'source_intake',
        status: 'failed',
        error,
      },
    ],
  }
}

function createComputeds(overrides = {}) {
  return createSourceIntakeWorkspaceComputeds({
    form: { source_url: '', text: '', target_episode_count: 1 },
    sourceFile: ref(null),
    selectedFilename: ref(''),
    sourceFileReading: ref(false),
    sourceSaving: ref(false),
    sourceListRefreshing: ref(false),
    workflowStarting: ref(false),
    readinessChecking: ref(false),
    retrying: ref(false),
    pausing: ref(false),
    resuming: ref(false),
    cancelling: ref(false),
    loading: ref(false),
    qaRunning: ref(false),
    remediating: ref(false),
    pollState: ref('idle'),
    pollError: ref(''),
    sourceOperationError: ref(''),
    sourceListRefreshError: ref(''),
    workflowDataError: ref(''),
    sourceOperationMessage: ref(''),
    workflowMode: ref('draft'),
    productionReadiness: ref(null),
    selectedRun: ref(null),
    reports: ref([]),
    timeline: ref(null),
    sources: ref([]),
    selectedFlowStepId: ref('process'),
    getDrama: () => ({ episodes: [] }),
    ...overrides,
  })
}

test('处理失败会把图片识别下一步交给处理阶段', () => {
  const computeds = createComputeds({
    selectedRun: ref(failedRun(SOURCE_OCR_CONFIG_GUIDANCE, 'scan.png')),
    sources: ref([{ id: 11, original_filename: 'scan.png', title: 'scan.png' }]),
  })
  assert.deepEqual(unref(computeds.extractionNextStep), {
    kind: 'ocr',
    serviceType: 'ocr',
    actionLabel: SOURCE_OCR_NEXT_STEP_LABEL,
    extraHint: SOURCE_OCR_LOCAL_NEXT_STEP_HINT,
  })
  assert.match(unref(computeds.displayedRunError), /Tesseract/)

  const bindings = createSourceIntakeWorkspaceBindings({
    ...computeds,
    workflowHistoryExpanded: ref(false),
    workflowMode: ref('draft'),
    readinessChecking: ref(false),
    productionReadiness: ref(null),
    sourceFileReading: ref(false),
    sourceFile: ref(null),
    selectedFilename: ref('scan.png'),
    sourceOperationError: ref(''),
    sourceListRefreshError: ref(''),
    sourceListRefreshing: ref(false),
    sourceSaving: ref(false),
    workflowStarting: ref(false),
    startingSourceId: ref(null),
    selectedRun: ref(failedRun(SOURCE_OCR_CONFIG_GUIDANCE)),
    retrying: ref(false),
    pausing: ref(false),
    resuming: ref(false),
    cancelling: ref(false),
    sources: ref([{ id: 11, original_filename: 'scan.png' }]),
    qaRunning: ref(false),
    remediating: ref(false),
    remediationStatus: ref(''),
    sourceDetailVisible: ref(false),
    sourceDetailLoading: ref(false),
    sourceDetail: ref(null),
    getDrama: () => ({ episodes: [] }),
  })
  assert.equal(unref(bindings.processStageBindings).extractionNextStep.serviceType, 'ocr')
})

test('处理失败会把语音转写下一步交给处理阶段', () => {
  const computeds = createComputeds({
    selectedRun: ref(failedRun(SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE, 'talk.mp3')),
    sources: ref([{ id: 12, original_filename: 'talk.mp3', title: 'talk.mp3' }]),
  })
  assert.deepEqual(unref(computeds.extractionNextStep), {
    kind: 'transcription',
    serviceType: 'transcription',
    actionLabel: SOURCE_TRANSCRIPTION_NEXT_STEP_LABEL,
    extraHint: '',
  })
  assert.doesNotMatch(unref(computeds.displayedRunError), /Tesseract/)
})

test('媒体处理失败按文件类型给出抽取下一步，纯文本不给', () => {
  const ocrFallback = createComputeds({
    selectedRun: ref(failedRun(SOURCE_WORKFLOW_FAILURE_FALLBACK)),
    sources: ref([{ id: 13, original_filename: 'page.pdf' }]),
  })
  assert.equal(unref(ocrFallback.extractionNextStep).serviceType, 'ocr')

  const transcriptionFallback = createComputeds({
    selectedRun: ref(failedRun(SOURCE_WORKFLOW_FAILURE_FALLBACK)),
    sources: ref([{ id: 14, original_filename: 'clip.mp4' }]),
  })
  assert.equal(unref(transcriptionFallback.extractionNextStep).serviceType, 'transcription')

  const plain = createComputeds({
    selectedRun: ref(failedRun('\u5206\u955c\u8349\u7a3f\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5')),
    sources: ref([{ id: 15, original_filename: 'story.txt', title: 'story.txt' }]),
  })
  assert.equal(unref(plain.extractionNextStep), null)
})

test('导入失败会按 PDF/图片/音视频给出 AI 配置下一步', () => {
  const ocr = createComputeds({
    sourceOperationError: ref(SOURCE_OCR_CONFIG_GUIDANCE),
    selectedFilename: ref('scan.png'),
    sourceFile: ref({ name: 'scan.png', type: 'image/png' }),
  })
  assert.equal(unref(ocr.intakeExtractionNextStep).serviceType, 'ocr')

  const transcription = createComputeds({
    sourceOperationError: ref(SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE),
    selectedFilename: ref('talk.mp3'),
    sourceFile: ref({ name: 'talk.mp3', type: 'audio/mpeg' }),
  })
  assert.equal(unref(transcription.intakeExtractionNextStep).serviceType, 'transcription')

  const clean = createComputeds({
    sourceOperationError: ref(''),
    selectedFilename: ref('scan.png'),
    sourceFile: ref({ name: 'scan.png', type: 'image/png' }),
  })
  assert.equal(unref(clean.intakeExtractionNextStep), null)
})
