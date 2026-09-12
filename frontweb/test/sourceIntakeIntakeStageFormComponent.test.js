import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick, reactive } from 'vue'

import {
  SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE,
  SOURCE_OCR_CONFIG_GUIDANCE,
  SOURCE_OCR_LOCAL_NEXT_STEP_HINT,
  SOURCE_OCR_NEXT_STEP_LABEL,
  SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE,
  SOURCE_TRANSCRIPTION_NEXT_STEP_LABEL,
} from '../src/utils/sourceWorkflowState.js'
import {
  actionGateReasons,
  buttonByText,
  compileSfc,
  createHostRenderer,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const panelUrl = new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url)
const formUrl = new URL('../src/components/sourceIntake/SourceIntakeIntakeStageForm.vue', import.meta.url)
const textPanelUrl = new URL('../src/components/sourceIntake/SourceIntakeSourceTextPanel.vue', import.meta.url)
const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const compiledActionGateUrl = compileSfc(actionGateUrl, 'source-intake-intake-form-action-gate', new Map([['vue', vueUrl]]))
const compiledTextPanelUrl = compileSfc(textPanelUrl, 'source-intake-source-text-panel', new Map([['vue', vueUrl]]))
const SourceIntakeIntakeStageForm = await loadCompiledSfc(
  formUrl,
  'source-intake-intake-stage-form',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
    ['@/components/sourceIntake/SourceIntakeSourceTextPanel.vue', compiledTextPanelUrl],
    ['@/utils/sourceWorkflowState.js', new URL('../src/utils/sourceWorkflowState.js', import.meta.url).href],
  ]),
)
const renderer = createHostRenderer()
const formStubs = {
  'el-form': defineComponent({
    name: 'ElFormStub',
    setup(_props, { slots }) {
      return () => h('form', { 'data-el-form': 'true' }, slots.default?.())
    },
  }),
  'el-form-item': defineComponent({
    name: 'ElFormItemStub',
    props: ['label', 'error'],
    setup(props, { slots }) {
      return () => h('form-item', {
        label: props.label,
        error: props.error,
      }, [
        props.label ? h('span', {}, props.label) : null,
        slots.default?.(),
        props.error ? h('span', { class: 'field-error' }, props.error) : null,
      ])
    },
  }),
}
formStubs.ElForm = formStubs['el-form']
formStubs.ElFormItem = formStubs['el-form-item']
const panelSource = readFileSync(panelUrl, 'utf8')
const formSource = readFileSync(formUrl, 'utf8')

function sampleForm(overrides = {}) {
  return {
    title: '',
    source_type: '',
    target_episode_count: 1,
    source_url: '',
    text: '',
    ...overrides,
  }
}

function mountForm(initial = {}) {
  const form = reactive(sampleForm(initial.form))
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeIntakeStageForm, {
    modelValue: form,
    'onUpdate:modelValue': (value) => {
      Object.assign(form, value)
    },
    sourceTypeOptions: initial.sourceTypeOptions || [
      { label: '\u5c0f\u8bf4', value: 'novel' },
      { label: '\u5267\u672c', value: 'script' },
    ],
    sourceUrlValidationMessage: initial.sourceUrlValidationMessage || '',
    sourceFileAccept: '.txt,.md,.pdf',
    sourceFileReading: Boolean(initial.sourceFileReading),
    sourceUploadBusyReason: initial.sourceUploadBusyReason || '',
    sourceFile: initial.sourceFile || null,
    selectedFilename: initial.selectedFilename || '',
    sourceIntakeMediaHelp: initial.sourceIntakeMediaHelp || '\u5a92\u4f53\u5e2e\u52a9',
    sourceOperationStatus: initial.sourceOperationStatus || '',
    sourceOperationError: initial.sourceOperationError || '',
    sourceListRefreshError: initial.sourceListRefreshError || '',
    sourceListRetryReason: initial.sourceListRetryReason || '',
    sourceListRefreshing: Boolean(initial.sourceListRefreshing),
    sourceSaving: Boolean(initial.sourceSaving),
    actionReasons: initial.actionReasons || { import: '', start: '' },
    workflowModeShortLabel: initial.workflowModeShortLabel || '\u8349\u7a3f\u9884\u6f14',
    workflowStarting: Boolean(initial.workflowStarting),
    startingSourceId: initial.startingSourceId ?? null,
    workflowStartButtonLabel: initial.workflowStartButtonLabel || '\u5bfc\u5165\u5e76\u542f\u52a8 \u8349\u7a3f\u9884\u6f14',
    onSourceFileChange: (event) => events.push(['source-file-change', event]),
    onClearSelectedFile: () => events.push('clear-selected-file'),
    onRefreshImportedSources: () => events.push('refresh-imported-sources'),
    onImportSource: () => events.push('import-source'),
    onStartWorkflow: () => events.push('start-workflow'),
    onOpenExtractionAiConfig: (serviceType) => events.push(['open-extraction-ai-config', serviceType]),
  }), { components: formStubs })
  return { ...mounted, events, form }
}

