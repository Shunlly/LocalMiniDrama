import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function templateOnly(source) {
  const start = source.indexOf('<template')
  const end = source.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, 'Vue source must contain template and script blocks')
  return source
    .slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function openingTags(source, tagNames) {
  const template = templateOnly(source)
  const names = new Set(tagNames)
  const tags = []
  const matcher = /<([a-z][\w-]*)\b/g
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

function namedOnControl(opening) {
  return /\s(?::|v-bind:)?aria-(?:label|labelledby)\s*=/.test(opening)
}

function buttonElements(source) {
  return openingTags(source, ['button', 'el-button']).map((button) => {
    const selfClosing = /\/\s*>$/.test(button.opening)
    const closing = `</${button.tag}>`
    const closeIndex = selfClosing ? button.innerStart : button.template.indexOf(closing, button.innerStart)
    assert.ok(closeIndex >= button.innerStart, `Missing ${closing} near template line ${button.line}`)
    return {
      ...button,
      inner: selfClosing ? '' : button.template.slice(button.innerStart, closeIndex),
    }
  })
}

function visibleButtonText(inner) {
  return inner
    .replace(/<el-icon\b[\s\S]*?<\/el-icon>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const filmListSource = read('../src/views/FilmList.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const mediaLibrarySource = read('../src/views/MediaLibrary.vue')
const dramaCanvasSource = read('../src/views/DramaCanvas.vue')
const aiConfigSource = read('../src/views/AiConfig.vue')
const accessibleDialogSource = read('../src/components/AccessibleDialog.vue')

const targetSources = [
  { name: '../src/views/FilmList.vue', source: filmListSource },
  { name: '../src/views/DramaDetail.vue', source: dramaDetailSource },
  { name: '../src/views/MediaLibrary.vue', source: mediaLibrarySource },
  { name: '../src/views/DramaCanvas.vue', source: dramaCanvasSource },
  { name: '../src/views/AiConfig.vue', source: aiConfigSource },
]

test('列表、剧集、素材、画布和配置页的 Plus 与图标按钮都有可访问名称', () => {
  const unnamed = []
  for (const { name, source } of targetSources) {
    for (const button of buttonElements(source)) {
      const text = visibleButtonText(button.inner)
      const showsPlus = /<Plus\b/.test(button.inner) || /^[+＋]/.test(text)
      const symbolOnly = /^[+＋×✕✖−-]$/.test(text)
      if ((!text || showsPlus || symbolOnly) && !namedOnControl(button.opening)) {
        unnamed.push(`${name}:${button.line} ${button.opening.replace(/\s+/g, ' ')}`)
      }
    }
  }
  assert.deepEqual(unnamed, [], `Buttons without names:\n${unnamed.join('\n')}`)
})

test('这些页面的选择器和数字输入都有可访问名称', () => {
  const unnamed = []
  for (const { name, source } of targetSources) {
    for (const control of openingTags(source, ['el-select', 'el-input-number'])) {
      if (!namedOnControl(control.opening)) {
        unnamed.push(`${name}:${control.line} ${control.opening.replace(/\s+/g, ' ')}`)
      }
    }
  }
  assert.deepEqual(unnamed, [], `Controls without names:\n${unnamed.join('\n')}`)
})

test('非语义节点不会承担点击关闭或打开弹窗', () => {
  const violations = []
  for (const { name, source } of targetSources) {
    for (const tag of openingTags(source, ['div', 'span', 'li', 'p', 'article', 'section', 'img'])) {
      if (!/@click/.test(tag.opening)) continue
      if (/\srole\s*=/.test(tag.opening) || /\stabindex\s*=/.test(tag.opening)) continue
      violations.push(`${name}:${tag.line} ${tag.opening.replace(/\s+/g, ' ')}`)
    }
  }
  assert.deepEqual(violations, [])
})

test('AccessibleDialog 默认禁止遮罩关闭并保留 ESC', () => {
  assert.match(accessibleDialogSource, /closeOnClickModal:\s*\{\s*type:\s*Boolean,\s*default:\s*false/)
  assert.match(accessibleDialogSource, /:close-on-click-modal="closeOnClickModal"/)
  assert.match(accessibleDialogSource, /:data-accessible-dialog-id="instanceId"/)
  assert.doesNotMatch(accessibleDialogSource, /closeOnPressEscape:\s*\{\s*type:\s*Boolean,\s*default:\s*false/)
})

test('表单弹窗禁止点遮罩关闭，素材预览允许遮罩和 ESC 关闭', () => {
  assert.match(filmListSource, /<AccessibleDialog[\s\S]*?title="新建项目"[\s\S]*?:close-on-click-modal="false"/)
  assert.match(filmListSource, /<AccessibleDialog[\s\S]*?title="编辑项目"[\s\S]*?:close-on-click-modal="false"/)
  assert.match(mediaLibrarySource, /title="素材预览"[\s\S]*?:close-on-click-modal="true"[\s\S]*?:close-on-press-escape="true"/)
  assert.match(mediaLibrarySource, /title="网络素材预览"[\s\S]*?:close-on-click-modal="true"[\s\S]*?:close-on-press-escape="true"/)
})

test('对话框搜索框和新建项目比例选择器有可访问名称', () => {
  assert.match(filmListSource, /aria-label="画面比例"/)
  assert.match(filmListSource, /aria-label="搜索角色素材"/)
  assert.match(filmListSource, /aria-label="搜索场景素材"/)
  assert.match(filmListSource, /aria-label="搜索道具素材"/)
  assert.match(dramaDetailSource, /aria-label="角色类型"/)
  assert.match(dramaDetailSource, /aria-label="搜索待导入素材"/)
  assert.match(mediaLibrarySource, /aria-label="搜索素材"/)
})
