import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

function mediaCardTemplate() {
  const match = source.match(/<article[\s\S]*?v-for="item in mediaItems"[\s\S]*?<\/article>/)
  assert.ok(match, 'media items should render as non-interactive article containers')
  return match[0]
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
