import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'

import { useCharacters } from '../src/composables/filmCreate/useCharacters.js'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'
import { readFilmCreateResourceDialogTree } from './helpers/filmCreateResourceDialogSources.js'

const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')
const characterBlock = readFileSync(new URL('../src/components/filmCreate/FilmCreateCharacterBlock.vue', import.meta.url), 'utf8')
const propBlock = readFileSync(new URL('../src/components/filmCreate/FilmCreatePropBlock.vue', import.meta.url), 'utf8')
const sceneBlock = readFileSync(new URL('../src/components/filmCreate/FilmCreateSceneBlock.vue', import.meta.url), 'utf8')
const dialogs = readFilmCreateResourceDialogTree()
const charactersSource = readFileSync(new URL('../src/composables/filmCreate/useCharacters.js', import.meta.url), 'utf8')
const characterLibrarySource = readFileSync(new URL('../src/composables/filmCreate/useCharacterLibrary.js', import.meta.url), 'utf8')
const resourceSurface = panel + '\n' + characterBlock + '\n' + propBlock + '\n' + sceneBlock

const USER_VISIBLE_SOURCES = {
  'FilmCreateResourcePanel.vue': panel,
  'FilmCreateCharacterBlock.vue': characterBlock,
  'FilmCreatePropBlock.vue': propBlock,
  'FilmCreateSceneBlock.vue': sceneBlock,
  'FilmCreateResourceDialogs.vue': dialogs,
  'useCharacters.js': charactersSource,
  'useCharacterLibrary.js': characterLibrarySource,
}