function inputByAriaLabel(root, label) {
  return findByType(root, 'input').find((node) => node.props?.['aria-label'] === label)
}

test('\u7236\u9762\u677f\u628a intake \u8868\u5355\u4ea4\u7ed9\u5b50\u7ec4\u4ef6\uff0c\u5e76\u7ee7\u7eed\u7ed1\u5b9a\u540c\u4e00 form \u5b57\u6bb5\u4e0e\u4e0a\u4f20/\u542f\u52a8\u4e8b\u4ef6', () => {
  assert.match(panelSource, /<SourceIntakeIntakeStageForm/)
  assert.match(panelSource, /v-model="form"/)
  assert.match(panelSource, /@source-file-change="handleSourceFile"/)
  assert.match(panelSource, /@start-workflow="startWorkflow"/)
  assert.match(panelSource, /@import-source="importSourceOnly"/)
  assert.match(panelSource, /<SourceIntakeStepper/)
  assert.match(panelSource, /<SourceIntakeLaunchModeCard/)
  assert.match(panelSource, /<SourceIntakeCurrentStageCard/)
  assert.doesNotMatch(panelSource, /class="intake-form"/)
  assert.match(formSource, /v-model="form\.source_type"/)
  assert.match(formSource, /:aria-label="sourceUploadBusyReason \|\| '选择故事素材文件'"/)

  assert.match(formSource, /ref="sourceUrlInput"[\s\S]*v-model="form\.source_url"/)
  assert.match(formSource, /<SourceIntakeSourceTextPanel v-model:text="form\.text" \/>/)
  assert.match(panelSource, /@open-extraction-ai-config="openAiConfigForExtraction"/)
  assert.match(formSource, /resolveSourceIntakeExtractionNextStep/)
})

test('\u7d20\u6750\u7c7b\u578b\u3001URL \u548c\u539f\u59cb\u6587\u672c\u4ecd\u5199\u5165\u540c\u4e00 form \u5bf9\u8c61', async () => {
  const harness = mountForm({
    form: { title: '\u539f\u6807\u9898', source_url: 'https://old.example', text: '\u65e7\u6587\u672c' },
  })
  try {
    const select = findByType(harness.root, 'select')[0]
    assert.equal(select.props['aria-label'], '\u7d20\u6750\u7c7b\u578b')
    assert.equal(select.props.value, '')
    select.props.onChange({ target: { value: 'novel' } })
    await nextTick()
    assert.equal(harness.form.source_type, 'novel')

    const urlInput = inputByAriaLabel(harness.root, '\u7f51\u9875 URL')
    assert.ok(urlInput)
    assert.equal(urlInput.props.value, 'https://old.example')
    urlInput.props.onInput({ target: { value: 'https://example.com/story' } })
    await nextTick()
    assert.equal(harness.form.source_url, 'https://example.com/story')

    const textInput = inputByAriaLabel(harness.root, '\u539f\u59cb\u7d20\u6750')
    assert.ok(textInput)
    textInput.props.onInput({ target: { value: '\u65b0\u7684\u6545\u4e8b\u6587\u672c' } })
    await nextTick()
    assert.equal(harness.form.text, '\u65b0\u7684\u6545\u4e8b\u6587\u672c')

    const titleInput = inputByAriaLabel(harness.root, '\u6545\u4e8b\u7d20\u6750\u6807\u9898')
    titleInput.props.onInput({ target: { value: '\u65b0\u6807\u9898' } })
    await nextTick()
    assert.equal(harness.form.title, '\u65b0\u6807\u9898')

    const episodeInput = findByType(harness.root, 'input').find((node) => node.props?.['aria-label'] === '\u76ee\u6807\u96c6\u6570')
    assert.equal(episodeInput.props.value, 1)
  } finally {
    harness.app.unmount()
  }
})

test('\u4e0a\u4f20\u6587\u4ef6\u53d8\u66f4\u548c\u542f\u52a8\u6d41\u7a0b\u4e8b\u4ef6\u4ecd\u4ea4\u7ed9\u7236\u7ea7', () => {
  const harness = mountForm()
  try {
    const fileInput = findByType(harness.root, 'input').find((node) => node.props.type === 'file')
    assert.ok(fileInput)
    assert.equal(fileInput.props.accept, '.txt,.md,.pdf')
    const changeEvent = { target: { files: [{ name: 'story.txt' }] } }
    fileInput.props.onChange(changeEvent)
    assert.deepEqual(harness.events, [['source-file-change', changeEvent]])

    buttonByText(harness.root, '\u5bfc\u5165\u6545\u4e8b\u7d20\u6750').props.onClick()
    buttonByText(harness.root, '\u5bfc\u5165\u5e76\u542f\u52a8 \u8349\u7a3f\u9884\u6f14').props.onClick()
    assert.deepEqual(harness.events, [
      ['source-file-change', changeEvent],
      'import-source',
      'start-workflow',
    ])
  } finally {
    harness.app.unmount()
  }
})

