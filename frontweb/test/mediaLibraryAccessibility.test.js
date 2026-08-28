import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

function mediaCardTemplate() {
  const match = source.match(/<article[\s\S]*?v-for="item in mediaItems"[\s\S]*?<\/article>/)
  assert.ok(match, 'media items should render as non-interactive article containers')
  return match[0]
}

function initialEmptyActionsTemplate() {
  const match = source.match(/<div class="empty-actions">[\s\S]*?<template v-else>([\s\S]*?)<\/template>/)
  assert.ok(match, 'the initial empty state should have a dedicated action branch')
  return match[1]
}

function urlImportEntryTemplate() {
  const entries = [...source.matchAll(/<div class="entry-item">[\s\S]*?<\/div>/g)]
  const entry = entries.find((match) => match[0].includes('URL'))
  assert.ok(entry, 'the media library should keep a URL import entry')
  return entry[0]
}

test('media cards use an explicit keyboard-accessible selection control', () => {
  const card = mediaCardTemplate()
  const openingTag = card.match(/^<article[\s\S]*?>/)?.[0]

  assert.ok(openingTag)
  assert.doesNotMatch(openingTag, /@click=/)
  assert.doesNotMatch(source, /@click="toggleSelect\(item\)"/)
  assert.match(card, /<input[\s\S]*?type="checkbox"[\s\S]*?:checked="selectedIds\.has\(item\.id\)"/)
  assert.match(card, /:aria-label="selectionLabel\(item\)"/)
  assert.match(card, /@change="setItemSelected\(item, \$event\.target\.checked\)"/)
  assert.match(source, /\.selection-input:focus-visible \+ \.selection-indicator/)
})

