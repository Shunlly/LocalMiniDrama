import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick, reactive, ref } from 'vue'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const infoSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailInfoCard.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
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
  }), { components: formStubs })
  return { ...mounted, events, props, infoForm }
}

test('DramaDetail 把剧集信息卡交给独立组件，保存仍由页面处理', () => {
  assert.match(pageSource, /<DramaDetailInfoCard/)
  assert.match(pageSource, /:info-form="infoForm"/)
  assert.match(pageSource, /@save="saveInfo"/)
  assert.match(pageSource, /@retry-save="retryInfoSave"/)
  assert.match(pageSource, /function saveInfo\(\)/)
  assert.match(pageSource, /async function retryInfoSave\(\)/)
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
