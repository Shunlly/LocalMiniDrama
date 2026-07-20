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

  assert.equal(imageTags.length, 2)
  assert.match(imageTags[0], /:alt="thumbnailAlt\(item\)"/)
  assert.match(imageTags[1], /:alt="previewAlt\(previewItem\)"/)
  assert.match(source, /:aria-label="thumbnailAlt\(item\)"/)
  assert.match(source, /:aria-label="videoPreviewLabel\(previewItem\)"/)
  assert.match(source, /return `素材缩略图：\$\{accessibleItemName\(item\)\}`/)
  assert.match(source, /return `素材预览图：\$\{accessibleItemName\(item\)\}`/)
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