test('hidden card actions are removed from the tab order until the layer is visible', () => {
  const card = mediaCardTemplate()
  const actionTabIndexes = card.match(/:tabindex="isActionLayerVisible\(item\.id\) \? 0 : -1"/g) || []

  assert.match(card, /class="media-overlay" :aria-hidden="!isActionLayerVisible\(item\.id\)"/)
  assert.equal(actionTabIndexes.length, 2)
  assert.match(card, /@focusin="showKeyboardActions\(item\.id\)"/)
  assert.match(card, /@focusout="hideKeyboardActions\(item\.id, \$event\)"/)
  assert.match(source, /\.media-overlay \{[\s\S]*?pointer-events: none;/)
  assert.match(source, /\.media-card\.actions-visible \.media-overlay \{[\s\S]*?pointer-events: auto;/)
})

test('thumbnail and preview media expose item-specific accessible text', () => {
  const imageTags = [...source.matchAll(/<img\b[\s\S]*?>/g)].map((match) => match[0])

  const localThumbnail = imageTags.find((tag) => tag.includes(':alt="thumbnailAlt(item)"'))
  const localPreview = imageTags.find((tag) => tag.includes(':alt="previewAlt(previewItem)"'))
  const networkThumbnail = imageTags.find((tag) => tag.includes('网络素材缩略图'))
  const networkPreview = imageTags.find((tag) => tag.includes('网络素材预览图'))
  assert.ok(localThumbnail)
  assert.ok(localPreview)
  assert.ok(networkThumbnail)
  assert.ok(networkPreview)
  assert.match(networkThumbnail, /:src="networkCardImageUrl\(item\)"/)
  assert.match(source, /:aria-label="thumbnailAlt\(item\)"/)
  assert.match(source, /:aria-label="videoPreviewLabel\(previewItem\)"/)
  assert.match(source, /:aria-label="`网络视频预览：\$\{networkItemTitle\(networkPreviewItem\)\}`"/)
  assert.match(source, /return `素材缩略图：\$\{accessibleItemName\(item\)\}`/)
  assert.match(source, /return `素材预览图：\$\{accessibleItemName\(item\)\}`/)
})

test('network and imported previews expose HTTPS license evidence', () => {
  assert.match(source, />查看许可<\/a>/)
  assert.match(source, /safeExternalUrl\(item\.license_url, true\)/)
  assert.match(source, /safeExternalUrl\(previewItem\?\.license_url, true\)/)
  assert.match(source, /safeExternalUrl\(networkPreviewItem\?\.license_url, true\)/)
  assert.match(source, /if \(url\.username \|\| url\.password\) return ''/)
  assert.match(source, /requireHttps \? url\.protocol === 'https:'/)
})

test('网络搜索结果公告状态，操作名称包含素材标题', () => {
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(source, /{{ networkSearchAnnouncement }}/)
  assert.ok(source.includes(':aria-label="`查看来源：${networkItemTitle(item)}`"'))
  assert.ok(source.includes(':aria-label="`查看许可：${networkItemTitle(item)}`"'))
  assert.ok(source.includes(':aria-label="`${networkImportButtonText}：${networkItemTitle(item)}`"'))
})

test('网络导入明确展示当前项目或全局素材库目标', () => {
  assert.match(source, /导入目标：<strong>{{ networkImportTargetLabel }}<\/strong>/)
  assert.ok(source.includes('`当前项目（ID ${scopedDramaId.value}）`'))
  assert.match(source, /: '全局素材库'/)
  assert.ok(source.includes("scopedDramaId.value ? '导入当前项目' : '导入全局素材库'"))
})

test('缺少许可证据的网络素材会禁用导入并显示原因', () => {
  assert.ok(source.includes('v-if="!networkItemImportability(item).allowed"'))
  assert.ok(source.includes('{{ networkItemImportability(item).reason }}'))
  assert.ok(source.includes(':disabled="isNetworkImporting(item) || !networkItemImportability(item).allowed"'))
  assert.ok(source.includes('ElMessage.warning(importability.reason)'))
})

test('已导入 Commons 素材展示可审计的版本与内容证据', () => {
  assert.match(source, /safeExternalUrl\(sourceEvidence\(previewItem, 'source_url'\), true\)/)
  assert.match(source, />查看 Wikimedia Commons 来源<\/a>/)
  assert.match(source, /sourceEvidence\(previewItem, 'commons_revision_timestamp'\)/)
  assert.match(source, /sourceEvidence\(previewItem, 'commons_sha1'\)/)
  assert.match(source, /sourceEvidence\(previewItem, 'content_sha256'\)/)
  assert.match(source, /return item\.source_metadata\?\.\[key\] \?\? item\[key\] \?\? ''/)
  assert.match(source, /aria-label="复制 Commons SHA-1"/)
  assert.match(source, /aria-label="复制本地内容 SHA-256"/)
  assert.match(source, /\.meta-row--hash code \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: break-all;/)
  assert.match(source, /@media \(max-width: 520px\) \{[\s\S]*?\.meta-row--hash \{[\s\S]*?flex-wrap: wrap;/)
})

test('来源证据复制会写入剪贴板并反馈成功或失败', async () => {
  const start = source.indexOf('async function copySourceEvidence')
  const end = source.indexOf('\nfunction formatSourceTimestamp', start)
  assert.ok(start >= 0 && end > start)
  const implementation = source.slice(start, end)
  const harnessSource = `
    let shouldFail = false
    const calls = []
    const navigator = { clipboard: { async writeText(value) {
      calls.push('write:' + value)
      if (shouldFail) throw new Error('clipboard unavailable')
    } } }
    const ElMessage = {
      success(value) { calls.push('success:' + value) },
      error(value) { calls.push('error:' + value) },
    }
    ${implementation}
    export async function run(value, label, fail = false) {
      calls.length = 0
      shouldFail = fail
      const result = await copySourceEvidence(value, label)
      return { result, calls: [...calls] }
    }
  `
  const harness = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(harnessSource)}`)

  assert.deepEqual(await harness.run(' abc123 ', 'Commons SHA-1'), {
    result: true,
    calls: ['write:abc123', 'success:Commons SHA-1 已复制'],
  })
  assert.deepEqual(await harness.run('def456', '本地内容 SHA-256', true), {
    result: false,
    calls: ['write:def456', 'error:本地内容 SHA-256 复制失败，请手动选择复制'],
  })
  assert.deepEqual(await harness.run('  ', 'Commons SHA-1'), { result: false, calls: [] })
})

test('the initial empty state has one clearly named primary upload action', () => {
  const actions = initialEmptyActionsTemplate()
  const buttons = actions.match(/<el-button\b/g) || []

  assert.equal(buttons.length, 1)
  assert.match(actions, /<el-button[\s\S]*?type="primary"/)
  assert.match(actions, /aria-label="上传图片或视频到素材中心"/)
  assert.match(actions, /@click="triggerUpload"/)
  assert.doesNotMatch(actions, /goNewProject|goHome/)
  assert.match(source, /:type="mediaItems\.length === 0 && !loading \? 'default' : 'primary'"/)
  assert.match(source, /class="empty-secondary-action"[\s\S]*aria-label="选择项目后导入网页 URL"[\s\S]*@click="goSourceImport"/)
})

test('URL import is named as a project-level flow and keeps its existing navigation', () => {
  const entry = urlImportEntryTemplate()

  assert.match(entry, /网页 URL 导入会在选择项目后完成/)
  assert.match(entry, /本页不直接粘贴 URL/)
  assert.match(entry, /aria-label="选择项目后导入网页 URL"/)
  assert.match(entry, /@click="goSourceImport"\s*>进入项目选择后导入网页 URL<\/el-button>/)
  assert.match(
    source,
    /function goSourceImport\(\) \{[\s\S]*?router\.push\(\{ path: '\/', query: \{ intent: 'source-import' \} \}\)[\s\S]*?\n\}/,
  )
  assert.match(
    source,
    /function goNewProject\(\) \{[\s\S]*?router\.push\(\{ path: '\/', query: \{ new: '1' \} \}\)[\s\S]*?\n\}/,
  )
})

test('删除素材确认会说明名称、来源和不可恢复影响', () => {
  assert.match(source, /describeMediaDeleteImpact\(item\)/)
  assert.match(source, /describeMediaBatchDeleteImpact\(count\)/)
  assert.match(source, /<main class="media-library-page">/)
})

test('预览对话框给媒体初始焦点，并用关闭预览按钮兜底', () => {
  assert.equal((source.match(/>关闭预览<\/el-button>/g) || []).length, 2)
  assert.match(source, /class="preview-video"[\s\S]*tabindex="0"/)
  assert.match(source, /class="preview-image"[\s\S]*tabindex="0"/)
  assert.match(source, /@click="showPreview = false">关闭预览/)
  assert.match(source, /@click="showNetworkPreview = false">关闭预览/)
})

test('上传失败保留可见反馈，网络空结果不会伪装成成功列表', () => {
  assert.match(source, /v-if="uploadFeedback"/)
  assert.match(source, /uploadFeedback\.tone === 'error' \? 'alert' : 'status'/)
  assert.match(source, /buildMediaLibraryUploadFeedback/)
  assert.match(source, /uploadAPI\.uploadAsset\(file, \{ suppressErrorToast: true \}\)/)
  assert.match(source, /没有找到匹配的网络素材/)
  assert.match(source, /class="network-empty"[\s\S]*role="status"/)
})
