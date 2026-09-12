import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  compileIconStub,
  createHostRenderer,
  findByType,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const emptyUrl = new URL('../src/components/mediaLibrary/MediaLibraryEmptyState.vue', import.meta.url)
const emptySource = readFileSync(emptyUrl, 'utf8')
const iconStubUrl = compileIconStub(['Files', 'Upload'])
const MediaLibraryEmptyState = await loadCompiledSfc(
  emptyUrl,
  'media-library-empty-primary-contract',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountEmpty(initial = {}) {
  return mountHarness(renderer, () => h(MediaLibraryEmptyState, {
    hasActiveFilters: Boolean(initial.hasActiveFilters),
    mediaWriteLocked: false,
    uploading: false,
    mediaUploadDisableReason: '',
    mediaAccessState: { navigationLocked: false, writeLocked: false },
    mediaSourceImportDisableReason: '',
    clearFilters: () => {},
    triggerUpload: () => {},
    goSourceImport: () => {},
    goSearchNetwork: () => {},
  }))
}

function primaryButtons(root) {
  return findByType(root, 'button').filter((node) => node.props['data-variant'] === 'primary')
}

function buttonContaining(source, needle) {
  const buttons = [...source.matchAll(/<el-button\b[\s\S]*?<\/el-button>/g)].map((match) => match[0])
  const found = buttons.find((item) => item.includes(needle))
  assert.ok(found, '缺少包含 ' + needle + ' 的按钮')
  return found
}

test('素材空态源码里导入入口不是 primary', () => {
  const secondary = buttonContaining(emptySource, 'empty-secondary-action')
  assert.doesNotMatch(secondary, /\btype="primary"/)
  assert.match(secondary, /\btype="default"/)
  assert.match(secondary, /aria-label="选择目标项目后导入网页 URL"/)
})

test('初始空态只有一个 primary，指向上传素材', async () => {
  const harness = mountEmpty()
  try {
    await nextTick()
    const primaries = primaryButtons(harness.root)
    assert.equal(primaries.length, 1, `空态只能有一个 primary，实际 ${primaries.length}`)
    assert.equal(primaries[0].props['aria-label'], '上传素材')
    assert.equal(buttonByAriaLabel(harness.root, '去搜网络素材').props['data-variant'], 'default')
    assert.equal(buttonByAriaLabel(harness.root, '选择目标项目后导入网页 URL').props['data-variant'], 'default')
  } finally {
    harness.app.unmount()
  }
})

test('筛选空态也只有一个 primary', async () => {
  const harness = mountEmpty({ hasActiveFilters: true })
  try {
    await nextTick()
    const primaries = primaryButtons(harness.root)
    assert.equal(primaries.length, 1, `筛选空态只能有一个 primary，实际 ${primaries.length}`)
    assert.equal(primaries[0].props['aria-label'], '上传素材')
    assert.equal(buttonByAriaLabel(harness.root, '清除筛选').props['data-variant'], 'default')
    assert.equal(buttonByAriaLabel(harness.root, '选择目标项目后导入网页 URL'), undefined)
  } finally {
    harness.app.unmount()
  }
})
