import test from 'node:test'
import assert from 'node:assert/strict'

import { h } from 'vue'

import {
  SOURCE_OCR_NEXT_STEP_LABEL,
} from '../src/utils/sourceWorkflowState.js'
import {
  buttonByText,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
} from './helpers/vueComponentHarness.js'
import {
  SOURCE_INTAKE_EMPTY_FOCUS_LABEL,
  buildSourceIntakeEmptyRecordsView,
} from '../src/components/sourceIntake/sourceIntakeEmptyState.js'

const emptyUrl = new URL('../src/components/sourceIntake/SourceIntakeEmptyRecords.vue', import.meta.url)
const SourceIntakeEmptyRecords = await loadCompiledSfc(emptyUrl, 'source-intake-empty-records')
const renderer = createHostRenderer()

function mountEmpty(view, events = []) {
  return {
    ...mountHarness(renderer, () => h(SourceIntakeEmptyRecords, {
      ...view,
      onFocusForm: () => events.push('focus-form'),
      onOpenExtractionAiConfig: (serviceType) => events.push(['open-extraction-ai-config', serviceType]),
    })),
    events,
  }
}

test('空记录态可聚焦表单，失败时引导到 AI 配置', () => {
  const empty = mountEmpty(buildSourceIntakeEmptyRecordsView({
    emptyState: { title: '还没有已导入素材', description: '保存成功的网页、文件和文本素材会显示在这里。' },
    workflowModeShortLabel: '草稿预演',
  }))
  try {
    const text = textContent(empty.root)
    assert.match(text, /还没有已导入素材/)
    assert.match(text, /导入故事素材/)
    assert.doesNotMatch(text, /导入未完成/)
    buttonByText(empty.root, SOURCE_INTAKE_EMPTY_FOCUS_LABEL).props.onClick()
    assert.deepEqual(empty.events, ['focus-form'])
  } finally {
    empty.app.unmount()
  }

  const failed = mountEmpty(buildSourceIntakeEmptyRecordsView({
    emptyState: { title: '还没有已导入素材', description: '当前输入尚未保存。' },
    workflowModeShortLabel: '草稿预演',
    operationError: '图片识别失败。请到「AI 配置」添加「图片识别」服务，或先使用本机 Tesseract。',
    extractionNextStep: {
      kind: 'ocr',
      serviceType: 'ocr',
      actionLabel: SOURCE_OCR_NEXT_STEP_LABEL,
      extraHint: '也可先安装本机 Tesseract。',
    },
  }))
  try {
    const text = textContent(failed.root)
    assert.match(text, /导入未完成/)
    assert.match(text, /下一步|图片识别|AI 配置/)
    assert.doesNotMatch(text, /service_type=ocr/)
    buttonByText(failed.root, SOURCE_OCR_NEXT_STEP_LABEL).props.onClick()
    assert.deepEqual(failed.events, [['open-extraction-ai-config', 'ocr']])
  } finally {
    failed.app.unmount()
  }
})
