import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const sidebarUrl = new URL('../src/components/promptEditor/PromptEditorSidebar.vue', import.meta.url)
const paneUrl = new URL('../src/components/promptEditor/PromptEditorPane.vue', import.meta.url)
const parentUrl = new URL('../src/components/PromptEditor.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Edit', 'Lock'])
const PromptEditorSidebar = await loadCompiledSfc(sidebarUrl, 'prompt-editor-sidebar', new Map([['vue', vueUrl]]))
const PromptEditorPane = await loadCompiledSfc(
  paneUrl,
  'prompt-editor-pane',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function emitListener(listener, event) {
  if (Array.isArray(listener)) {
    for (const entry of listener) entry?.(event)
    return
  }
  listener?.(event)
}

function keydown(node, key) {
  const event = {
    key,
    preventDefault() { event.prevented = true },
    stopPropagation() {},
  }
  emitListener(node.props.onKeydown, event)
  if (key === 'Enter') emitListener(node.props.onKeydownEnter, event)
  if (key === ' ' || key === 'Spacebar') emitListener(node.props.onKeydownSpace, event)
  return event
}

const ElEmptyStub = defineComponent({
  name: 'ElEmptyStub',
  props: ['description'],
  setup(props, { slots }) {
    return () => h('empty', { role: 'status', 'data-description': props.description || '' }, [
      h('p', {}, props.description || ''),
      slots.default?.(),
    ])
  },
})

const ElAlertStub = defineComponent({
  name: 'ElAlertStub',
  props: ['type', 'title', 'showIcon', 'closable'],
  setup(props, { slots }) {
    return () => h('alert', { role: 'alert', 'data-type': props.type || '' }, [
      h('strong', {}, props.title || ''),
      slots.default?.(),
    ])
  },
})

test('侧栏用原生按钮选择提示词，非语义节点不承担点击', async () => {
  const selected = []
  const harness = mountHarness(renderer, () => h(PromptEditorSidebar, {
    prompts: [
      { key: 'story_system', label: '故事生成', is_customized: false },
      { key: 'frame_prompt', label: '帧提示词', is_customized: true },
    ],
    currentKey: 'story_system',
    isDirty: { frame_prompt: true },
    selectPrompt: (key) => selected.push(key),
  }))
  try {
    await nextTick()
    const buttons = findAll(harness.root, (node) => node.type === 'button')
    assert.equal(buttons.length, 2)
    assert.equal(buttons[0].props['aria-current'], 'true')
    assert.match(textContent(buttons[0]), /故事生成/)
    assert.match(textContent(buttons[1]), /帧提示词/)
    click(buttons[1])
    keydown(buttons[0], 'Enter')
    keydown(buttons[1], ' ')
    assert.deepEqual(selected, ['frame_prompt', 'story_system', 'frame_prompt'])
    const clickableDivs = findAll(harness.root, (node) => ['div', 'span'].includes(node.type) && node.props.onClick)
    assert.equal(clickableDivs.length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('编辑区在禁用保存和恢复时暴露中文原因', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(PromptEditorPane, {
    prompt: {
      key: 'story_system',
      label: '故事生成',
      description: '用于生成故事',
      default_body: '默认正文',
      locked_suffix: '{"ok":true}',
      is_customized: false,
    },
    body: '默认正文',
    saving: false,
    resetting: false,
    saveDisabledReason: '当前没有未保存的修改',
    resetDisabledReason: '当前已是系统默认提示词，无需恢复',
    'onUpdate:body': (value) => events.push(['body', value]),
    onSave: () => events.push(['save']),
    onReset: () => events.push(['reset']),
  }))
  try {
    await nextTick()
    assert.match(textContent(harness.root), /故事生成/)
    assert.match(textContent(harness.root), /JSON 格式要求（锁定，不可修改）/)
    const save = buttonByText(harness.root, '保存')
    const reset = buttonByText(harness.root, '恢复默认')
    assert.equal(save.props.disabled, true)
    assert.equal(save.props.title, '当前没有未保存的修改')
    assert.equal(save.props['aria-label'], '保存不可用：当前没有未保存的修改')
    assert.equal(reset.props.disabled, true)
    assert.equal(reset.props.title, '当前已是系统默认提示词，无需恢复')
    click(save)
    click(reset)
    assert.deepEqual(events, [['save'], ['reset']])
  } finally {
    harness.app.unmount()
  }
})

test('提示词页加载失败显示重试，成功空列表才显示空态', async () => {
  const apiState = {
    listImpl: async () => ({ prompts: [] }),
  }
  const promptsApiUrl = dataModule(`
    const apiState = globalThis.__promptEditorApiState
    export const promptsAPI = {
      list: (...args) => apiState.listImpl(...args),
      update: async () => {},
      reset: async () => {},
    }
  `)
  const feedbackUrl = dataModule(`
    export const ElMessage = { error() {}, success() {}, warning() {} }
    export const ElMessageBox = { async confirm() {} }
  `)
  globalThis.__promptEditorApiState = apiState
  const sidebarCompiled = compileSfc(sidebarUrl, 'prompt-editor-sidebar-parent', new Map([['vue', vueUrl]]))
  const paneCompiled = compileSfc(paneUrl, 'prompt-editor-pane-parent', new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]))
  const PromptEditor = await loadCompiledSfc(parentUrl, 'prompt-editor-page', new Map([
    ['vue', vueUrl],
    ['@/utils/elementPlusFeedback.js', feedbackUrl],
    ['@/api/prompts', promptsApiUrl],
    ['./promptEditor/PromptEditorSidebar.vue', sidebarCompiled],
    ['./promptEditor/PromptEditorPane.vue', paneCompiled],
  ]))

  apiState.listImpl = async () => { throw new Error('network') }
  const failed = mountHarness(renderer, () => h(PromptEditor), {
    components: { 'el-empty': ElEmptyStub, ElEmpty: ElEmptyStub, 'el-alert': ElAlertStub, ElAlert: ElAlertStub },
  })
  try {
    await nextTick()
    await Promise.resolve()
    await nextTick()
    assert.match(textContent(failed.root), /加载提示词失败/)
    assert.ok(buttonByAriaLabel(failed.root, '重新加载提示词'))
    assert.equal(textContent(failed.root).includes('暂无系统提示词'), false)
  } finally {
    failed.app.unmount()
  }

  apiState.listImpl = async () => ({ prompts: [] })
  const empty = mountHarness(renderer, () => h(PromptEditor), {
    components: { 'el-empty': ElEmptyStub, ElEmpty: ElEmptyStub, 'el-alert': ElAlertStub, ElAlert: ElAlertStub },
  })
  try {
    await nextTick()
    await Promise.resolve()
    await nextTick()
    assert.match(textContent(empty.root), /暂无系统提示词/)
    assert.ok(buttonByAriaLabel(empty.root, '重新加载提示词'))
  } finally {
    empty.app.unmount()
  }
})

test('页面仍通过 hasUnsavedChanges 暴露草稿，供 AI 配置页接线', () => {
  const source = readSource(parentUrl)
  assert.match(source, /function hasUnsavedChanges\(\)/)
  assert.match(source, /defineExpose\(\{[\s\S]*hasUnsavedChanges[\s\S]*\}\)/)
  assert.match(source, /<PromptEditorSidebar/)
  assert.match(source, /<PromptEditorPane/)
})
