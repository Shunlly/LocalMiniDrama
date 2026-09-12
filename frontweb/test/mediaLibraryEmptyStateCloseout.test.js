import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  findByType,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

function templateOnly(source) {
  const start = source.indexOf('<template')
  const end = source.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, 'Vue 源码必须包含 template 与 script')
  return source.slice(start, end).replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function openingTags(source, tagNames) {
  const template = templateOnly(source)
  const names = new Set(tagNames)
  const tags = []
  const matcher = /<([A-Za-z][\w-]*)\b/g
  let match
  while ((match = matcher.exec(template))) {
    if (!names.has(match[1])) continue
    let quote = ''
    let index = matcher.lastIndex
    for (; index < template.length; index += 1) {
      const character = template[index]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") quote = character
      else if (character === '>') break
    }
    tags.push({
      tag: match[1],
      opening: template.slice(match.index, index + 1),
      innerStart: index + 1,
      line: template.slice(0, match.index).split('\n').length,
      template,
    })
    matcher.lastIndex = index + 1
  }
  return tags
}

function visibleButtonText(inner) {
  return inner
    .replace(/<el-icon\b[\s\S]*?<\/el-icon>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buttonRecords(source) {
  return openingTags(source, ['button', 'el-button']).map((button) => {
    const selfClosing = /\/\s*>$/.test(button.opening)
    const closing = `</${button.tag}>`
    const closeIndex = selfClosing ? button.innerStart : button.template.indexOf(closing, button.innerStart)
    assert.ok(closeIndex >= button.innerStart, `缺少 ${closing}，约第 ${button.line} 行`)
    return {
      ...button,
      inner: selfClosing ? '' : button.template.slice(button.innerStart, closeIndex),
    }
  })
}

function staticAriaLabel(opening) {
  return opening.match(/(?:^|\s)aria-label="([^"]+)"/)?.[1] || ''
}

function assertEmptyStateContract(name, source, { maxPrimary, requiredPrimaryLabel = '', wrapSelectors = [] }) {
  const template = templateOnly(source)
  const primaryCount = (template.match(/type="primary"/g) || []).length
  assert.ok(primaryCount <= maxPrimary, `${name} 空态 primary 数量应为 <= ${maxPrimary}，实际 ${primaryCount}`)
  if (requiredPrimaryLabel) {
    const primaryButtons = buttonRecords(source).filter((button) => /\stype="primary"/.test(button.opening))
    assert.ok(primaryButtons.length > 0, `${name} 应有 primary 按钮`)
    for (const button of primaryButtons) {
      const aria = staticAriaLabel(button.opening)
      const text = visibleButtonText(button.inner)
      assert.ok(
        aria.includes(requiredPrimaryLabel) || text.includes(requiredPrimaryLabel),
        `${name} primary 必须是「${requiredPrimaryLabel}」，实际 aria=${aria} text=${text}`,
      )
    }
  }
  const violations = []
  for (const button of buttonRecords(source)) {
    const text = visibleButtonText(button.inner)
    if (!text) continue
    const aria = staticAriaLabel(button.opening)
    if (!aria) continue
    if (!aria.includes(text)) violations.push(`${name}:${button.line} 可见「${text}」不在读屏名「${aria}」中`)
  }
  assert.deepEqual(violations, [])
  for (const selector of wrapSelectors) {
    assert.match(source, selector, `${name} 缺少窄屏防撑开样式`)
  }
}

const emptyState = read('../src/components/mediaLibrary/MediaLibraryEmptyState.vue')
const networkEmpty = read('../src/components/mediaLibrary/MediaLibraryNetworkEmpty.vue')
const pickerEmpty = read('../src/components/globalMediaPicker/GlobalMediaPickerEmpty.vue')
const toolbar = read('../src/components/filmList/FilmListWorkspaceToolbar.vue')
const libraryCss = read('../src/components/filmList/filmListLibraryDialogs.css')
const sourceImport = read('../src/components/mediaLibrary/MediaLibrarySourceImportDialog.vue')

test('素材中心空态只有上传素材是 primary，去搜网络素材必须是次要按钮', () => {
  assertEmptyStateContract('MediaLibraryEmptyState.vue', emptyState, {
    maxPrimary: 2,
    requiredPrimaryLabel: '上传素材',
    wrapSelectors: [
      /\.empty-media \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/,
      /\.empty-actions :deep\(\.el-button\),[\s\S]*?white-space: normal;/,
    ],
  })
  assert.match(emptyState, /<el-button type="default" aria-label="去搜网络素材"/)
  assert.doesNotMatch(emptyState, /<el-button[^>]*type="primary"[^>]*aria-label="去搜网络素材"/)
  assert.match(emptyState, /<el-button type="default" aria-label="清除筛选"/)
  assert.match(emptyState, /class="empty-secondary-action"[\s\S]*aria-label="选择目标项目后导入网页 URL"/)
  assert.doesNotMatch(emptyState, /empty-secondary-action[\s\S]{0,80}type="primary"|type="primary"[\s\S]{0,80}empty-secondary-action/)
})

test('网络素材空态没有 primary，读屏名包含可见文案', () => {
  assertEmptyStateContract('MediaLibraryNetworkEmpty.vue', networkEmpty, {
    maxPrimary: 0,
    wrapSelectors: [
      /\.network-empty \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/,
      /\.network-empty-actions :deep\(\.el-button\) \{[\s\S]*?white-space: normal;/,
    ],
  })
  assert.match(networkEmpty, /aria-label="重新搜索"/)
  assert.match(networkEmpty, /aria-label="清除搜索"/)
})

test('媒体库选择器空态读屏名包含前往素材中心，且只有一个 primary', () => {
  assertEmptyStateContract('GlobalMediaPickerEmpty.vue', pickerEmpty, {
    maxPrimary: 1,
    requiredPrimaryLabel: '前往素材中心',
    wrapSelectors: [
      /\.picker-empty \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/,
      /\.picker-empty__actions :deep\(\.el-button\) \{[\s\S]*?white-space: normal;/,
    ],
  })
  assert.match(pickerEmpty, /aria-label="前往素材中心上传"/)
  assert.match(pickerEmpty, />前往素材中心上传</)
})

test('项目列表空态读屏名包含前往素材中心和查看回收站，窄屏不撑开', () => {
  const emptySlice = toolbar.match(/class="action-card action-card--empty"[\s\S]*?<\/section>/)?.[0] || ''
  assert.match(emptySlice, /aria-label="前往素材中心"/)
  assert.match(emptySlice, />前往素材中心/)
  assert.match(emptySlice, /aria-label="查看回收站"/)
  assert.match(emptySlice, />查看回收站/)
  assert.doesNotMatch(emptySlice, /action-btn-material[^>]*type="primary"/)
  assert.doesNotMatch(emptySlice, /action-btn-trash[^>]*type="primary"/)
  assert.match(toolbar, /\.action-card--empty \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;|\.action-card--empty \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/)
  assert.match(toolbar, /\.action-btn \{[\s\S]*?min-width: min\(150px, 100%\);[\s\S]*?max-width: 100%;/)
  assert.match(toolbar, /@media \(max-width: 620px\) \{[\s\S]*?white-space: normal;/)
  assert.match(libraryCss, /\.library-empty \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/)
  assert.match(libraryCss, /\.library-empty \.el-button \{[\s\S]*?white-space: normal;/)
  assert.match(sourceImport, /aria-label="清除搜索"[\s\S]*?>清除搜索</)
  assert.match(sourceImport, /\.source-import-state \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/)
})

const emptyUrl = new URL('../src/components/mediaLibrary/MediaLibraryEmptyState.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Files', 'Upload'])
const MediaLibraryEmptyState = await loadCompiledSfc(
  emptyUrl,
  'media-library-empty-state-closeout',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const renderer = createHostRenderer()

test('挂载后的素材中心空态只有一个 primary，读屏名等于可见文案', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(MediaLibraryEmptyState, {
    mediaAccessState: { navigationLocked: false, writeLocked: false },
    clearFilters: () => events.push('clear'),
    triggerUpload: () => events.push('upload'),
    goSourceImport: () => events.push('import'),
    goSearchNetwork: () => events.push('network'),
  }))
  try {
    await nextTick()
    const buttons = findByType(harness.root, 'button')
    const primaries = buttons.filter((node) => node.props['data-variant'] === 'primary')
    assert.equal(primaries.length, 1)
    assert.match(textContent(primaries[0]), /上传素材/)
    const upload = buttonByAriaLabel(harness.root, '上传素材')
    const network = buttonByAriaLabel(harness.root, '去搜网络素材')
    const imported = buttonByAriaLabel(harness.root, '选择目标项目后导入网页 URL')
    assert.equal(upload.props['aria-label'], '上传素材')
    assert.match(textContent(upload), /上传素材/)
    assert.equal(network.props['aria-label'], '去搜网络素材')
    assert.match(textContent(network), /去搜网络素材/)
    assert.equal(network.props['data-variant'], 'default')
    assert.equal(imported.props['data-variant'], 'default')
    assert.match(textContent(imported), /选择目标项目后导入网页 URL/)
  } finally {
    harness.app.unmount()
  }
})
