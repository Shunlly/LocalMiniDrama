import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SOURCE_OCR_CONFIG_GUIDANCE,
  SOURCE_OCR_NEXT_STEP_LABEL,
} from '../src/utils/sourceWorkflowState.js'
import {
  SOURCE_INTAKE_EMPTY_FOCUS_LABEL,
  buildSourceIntakeEmptyRecordsView,
} from '../src/components/sourceIntake/sourceIntakeEmptyState.js'

test('空记录态给出中文引导，失败时带上恢复说明和 AI 配置下一步', () => {
  const empty = buildSourceIntakeEmptyRecordsView({
    emptyState: {
      title: '还没有已导入素材',
      description: '保存成功的网页、文件和文本素材会显示在这里。',
    },
    workflowModeShortLabel: '草稿预演',
  })
  assert.equal(empty.title, '还没有已导入素材')
  assert.match(empty.hint, /导入故事素材/)
  assert.match(empty.hint, /导入并启动草稿预演/)
  assert.equal(empty.recoveryMessage, '')
  assert.equal(empty.extractionNextStep, null)
  assert.equal(empty.focusActionLabel, SOURCE_INTAKE_EMPTY_FOCUS_LABEL)
  assert.match(SOURCE_INTAKE_EMPTY_FOCUS_LABEL, /[\u4e00-\u9fff]/)

  const failed = buildSourceIntakeEmptyRecordsView({
    emptyState: { title: '还没有已导入素材', description: '当前输入尚未保存。' },
    workflowModeShortLabel: '正式制作',
    operationError: SOURCE_OCR_CONFIG_GUIDANCE,
    extractionNextStep: {
      kind: 'ocr',
      serviceType: 'ocr',
      actionLabel: SOURCE_OCR_NEXT_STEP_LABEL,
      extraHint: '也可先安装本机 Tesseract。',
    },
  })
  assert.match(failed.hint, /导入并启动正式制作/)
  assert.match(failed.recoveryMessage, /导入未完成/)
  assert.match(failed.recoveryMessage, /图片识别/)
  assert.equal(failed.extractionNextStep.serviceType, 'ocr')
  assert.doesNotMatch(failed.recoveryMessage, /service_type=ocr/)
})
