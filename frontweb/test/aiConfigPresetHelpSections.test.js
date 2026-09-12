import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PRESET_HELP_DISCLAIMER,
  PRESET_HELP_SECTIONS,
  PRESET_HELP_TAG,
  getPresetHelpItem,
  listPresetHelpItems,
} from '../src/components/aiConfig/aiConfigPresetHelpSections.js'

const REQUIRED_ITEM_NAMES = [
  'openai-text',
  'openrouter-text',
  'siliconflow-text',
  'cn-cloud-text',
  'ollama-text',
  'comfyui-img',
  'volcengine-omni-vid',
  'minimax-vid',
  'runway-vid',
  'luma-vid',
  'siliconflow-tts',
  'qwen-text',
  'volcengine-text',
  'agnes-suite',
  'kling-vid',
  'openai-ocr',
  'qwen-ocr',
  'openai-transcription',
  'qwen-transcription',
]

function flattenBody(body = []) {
  return body.map((block) => {
    if (block.type === 'pre') return block.text
    return (block.parts || []).map((part) => part.bold || part.code || part.text || '').join('')
  }).join('\n')
}

test('预设帮助数据覆盖新增厂商，且条目 name 互不混用', () => {
  const items = listPresetHelpItems()
  const names = items.map((item) => item.name)
  assert.equal(PRESET_HELP_SECTIONS.length, 6)
  assert.equal(items.length, 36)
  assert.equal(new Set(names).size, names.length)
  assert.equal(getPresetHelpItem('openai-text')?.tag, 'text')
  assert.equal(getPresetHelpItem('openai-img')?.tag, 'img')
  assert.equal(getPresetHelpItem('openai-vid')?.tag, 'vid')
  assert.equal(getPresetHelpItem('openai-tts')?.tag, 'tts')
  assert.notEqual(getPresetHelpItem('openai-text')?.name, getPresetHelpItem('openai-img')?.name)
  assert.equal(getPresetHelpItem('openai-text-missing'), null)
  for (const name of REQUIRED_ITEM_NAMES) {
    assert.ok(getPresetHelpItem(name), `缺少帮助条目 ${name}`)
  }
})

test('预设帮助标签和免责声明保持简体中文', () => {
  assert.match(PRESET_HELP_DISCLAIMER, /选择预设只会自动填入公开接口地址（Base URL）和常见模型名/)
  assert.match(flattenBody(getPresetHelpItem('openai-text').body), /接口地址（Base URL）/)
  assert.match(flattenBody(getPresetHelpItem('openai-text').body), /自定义网关请改接口地址（Base URL）/)
  assert.match(PRESET_HELP_DISCLAIMER, /不代表本应用已真实接入或跑通对应厂商/)
  assert.equal(PRESET_HELP_TAG.text.label, '文本')
  assert.equal(PRESET_HELP_TAG.img.label, '图片')
  assert.equal(PRESET_HELP_TAG.vid.label, '视频')
  assert.equal(PRESET_HELP_TAG.tts.label, '语音')
  assert.equal(PRESET_HELP_TAG.ocr.label, '识别')
  assert.equal(PRESET_HELP_TAG.asr.label, '转写')
  assert.deepEqual(PRESET_HELP_SECTIONS.map((section) => section.id), ['text', 'image', 'video', 'tts', 'ocr', 'transcription'])
  assert.equal(PRESET_HELP_SECTIONS[0].title, '文本 / OpenAI 兼容')
  assert.match(PRESET_HELP_SECTIONS[1].title, /图片 \/ 分镜图 协议/)
  assert.match(PRESET_HELP_SECTIONS[2].title, /视频 协议/)
  assert.equal(PRESET_HELP_SECTIONS[3].title, '语音 TTS')
  assert.equal(PRESET_HELP_SECTIONS[4].title, '图片识别 OCR')
  assert.equal(PRESET_HELP_SECTIONS[5].title, '语音转写')
})

test('每条厂商帮助都有标题、合法标签和正文，空条目不会混进目录', () => {
  const allowedTags = new Set(Object.keys(PRESET_HELP_TAG))
  for (const section of PRESET_HELP_SECTIONS) {
    assert.ok(section.id)
    assert.ok(section.title)
    assert.ok(Array.isArray(section.items) && section.items.length > 0)
    for (const item of section.items) {
      assert.ok(item.name, `${section.id} 缺少 name`)
      assert.ok(allowedTags.has(item.tag), `${item.name} 标签非法：${item.tag}`)
      assert.ok(item.title, `${item.name} 缺少标题`)
      assert.ok(Array.isArray(item.body) && item.body.length > 0, `${item.name} 正文为空`)
      for (const block of item.body) {
        if (block.type === 'pre') {
          assert.equal(typeof block.text, 'string')
          assert.ok(block.text.length > 0, `${item.name} 存在空 pre`)
          continue
        }
        assert.equal(block.type, 'line')
        assert.ok(Array.isArray(block.parts) && block.parts.length > 0, `${item.name} 存在空行`)
        for (const part of block.parts) {
          const keys = Object.keys(part)
          assert.equal(keys.length, 1)
          assert.ok(['bold', 'code', 'text'].includes(keys[0]), `${item.name} 出现未知正文片段`)
          assert.equal(typeof part[keys[0]], 'string')
          assert.ok(part[keys[0]].length > 0)
        }
      }
    }
  }
  const omni = flattenBody(getPresetHelpItem('volcengine-omni-vid').body)
  assert.match(omni, /方舟 Seedance 2\.0/)
  assert.match(omni, /role: reference_image/)
  const comfy = flattenBody(getPresetHelpItem('comfyui-img').body)
  assert.match(comfy, /http:\/\/127\.0\.0\.1:8188/)
  const tts = flattenBody(getPresetHelpItem('siliconflow-tts').body)
  assert.match(tts, /不代表语音合成已真实接入/)
  const qwen = flattenBody(getPresetHelpItem('qwen-text').body)
  assert.match(qwen, /dashscope.aliyuncs.com/)
  const agnes = flattenBody(getPresetHelpItem('agnes-suite').body)
  assert.match(agnes, /一键配置 Agnes/)
  const kling = flattenBody(getPresetHelpItem('kling-vid').body)
  assert.match(kling, /kling-v3-omni/)
  const ocr = flattenBody(getPresetHelpItem('openai-ocr').body)
  assert.match(ocr, /PDF\/图片抽文字/)
  const asr = flattenBody(getPresetHelpItem('openai-transcription').body)
  assert.match(asr, /音频\/视频转写/)
})