test('\u5df2\u9009\u6587\u4ef6\u53ef\u79fb\u9664\uff0cURL \u6821\u9a8c\u9519\u8bef\u548c\u5fd9\u65f6\u7981\u7528\u539f\u56e0\u4fdd\u6301\u4e2d\u6587', () => {
  const busy = '\u6b63\u5728\u8bfb\u53d6\u7d20\u6750\u6587\u4ef6\uff0c\u8bf7\u7a0d\u5019\u3002'
  const urlError = '\u8bf7\u8f93\u5165\u5b8c\u6574\u7684 http:// \u6216 https:// \u7f51\u9875\u5730\u5740\u3002'
  const harness = mountForm({
    sourceFile: { name: 'story.txt' },
    selectedFilename: 'story.txt',
    sourceUrlValidationMessage: urlError,
    sourceUploadBusyReason: busy,
    actionReasons: {
      import: busy,
      start: busy,
    },
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /story\.txt/)
    assert.match(text, /http:\/\/ \u6216 https:\/\//)
    const urlItem = findByType(harness.root, 'form-item').find((node) => node.props.label === '\u7f51\u9875 URL')
    assert.equal(urlItem.props.error, urlError)
    buttonByText(harness.root, '\u79fb\u9664').props.onClick()
    assert.deepEqual(harness.events, ['clear-selected-file'])
    assert.equal(Boolean(buttonByText(harness.root, '\u5bfc\u5165\u6545\u4e8b\u7d20\u6750').props.disabled), true)
    assert.equal(Boolean(buttonByText(harness.root, '\u5bfc\u5165\u5e76\u542f\u52a8 \u8349\u7a3f\u9884\u6f14').props.disabled), true)
    assert.ok(actionGateReasons(harness.root).includes(busy))
  } finally {
    harness.app.unmount()
  }
})

test('PDF/图片失败展示可点击的图片识别下一步，并保留本机 Tesseract 提示', () => {
  const harness = mountForm({
    selectedFilename: 'scan.png',
    sourceFile: { name: 'scan.png', type: 'image/png' },
    sourceOperationError: SOURCE_OCR_CONFIG_GUIDANCE,
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /下一步/)
    assert.ok(text.includes(SOURCE_OCR_NEXT_STEP_LABEL))
    assert.ok(text.includes(SOURCE_OCR_LOCAL_NEXT_STEP_HINT))
    assert.doesNotMatch(text, /service_type=ocr/)
    const button = buttonByText(harness.root, SOURCE_OCR_NEXT_STEP_LABEL)
    assert.ok(button)
    assert.equal(button.props['aria-label'], SOURCE_OCR_NEXT_STEP_LABEL)
    button.props.onClick()
    assert.deepEqual(harness.events, [['open-extraction-ai-config', 'ocr']])
  } finally {
    harness.app.unmount()
  }
})

test('音视频失败展示语音转写下一步，不提示 Tesseract', () => {
  const harness = mountForm({
    selectedFilename: 'talk.mp3',
    sourceFile: { name: 'talk.mp3', type: 'audio/mpeg' },
    sourceOperationError: SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE,
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /下一步/)
    assert.doesNotMatch(text, /Tesseract/)
    buttonByText(harness.root, SOURCE_TRANSCRIPTION_NEXT_STEP_LABEL).props.onClick()
    assert.deepEqual(harness.events, [['open-extraction-ai-config', 'transcription']])
  } finally {
    harness.app.unmount()
  }
})

test('非抽取失败给出中文下一步，但不给 AI 配置按钮', () => {
  const cases = [
    { sourceOperationError: '素材列表加载失败', selectedFilename: 'scan.png', next: /刷新列表/ },
    { sourceOperationError: SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE, selectedFilename: 'scan.png', next: /改用支持的文件格式/ },
    { sourceOperationError: '暂时无法检查正式制作能力，请稍后重试。', selectedFilename: 'scan.png', next: /草稿预演/ },
  ]
  for (const initial of cases) {
    const harness = mountForm(initial)
    try {
      const text = textContent(harness.root)
      assert.equal(buttonByText(harness.root, SOURCE_OCR_NEXT_STEP_LABEL), undefined, initial.sourceOperationError)
      assert.match(text, /下一步/)
      assert.match(text, initial.next)
    } finally {
      harness.app.unmount()
    }
  }
})
