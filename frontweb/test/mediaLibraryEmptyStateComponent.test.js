import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const emptyUrl = new URL('../src/components/mediaLibrary/MediaLibraryEmptyState.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Files', 'Upload'])
const MediaLibraryEmptyState = await loadCompiledSfc(
  emptyUrl,
  'media-library-empty-state-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountEmpty(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(MediaLibraryEmptyState, {
    hasActiveFilters: Boolean(initial.hasActiveFilters),
    mediaWriteLocked: Boolean(initial.mediaWriteLocked),
    uploading: Boolean(initial.uploading),
    mediaUploadDisableReason: initial.mediaUploadDisableReason ?? '',
    mediaAccessState: initial.mediaAccessState ?? { navigationLocked: false, writeLocked: false },
    mediaSourceImportDisableReason: initial.mediaSourceImportDisableReason ?? '',
    clearFilters: () => events.push(['clear']),
    triggerUpload: () => events.push(['upload']),
    goSourceImport: () => events.push(['import']),
  }))
  return { ...mounted, events }
}

test('\u7d20\u6750\u4e2d\u5fc3\u7a7a\u6001\u662f\u4e2d\u6587\u4e0b\u4e00\u6b65\uff0c\u4e0d\u6f0f\u82f1\u6587', async () => {
  const harness = mountEmpty()
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /\u7d20\u6750\u4e2d\u5fc3\u8fd8\u662f\u7a7a\u7684/)
    assert.match(copy, /\u4e0a\u4f20\u56fe\u7247\u6216\u89c6\u9891/)
    assert.doesNotMatch(copy, /No data|empty|Upload files|Network Error/i)
    click(buttonByAriaLabel(harness.root, '\u4e0a\u4f20\u56fe\u7247\u6216\u89c6\u9891\u5230\u7d20\u6750\u4e2d\u5fc3'))
    assert.deepEqual(harness.events, [['upload']])
  } finally {
    harness.app.unmount()
  }
})

test('\u7b5b\u9009\u7a7a\u6001\u63d0\u4f9b\u6e05\u9664\u7b5b\u9009\uff0c\u4e0d\u6f0f\u82f1\u6587', async () => {
  const harness = mountEmpty({ hasActiveFilters: true })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /\u6ca1\u6709\u5339\u914d\u7684\u7d20\u6750/)
    assert.match(copy, /\u8c03\u6574\u5173\u952e\u8bcd\u6216\u7d20\u6750\u7c7b\u578b\u540e\u518d\u8bd5/)
    assert.doesNotMatch(copy, /No matches|Clear filters|No data/i)
    click(buttonByAriaLabel(harness.root, '\u6e05\u9664\u7d20\u6750\u7b5b\u9009'))
    assert.deepEqual(harness.events, [['clear']])
  } finally {
    harness.app.unmount()
  }
})
