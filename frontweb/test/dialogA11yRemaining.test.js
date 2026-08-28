import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const skipFiles = new Set([
  'AIConfigContent.vue',
  'Sd2AssetManagement.vue',
  'PromptEditor.vue',
  'SceneModelMap.vue',
  'EpisodeBatchImportDialog.vue',
])

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

function collectVueFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectVueFiles(entryPath)
    if (!entry.isFile() || !entry.name.endsWith('.vue') || skipFiles.has(entry.name)) return []
    return [entryPath]
  })
}

function templateOnly(source) {
  const start = source.indexOf('<template')
  const end = source.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, 'Vue 源码必须包含 template 与 script')
  return source
    .slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function openingTags(source, tagNames) {
  const template = typeof source === 'string' && source.includes('<template') ? templateOnly(source) : source
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
      line: template.slice(0, match.index).split('\n').length,
    })
    matcher.lastIndex = index + 1
  }
  return tags
}

function namedOnControl(opening) {
  return /\s(?::|v-bind:)?aria-(?:label|labelledby)\s*=/.test(opening)
}

function isHiddenFileInput(opening) {
  return /type\s*=\s*['"]file['"]/.test(opening)
    && (/aria-hidden/.test(opening) || /display:\s*none/.test(opening) || /hidden-file-input|reference-file-input/.test(opening))
}

function hasKeyboardSemantics(opening) {
  return /(?:^|\s):?role\s*=/.test(opening)
    || /(?:^|\s):?tabindex\s*=/.test(opening)
    || /@keydown/.test(opening)
}

const resourcePanelSource = read('../src/components/filmCreate/FilmCreateResourcePanel.vue')
const resourceDialogsSource = read('../src/components/filmCreate/FilmCreateResourceDialogs.vue')
const storyboardDialogsSource = read('../src/components/filmCreate/FilmCreateStoryboardDialogs.vue')
const novelImportSource = read('../src/components/filmCreate/FilmCreateNovelImportDialog.vue')
const stylePickerSource = read('../src/components/StylePickerButton.vue')
const canvasCreateSource = read('../src/components/dramaCanvas/CanvasCreateDialog.vue')
const contextMenuSource = read('../src/components/dramaCanvas/CanvasContextMenu.vue')
const imagePreviewSource = read('../src/components/ImagePreviewDialog.vue')
const omniEditorSource = read('../src/components/UniversalSegmentOmniAtEditor.vue')
const scriptWorkbenchSource = read('../src/components/filmCreate/FilmCreateScriptWorkbench.vue')
const accessibleDialogSource = read('../src/components/AccessibleDialog.vue')
const themeSource = read('../src/styles/theme.css')

const dialogSources = [
  { name: 'StylePickerButton.vue', source: stylePickerSource },
  { name: 'CanvasCreateDialog.vue', source: canvasCreateSource },
  { name: 'FilmCreateNovelImportDialog.vue', source: novelImportSource },
  { name: 'FilmCreateResourceDialogs.vue', source: resourceDialogsSource },
  { name: 'FilmCreateStoryboardDialogs.vue', source: storyboardDialogsSource },
  { name: 'FilmCreateScriptWorkbench.vue', source: scriptWorkbenchSource },
  { name: 'GlobalMediaPickerDialog.vue', source: read('../src/components/GlobalMediaPickerDialog.vue') },
  { name: 'ImagePreviewDialog.vue', source: imagePreviewSource },
]

test('允许范围内的非语义节点不会单独承担点击', () => {
  const violations = []
  for (const filePath of collectVueFiles(path.join(sourceRoot, 'components'))) {
    const relativePath = path.relative(sourceRoot, filePath).replaceAll(path.sep, '/')
    const source = readFileSync(filePath, 'utf8')
    for (const tag of openingTags(source, ['div', 'span', 'li', 'p', 'article', 'section', 'img', 'i'])) {
      if (!/@click/.test(tag.opening)) continue
      if (hasKeyboardSemantics(tag.opening)) continue
      violations.push(`${relativePath}:${tag.line} ${tag.opening.replace(/\s+/g, ' ')}`)
    }
  }
  assert.deepEqual(violations, [], `非语义点击:\n${violations.join('\n')}`)
})

test('剩余弹窗的可编辑控件都有可访问名称', () => {
  const unnamed = []
  for (const { name, source } of dialogSources) {
    for (const control of openingTags(source, ['el-input', 'el-select', 'el-input-number', 'el-radio-group', 'input', 'textarea'])) {
      if (isHiddenFileInput(control.opening)) continue
      if (!namedOnControl(control.opening)) {
        unnamed.push(`${name}:${control.line} ${control.opening.replace(/\s+/g, ' ')}`)
      }
    }
  }
  assert.deepEqual(unnamed, [], `缺 label:\n${unnamed.join('\n')}`)
})

test('资源面板跳转分镜芯片是原生按钮，封面仅在可预览时作为按钮', () => {
  assert.equal((resourcePanelSource.match(/<button\b[^>]*class="asl-chip"/g) || []).length, 3)
  assert.match(resourcePanelSource, /:aria-label="`跳转到分镜 \$\{sb\.storyboard_number\}`"/)
  assert.doesNotMatch(resourcePanelSource, /<span\b[^>]*class="asl-chip"/)
  assert.match(resourcePanelSource, /:role="hasAssetImage\(char\) \? 'button' : undefined"/)
  assert.match(resourcePanelSource, /:role="hasAssetImage\(prop\) \? 'button' : undefined"/)
  assert.match(resourcePanelSource, /:role="hasAssetImage\(scene\) \? 'button' : undefined"/)
  assert.match(resourcePanelSource, /\.asl-chip:focus-visible/)
})

test('资源库搜索框和工作台弹窗字段有中文可访问名称', () => {
  assert.match(resourceDialogsSource, /aria-label="搜索角色素材"/)
  assert.match(resourceDialogsSource, /aria-label="搜索本剧角色"/)
  assert.match(resourceDialogsSource, /aria-label="搜索道具素材"/)
  assert.match(resourceDialogsSource, /aria-label="搜索本剧道具"/)
  assert.match(resourceDialogsSource, /aria-label="搜索场景素材"/)
  assert.match(resourceDialogsSource, /aria-label="搜索本剧场景"/)
  assert.match(stylePickerSource, /aria-label="搜索风格名称"/)
  assert.match(novelImportSource, /aria-label="小说正文"/)
  assert.match(novelImportSource, /aria-label="小说导入方式"/)
  assert.match(scriptWorkbenchSource, /aria-label="故事梗概"/)
  assert.match(scriptWorkbenchSource, /aria-label="剧本内容"/)
  assert.match(canvasCreateSource, /aria-label="角色名称"/)
  assert.match(canvasCreateSource, /aria-label="场景地点"/)
  assert.match(canvasCreateSource, /aria-label="道具名称"/)
  assert.match(storyboardDialogsSource, /:aria-label="`分镜\$\{videoParamsTarget\.storyboard_number \|\| videoParamsTarget\.id\}标题`"/)
  assert.match(storyboardDialogsSource, /:aria-label="`分镜\$\{videoParamsTarget\.storyboard_number \|\| videoParamsTarget\.id\}动作`"/)
  assert.match(storyboardDialogsSource, /:aria-label="`分镜\$\{videoParamsTarget\.storyboard_number \|\| videoParamsTarget\.id\}创作模式`"/)
})

test('表单弹窗禁止点遮罩关闭，图片预览允许遮罩和 ESC 关闭', () => {
  assert.match(accessibleDialogSource, /closeOnClickModal:\s*\{\s*type:\s*Boolean,\s*default:\s*false/)
  assert.match(imagePreviewSource, /:close-on-click-modal="true"/)
  assert.match(imagePreviewSource, /:close-on-press-escape="true"/)
  assert.match(novelImportSource, /:close-on-click-modal="false"/)
  assert.doesNotMatch(stylePickerSource, /:close-on-click-modal="true"/)
  assert.doesNotMatch(canvasCreateSource, /:close-on-click-modal="true"/)
  assert.doesNotMatch(resourceDialogsSource, /:close-on-click-modal="true"/)
  assert.doesNotMatch(storyboardDialogsSource, /:close-on-click-modal="true"/)
})

test('画布上下文菜单可键盘打开关闭并回到触发器', () => {
  assert.match(contextMenuSource, /role="menu"/)
  assert.match(contextMenuSource, /role="menuitem"/)
  assert.match(contextMenuSource, /aria-label="画布操作菜单"/)
  assert.match(contextMenuSource, /aria-hidden="true"/)
  assert.match(contextMenuSource, /querySelector\?\.\('button\.ctx-item'\)/)
  assert.match(contextMenuSource, /function onMenuKeydown\(event\)/)
  assert.match(contextMenuSource, /event\.key === 'ArrowDown'/)
  assert.match(contextMenuSource, /event\.key === 'Escape'/)
  assert.match(contextMenuSource, /returnFocus\?\.focus\(\)/)
})

test('全能片段编辑器是带名称的文本框，焦点环全局可见', () => {
  assert.match(omniEditorSource, /role="textbox"/)
  assert.match(omniEditorSource, /aria-multiline="true"/)
  assert.match(omniEditorSource, /:aria-label="resolvedAriaLabel"/)
  assert.match(omniEditorSource, /role="listbox"/)
  assert.match(omniEditorSource, /aria-label="插入参考图"/)
  assert.match(themeSource, /button:focus-visible/)
  assert.match(themeSource, /\[role="button"\]:focus-visible/)
})