const SD2_CERT_COPY_RE = /SD2认证|SD2 认证详情/
const USER_VISIBLE_ATTR_RE = /(?:^|[\s:])(?:title|aria-label|label|placeholder|content)\s*=\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g
const USER_VISIBLE_MESSAGE_RE = /ElMessage\.(?:success|warning|error|info)\((?:toUserFacingError\([^,]+,\s*)?(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g
const USER_VISIBLE_RETURN_RE = /\breturn\s+(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g

function collectVisibleCopy(source) {
  const values = []
  for (const regex of [USER_VISIBLE_ATTR_RE, USER_VISIBLE_MESSAGE_RE, USER_VISIBLE_RETURN_RE]) {
    regex.lastIndex = 0
    for (const match of source.matchAll(regex)) {
      values.push(match[2])
    }
  }
  return values
}

function loadPanelFunction(name, hasAssetImage = () => false) {
  const source = remainingExtractNamedFunction(panel, name)
  return new Function(
    'hasAssetImage',
    `'use strict'; ${source}; return ${name};`,
  )(hasAssetImage)
}

function createMessages() {
  const messages = []
  return {
    messages,
    ElMessage: {
      success: (text) => messages.push({ type: 'success', text }),
      warning: (text) => messages.push({ type: 'warning', text }),
      error: (text) => messages.push({ type: 'error', text }),
      info: (text) => messages.push({ type: 'info', text }),
    },
  }
}

function createChars(options = {}) {
  setActivePinia(createPinia())
  const { messages, ElMessage } = createMessages()
  const hasAssetImage = options.hasAssetImage ?? (() => true)
  const characterAPI = {
    sd2Certify: options.sd2Certify ?? (async () => ({})),
    sd2CertifyRefresh: options.sd2CertifyRefresh ?? (async () => ({})),
  }
  const chars = useCharacters({
    store: {
      dramaId: 7,
      drama: { title: '短剧A' },
      currentEpisode: { episode_number: 1 },
    },
    dramaId: { value: 7 },
    currentEpisodeId: { value: 101 },
    getSelectedStyle: () => '',
    loadDrama: async () => {},
    pollTask: async () => ({ status: 'completed' }),
    pollUntilResourceHasImage: async () => {},
    hasAssetImage,
    ElMessage,
    characterAPI,
  })
  return { chars, messages }
}

test('资源区用户可见文案不再出现 SD2认证 或 SD2 认证详情', () => {
  for (const [name, source] of Object.entries(USER_VISIBLE_SOURCES)) {
    assert.doesNotMatch(source, SD2_CERT_COPY_RE, `${name} 仍有 SD2 认证文案`)
    for (const value of collectVisibleCopy(source)) {
      assert.doesNotMatch(value, SD2_CERT_COPY_RE, `${name} 用户可见字符串含 SD2 认证：${value}`)
      assert.doesNotMatch(value, /\bSD2\b/, `${name} 的 title/aria-label/label 仍写 SD2：${value}`)
    }
  }
  assert.match(characterBlock, /@click="emit\('sd2-primary-action', char\)"/)
  assert.match(dialogs, /class="sd2-cert-dialog"/)
})

test('认证弹窗标题和字段标签改为简体中文', () => {
  assert.match(dialogs, /title="认证资产详情"/)
  assert.match(dialogs, /<el-descriptions-item label="素材编号">/)
  assert.match(dialogs, /<el-descriptions-item label="素材地址">/)
  assert.match(dialogs, /<el-descriptions-item label="状态">/)
  assert.match(dialogs, /<el-descriptions-item label="来源图">/)
  assert.match(dialogs, /label="认证提供方"/)
  assert.doesNotMatch(dialogs, /title="SD2 认证详情"/)
  assert.doesNotMatch(dialogs, /label="素材 ID"/)
  assert.doesNotMatch(dialogs, /label="asset_url"/)
  assert.doesNotMatch(dialogs, /label="注册图片 URL"/)
})

test('认证按钮文案保持认证资产，帮助与无障碍不再写 SD2', () => {
  const { chars } = createChars()
  assert.equal(chars.sd2ActionLabel({}), '认证资产')
  assert.equal(chars.sd2ActionLabel({ seedance2_asset: { status: 'active' } }), '查看认证')
  assert.equal(chars.sd2ActionLabel({ seedance2_asset: { status: 'processing' } }), '刷新认证')
  assert.equal(chars.sd2ActionLabel({ seedance2_asset: { status: 'failed' } }), '重新认证')
  assert.match(characterBlock, /:title="sd2CertActionTitle\(char\)"/)
  assert.match(characterBlock, /:aria-label="sd2ActionLabel\(char\)"/)
  assert.match(panel, /将角色主图登记为认证资产/)
  assert.match(panel, /查看认证资产详情/)
  assert.doesNotMatch(resourceSurface, /title="[^"]*SD2/)
  assert.doesNotMatch(resourceSurface, /aria-label="[^"]*SD2/)
})

test('角色道具场景空状态与缺图禁用原因使用完整中文', () => {
  assert.match(panel, /暂无角色，可用「剧本自动提取角色」或「添加角色」/)
  assert.match(panel, /暂无道具，可用「从剧本提取道具」或「添加道具」/)
  assert.match(panel, /暂无场景，可用「从剧本提取场景」或「添加场景」/)
  assert.match(characterBlock, /class="asset-desc-full">\{\{ char\.appearance \|\| char\.description \|\| '暂无描述' \}\}<\/div>/)

  const missingReason = loadPanelFunction('missingAssetImageReason', () => false)
  const readyReason = loadPanelFunction('missingAssetImageReason', () => true)
  assert.equal(missingReason({}, 'character'), '请先为该角色生成或上传主图')
  assert.equal(missingReason({}, 'prop'), '请先为该道具生成或上传主图')
  assert.equal(missingReason({}, 'scene'), '请先为该场景生成或上传主图')
  assert.equal(readyReason({}, 'character'), '')
  assert.match(characterBlock, /<ActionGate :reason="missingAssetImageReason\(char, 'character'\)" :label="sd2ActionLabel\(char\)">/)
})

test('无主图时认证按钮禁用原因和提交提示使用完整中文', async () => {
  const blocked = createChars({ hasAssetImage: () => false })
  await blocked.chars.onSd2CertifyCharacter({ id: 11, name: '李华' })
  assert.equal(blocked.messages[0].type, 'warning')
  assert.equal(blocked.messages[0].text, '请先为该角色生成或上传主图')

  const submitted = createChars()
  await submitted.chars.onSd2CertifyCharacter({ id: 11, name: '李华' })
  assert.equal(submitted.messages[0].type, 'success')
  assert.equal(submitted.messages[0].text, '认证资产请求已提交')
  assert.doesNotMatch(submitted.messages[0].text, SD2_CERT_COPY_RE)

  const refreshed = createChars()
  await refreshed.chars.onSd2CertifyRefresh({ id: 11, name: '李华' })
  assert.equal(refreshed.messages[0].type, 'success')
  assert.equal(refreshed.messages[0].text, '认证资产状态已刷新')

  const failed = createChars({
    sd2Certify: async () => {
      throw new Error('Internal server error')
    },
  })
  await failed.chars.onSd2CertifyCharacter({ id: 11, name: '李华' })
  assert.equal(failed.messages[0].type, 'error')
  assert.equal(failed.messages[0].text, '认证资产失败')
  assert.doesNotMatch(failed.messages[0].text, SD2_CERT_COPY_RE)
})
