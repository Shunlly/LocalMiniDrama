import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick, reactive, ref } from 'vue'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const infoSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailInfoCard.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const autosaveSource = readFileSync(new URL('../src/components/dramaDetail/dramaDetailInfoAutosave.js', import.meta.url), 'utf8')
const infoUrl = new URL('../src/components/dramaDetail/DramaDetailInfoCard.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Loading', 'WarningFilled'])
const DramaDetailInfoCard = await loadCompiledSfc(
  infoUrl,
  'drama-detail-info-card-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)


const ElSelectWithChange = defineComponent({
  name: 'ElSelectStub',
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      onChange: (event) => {
        const value = event?.target?.value ?? event
        emit('update:modelValue', value)
        emit('change', value)
      },
    }, slots.default?.())
  },
})

const renderer = createHostRenderer()
const formStubs = {
  'el-form': defineComponent({
    setup(_props, { slots }) {
      return () => h('form', {}, slots.default?.())
    },
  }),
  'el-form-item': defineComponent({
    props: ['label'],
    setup(props, { slots }) {
      return () => h('label', { 'data-label': props.label || '' }, [props.label, slots.default?.()])
    },
  }),
  'el-row': defineComponent({
    setup(_props, { slots }) {
      return () => h('div', {}, slots.default?.())
    },
  }),
  'el-col': defineComponent({
    setup(_props, { slots }) {
      return () => h('div', {}, slots.default?.())
    },
  }),
  'el-option-group': defineComponent({
    props: ['label'],
    setup(props, { slots }) {
      return () => h('optgroup', { label: props.label || '' }, slots.default?.())
    },
  }),
}

function mountInfo(initial = {}) {
  const infoForm = reactive({
    title: '本地短剧',
    description: '',
    genre: '',
    style: '',
    aspect_ratio: '16:9',
    ...initial.infoForm,
  })
  const props = ref({
    infoForm,
    infoSaveState: 'saved',
    infoSaveScheduled: false,
    infoSaveStatusLabel: '已保存',
    ...initial,
    infoForm,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(DramaDetailInfoCard, {
    ...props.value,
    onSave: () => events.push('save'),
    onRetrySave: () => events.push('retry-save'),
  }), { components: {
    ...formStubs,
    ElSelect: ElSelectWithChange,
    'el-select': ElSelectWithChange,
  } })
  return { ...mounted, events, props, infoForm }
}

test('DramaDetail 把剧集信息卡交给独立组件，保存仍由页面处理', () => {
  assert.match(pageSource, /<DramaDetailInfoCard/)
  assert.match(pageSource, /:info-form="infoForm"/)
  assert.match(pageSource, /@save="saveInfo"/)
  assert.match(pageSource, /@retry-save="retryInfoSave"/)
  assert.match(pageSource, /createDramaDetailInfoAutosave\(/)
  assert.match(pageSource, /saveInfo,/)
  assert.match(pageSource, /retryInfoSave,/)
  assert.match(autosaveSource, /function saveInfo\(\)/)
  assert.match(autosaveSource, /async function retryInfoSave\(\)/)
  assert.match(infoSource, /剧集信息/)
  assert.match(infoSource, /class="info-save-status"/)
  assert.match(infoSource, /aria-label="剧集标题"/)
  assert.match(infoSource, /aria-label="图片\/视频风格"/)
  assert.match(infoSource, /aria-label="画面比例"/)
  assert.match(infoSource, /aria-label="故事梗概"/)
})

test('保存失败时信息卡可重试且不把方法搬进组件', async () => {
  const harness = mountInfo({
    infoSaveState: 'error',
    infoSaveStatusLabel: '保存失败',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /剧集信息/)
    const retry = buttonByText(harness.root, '重试')
    assert.ok(retry, '缺少信息保存重试')
    click(retry)
    assert.deepEqual(harness.events, ['retry-save'])
    assert.doesNotMatch(infoSource, /function saveInfo\(/)
    assert.doesNotMatch(infoSource, /function retryInfoSave\(/)
  } finally {
    harness.app.unmount()
  }
})


test('标题失焦和风格变更会触发保存；保存中不出现重试', async () => {
  const harness = mountInfo({
    infoSaveState: 'saving',
    infoSaveScheduled: true,
    infoSaveStatusLabel: '正在保存',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /正在保存/)
    assert.equal(buttonByText(harness.root, '重试'), undefined)
    const title = findAll(harness.root, (node) => node.props?.['aria-label'] === '剧集标题')[0]
    assert.ok(title)
    title.props.onBlur()
    const style = findAll(harness.root, (node) => node.type === 'select' && node.props?.['aria-label'] === '图片/视频风格')[0]
    assert.ok(style)
    style.props.onChange({ target: { value: 'cinematic' } })
    assert.equal(harness.infoForm.style, 'cinematic')
    assert.deepEqual(harness.events, ['save', 'save'])
  } finally {
    harness.app.unmount()
  }
})

test('已保存状态是 status 而不是 alert', async () => {
  const harness = mountInfo({
    infoSaveState: 'saved',
    infoSaveStatusLabel: '已保存',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /已保存/)
    assert.equal(buttonByText(harness.root, '重试'), undefined)
    const status = findAll(harness.root, (node) => node.props?.class && String(node.props.class).includes('info-save-status'))[0]
    assert.ok(status)
    assert.equal(status.props.role, 'status')
  } finally {
    harness.app.unmount()
  }
})
