import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick } from 'vue'

import {
  PRESET_HELP_DISCLAIMER,
  listPresetHelpItems,
} from '../src/components/aiConfig/aiConfigPresetHelpSections.js'
import {
  compileSfc,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { readAiConfigPresetHelpSource } from './helpers/aiConfigPresetHelpSources.js'

const collapseSource = readAiConfigPresetHelpSource('AiConfigPresetHelpCollapse.vue')
const bodySource = readAiConfigPresetHelpSource('AiConfigPresetHelpBody.vue')
const collapseUrl = new URL('../src/components/aiConfig/AiConfigPresetHelpCollapse.vue', import.meta.url)
const bodyUrl = new URL('../src/components/aiConfig/AiConfigPresetHelpBody.vue', import.meta.url)
const sectionsUrl = new URL('../src/components/aiConfig/aiConfigPresetHelpSections.js', import.meta.url).href
const compiledBodyUrl = compileSfc(bodyUrl, 'ai-config-preset-help-body')
const AiConfigPresetHelpBody = (await import(compiledBodyUrl)).default
const AiConfigPresetHelpCollapse = await loadCompiledSfc(
  collapseUrl,
  'ai-config-preset-help-collapse',
  new Map([
    ['vue', vueUrl],
    ['@/components/aiConfig/AiConfigPresetHelpBody.vue', compiledBodyUrl],
    ['@/components/aiConfig/aiConfigPresetHelpSections.js', sectionsUrl],
  ]),
)

const renderer = createHostRenderer()

const ElCollapseStub = defineComponent({
  name: 'ElCollapseStub',
  setup(_props, { slots }) {
    return () => h('div', { 'data-el': 'el-collapse' }, slots.default?.())
  },
})

const ElCollapseItemStub = defineComponent({
  name: 'ElCollapseItemStub',
  props: ['name'],
  setup(props, { slots }) {
    return () => h('div', { 'data-el': 'el-collapse-item', 'data-name': props.name }, [
      h('div', { 'data-el': 'help-title' }, slots.title?.()),
      h('div', { 'data-el': 'help-body' }, slots.default?.()),
    ])
  },
})

const extraComponents = {
  ElCollapse: ElCollapseStub,
  'el-collapse': ElCollapseStub,
  ElCollapseItem: ElCollapseItemStub,
  'el-collapse-item': ElCollapseItemStub,
}

function collapseItems(root) {
  return findAll(root, (node) => node.props && node.props['data-el'] === 'el-collapse-item')
}

function mountHelp(props) {
  return mountHarness(renderer, () => h(AiConfigPresetHelpCollapse, props || {}), {
    components: extraComponents,
  })
}

test('主组件只负责折叠容器，厂商段落来自数据模块', () => {
  assert.match(collapseSource, /class="protocol-help"/)
  assert.match(collapseSource, /PRESET_HELP_SECTIONS/)
  assert.match(collapseSource, /:name="item.name"/)
  assert.match(collapseSource, /<AiConfigPresetHelpBody/)
  assert.doesNotMatch(collapseSource, /el-collapse-item name="openrouter-text"/)
  assert.doesNotMatch(collapseSource, /el-collapse-item name="comfyui-img"/)
  assert.doesNotMatch(collapseSource, /不代表语音合成已真实接入/)
  assert.match(bodySource, /block.type === 'pre'/)
})

test('默认帮助区渲染全部厂商条目、中文标签和免责声明', async () => {
  const harness = mountHelp()
  try {
    await nextTick()
    const text = textContent(harness.root)
    assert.match(text, /选择预设只会自动填入公开接口地址（Base URL）和常见模型名/)
    assert.match(text, /不代表本应用已真实接入或跑通对应厂商/)
    assert.match(text, /文本 \/ OpenAI 兼容/)
    assert.match(text, /图片 \/ 分镜图 协议/)
    assert.match(text, /视频 协议/)
    assert.match(text, /语音 TTS/)
    assert.match(text, /图片识别 OCR/)
    assert.match(text, /语音转写/)
    assert.match(text, /通义千问 \/ 阿里云百炼/)
    assert.match(text, /可灵 Kling 视频/)
    const items = collapseItems(harness.root)
    const expected = listPresetHelpItems()
    assert.equal(items.length, expected.length)
    assert.deepEqual(items.map((node) => node.props['data-name']), expected.map((item) => item.name))
    assert.match(text, /OpenRouter 聚合网关/)
    assert.match(text, /ComfyUI 本地工作流/)
    assert.match(text, /火山即梦 Seedance 全能（多图参考）/)
    assert.ok(text.includes('http://127.0.0.1:8188'))
    assert.match(text, /不代表语音合成已真实接入/)
    assert.ok(text.includes('enhance_prompt: true'))
    assert.equal(PRESET_HELP_DISCLAIMER.includes('选择预设只会自动填入公开接口地址（Base URL）'), true)
  } finally {
    harness.app.unmount()
  }
})

test('空分区只保留免责声明，不会残留折叠项', async () => {
  const harness = mountHelp({
    sections: [],
    disclaimer: '选择预设只会自动填入公开接口地址（Base URL）和常见模型名。',
  })
  try {
    await nextTick()
    const text = textContent(harness.root)
    assert.match(text, /选择预设只会自动填入公开接口地址（Base URL）和常见模型名/)
    assert.equal(collapseItems(harness.root).length, 0)
    assert.doesNotMatch(text, /OpenAI 兼容网关/)
  } finally {
    harness.app.unmount()
  }
})

test('混合分区保留有效条目，未知标签和空正文不把别的厂商文案带进来', async () => {
  const harness = mountHelp({
    sections: [
      {
        id: 'text',
        title: '文本 / OpenAI 兼容',
        items: [
          {
            name: 'openai-text',
            tag: 'text',
            title: 'OpenAI 兼容网关',
            body: [{ type: 'line', parts: [{ text: '有效文本段落' }] }],
          },
          {
            name: 'ghost-img',
            tag: 'not-a-tag',
            title: '未知厂商',
            body: [],
          },
          {
            name: 'broken-vid',
          },
        ],
      },
      {
        id: 'empty',
        title: '空分区',
      },
    ],
  })
  try {
    await nextTick()
    const text = textContent(harness.root)
    const items = collapseItems(harness.root)
    assert.equal(items.length, 3)
    assert.deepEqual(items.map((node) => node.props['data-name']), ['openai-text', 'ghost-img', 'broken-vid'])
    assert.match(text, /有效文本段落/)
    assert.match(text, /未知厂商/)
    assert.match(text, /空分区/)
    assert.doesNotMatch(text, /ComfyUI 本地工作流/)
    assert.doesNotMatch(text, /不代表语音合成已真实接入/)
    const ghostTitle = textContent(items[1])
    assert.doesNotMatch(ghostTitle, /文本/)
    assert.doesNotMatch(ghostTitle, /图片/)
    assert.doesNotMatch(ghostTitle, /视频/)
    assert.doesNotMatch(ghostTitle, /语音/)
  } finally {
    harness.app.unmount()
  }
})

test('帮助正文空数据、代码块和普通行可混合渲染', async () => {
  const emptyHarness = mountHarness(renderer, () => h(AiConfigPresetHelpBody, { blocks: [] }))
  const mixedHarness = mountHarness(renderer, () => h(AiConfigPresetHelpBody, {
    blocks: [
      { type: 'line', parts: [{ bold: '注意：' }, { text: '前一行' }] },
      { type: 'pre', text: '{ "model": "demo" }' },
      { type: 'line', parts: [{ code: 'role: reference_image' }] },
      { type: 'line', parts: [{}] },
    ],
  }))
  try {
    await nextTick()
    assert.equal(textContent(emptyHarness.root).trim(), '')
    const text = textContent(mixedHarness.root)
    assert.match(text, /注意：/)
    assert.match(text, /前一行/)
    assert.ok(text.includes('"model": "demo"'))
    assert.ok(text.includes('role: reference_image'))
  } finally {
    emptyHarness.app.unmount()
    mixedHarness.app.unmount()
  }
})

test('非法分区数据被忽略，不会把默认厂商目录带回来', async () => {
  const nullHarness = mountHelp({ sections: null })
  const mixedNullHarness = mountHelp({
    sections: [null, { id: 'text', title: '文本 / OpenAI 兼容', items: [{ name: 'openai-text', tag: 'text', title: 'OpenAI 兼容网关', body: [{ type: 'line', parts: [{ text: '只保留这一条' }] }] }] }],
  })
  try {
    await nextTick()
    assert.equal(collapseItems(nullHarness.root).length, 0)
    assert.doesNotMatch(textContent(nullHarness.root), /OpenRouter 聚合网关/)
    const items = collapseItems(mixedNullHarness.root)
    assert.equal(items.length, 1)
    assert.equal(items[0].props['data-name'], 'openai-text')
    assert.match(textContent(mixedNullHarness.root), /只保留这一条/)
    assert.doesNotMatch(textContent(mixedNullHarness.root), /ComfyUI 本地工作流/)
  } finally {
    nullHarness.app.unmount()
    mixedNullHarness.app.unmount()
  }
})
