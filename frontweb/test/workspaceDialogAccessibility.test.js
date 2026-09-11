import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFilmListSources } from './helpers/filmListSources.js'
import { readDramaDetailResourceDialogSources } from './helpers/dramaDetailResourceDialogSources.js'

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


const filmListFiles = readFilmListSources()
const filmListSource = filmListFiles.view
const filmListHeaderSource = filmListFiles.header
const filmListBannersSource = filmListFiles.banners
const filmListToolbarSource = filmListFiles.toolbar
const filmListLibrarySource = read('../src/components/filmList/FilmListLibraryDialogs.vue')
const filmListCharLibrarySource = read('../src/components/filmList/FilmListCharLibraryDialogs.vue')
const filmListSceneLibrarySource = read('../src/components/filmList/FilmListSceneLibraryDialogs.vue')
const filmListPropLibrarySource = read('../src/components/filmList/FilmListPropLibraryDialogs.vue')
const filmListLibraryUiSource = [filmListLibrarySource, filmListCharLibrarySource, filmListSceneLibrarySource, filmListPropLibrarySource].join('\n')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const dramaDetailDialogsSource = readDramaDetailResourceDialogSources(read)
const mediaLibraryPageSource = read('../src/views/MediaLibrary.vue')
const mediaLibraryHeaderSource = read('../src/components/mediaLibrary/MediaLibraryHeader.vue')
const mediaLibraryFilterSource = read('../src/components/mediaLibrary/MediaLibraryFilterBar.vue')
const mediaLibraryLocalGridSource = read('../src/components/mediaLibrary/MediaLibraryLocalGrid.vue')
const mediaLibraryNetworkSource = read('../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue')
const mediaLibrarySource = [mediaLibraryPageSource, mediaLibraryHeaderSource, mediaLibraryFilterSource, mediaLibraryLocalGridSource, mediaLibraryNetworkSource].join('\n')
const dramaCanvasSource = read('../src/views/DramaCanvas.vue')
const aiConfigSource = read('../src/views/AiConfig.vue')
const aiConfigOneKeyDialogsSource = read('../src/components/aiConfig/AiConfigOneKeyDialogs.vue')
const aiConfigBulkKeyDialogSource = read('../src/components/aiConfig/AiConfigBulkKeyDialog.vue')
const aiConfigConnectionTestDialogSource = read('../src/components/aiConfig/AiConfigConnectionTestDialog.vue')
const aiConfigJimeng2AssetsDialogSource = read('../src/components/aiConfig/AiConfigJimeng2AssetsDialog.vue')
const backupSource = read('../src/views/Backup.vue')
const accessibleDialogSource = read('../src/components/AccessibleDialog.vue')
const readinessSource = read('../src/components/ProjectReadinessPanel.vue')

const targetSources = [
  { name: '../src/views/FilmList.vue', source: filmListSource },
  { name: '../src/components/filmList/FilmListHeader.vue', source: filmListHeaderSource },
  { name: '../src/components/filmList/FilmListFailureBanners.vue', source: filmListBannersSource },
  { name: '../src/components/filmList/FilmListWorkspaceToolbar.vue', source: filmListToolbarSource },
  { name: '../src/components/filmList/FilmListLibraryDialogs.vue', source: filmListLibrarySource },
  { name: '../src/components/filmList/FilmListCharLibraryDialogs.vue', source: filmListCharLibrarySource },
  { name: '../src/components/filmList/FilmListSceneLibraryDialogs.vue', source: filmListSceneLibrarySource },
  { name: '../src/components/filmList/FilmListPropLibraryDialogs.vue', source: filmListPropLibrarySource },
  { name: '../src/views/DramaDetail.vue', source: dramaDetailSource },
  { name: '../src/components/dramaDetail/DramaDetailHeader.vue', source: read('../src/components/dramaDetail/DramaDetailHeader.vue') },
  { name: '../src/components/dramaDetail/DramaDetailLoadState.vue', source: read('../src/components/dramaDetail/DramaDetailLoadState.vue') },
  { name: '../src/components/dramaDetail/DramaDetailInfoCard.vue', source: read('../src/components/dramaDetail/DramaDetailInfoCard.vue') },
  { name: '../src/components/dramaDetail/DramaDetailResourceDialogs.vue', source: read('../src/components/dramaDetail/DramaDetailResourceDialogs.vue') },
  { name: '../src/components/dramaDetail/DramaDetailResourceImageEditor.vue', source: read('../src/components/dramaDetail/DramaDetailResourceImageEditor.vue') },
  { name: '../src/components/dramaDetail/DramaDetailCharacterEditDialogs.vue', source: read('../src/components/dramaDetail/DramaDetailCharacterEditDialogs.vue') },
  { name: '../src/components/dramaDetail/DramaDetailSceneEditDialogs.vue', source: read('../src/components/dramaDetail/DramaDetailSceneEditDialogs.vue') },
  { name: '../src/components/dramaDetail/DramaDetailPropEditDialogs.vue', source: read('../src/components/dramaDetail/DramaDetailPropEditDialogs.vue') },
  { name: '../src/views/MediaLibrary.vue', source: mediaLibraryPageSource },
  { name: '../src/components/mediaLibrary/MediaLibraryHeader.vue', source: mediaLibraryHeaderSource },
  { name: '../src/components/mediaLibrary/MediaLibraryFilterBar.vue', source: mediaLibraryFilterSource },
  { name: '../src/components/mediaLibrary/MediaLibraryLocalGrid.vue', source: mediaLibraryLocalGridSource },
  { name: '../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue', source: mediaLibraryNetworkSource },
  { name: '../src/views/DramaCanvas.vue', source: dramaCanvasSource },
  { name: '../src/views/AiConfig.vue', source: aiConfigSource },
  { name: '../src/components/aiConfig/AiConfigOneKeyDialogs.vue', source: aiConfigOneKeyDialogsSource },
  { name: '../src/components/aiConfig/AiConfigBulkKeyDialog.vue', source: aiConfigBulkKeyDialogSource },
  { name: '../src/components/aiConfig/AiConfigConnectionTestDialog.vue', source: aiConfigConnectionTestDialogSource },
  { name: '../src/components/aiConfig/AiConfigJimeng2AssetsDialog.vue', source: aiConfigJimeng2AssetsDialogSource },
  { name: '../src/views/Backup.vue', source: backupSource },
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

test('AI 配置入口返回文案与顶栏焦点环一致', () => {
  assert.match(aiConfigSource, /<button type="button" class="logo" :aria-label="logoBackLabel" @click="goBack">/)
  assert.match(aiConfigSource, /const logoBackLabel = computed\(\(\) => '本地短剧助手，' \+ backButtonLabel\.value\)/)
  assert.match(aiConfigSource, /class="btn-back" :aria-label="backButtonLabel"/)
  assert.match(aiConfigSource, /return returnTo\.value \? '返回原项目' : '返回项目列表'/)
  assert.doesNotMatch(aiConfigSource, /返回首页/)
  assert.match(aiConfigSource, /\.logo:focus-visible,[\s\S]*\.btn-backup:focus-visible,[\s\S]*\.btn-back:focus-visible/)
})

test('成片就绪度未就绪服务会说出原因，芯片可键盘看见焦点', () => {
  assert.match(readinessSource, /function serviceChipText\(service\)/)
  assert.match(readinessSource, /前往配置\$\{service\.label\}：\$\{detail\}/)
  assert.match(readinessSource, /:title="serviceChipText\(service\)"/)
  assert.match(readinessSource, /:aria-label="serviceChipText\(service\)"/)
  assert.match(readinessSource, /aria-describedby="project-readiness-next-description"/)
  assert.match(readinessSource, /button\.service-chip:focus-visible/)
  assert.doesNotMatch(readinessSource, /:disabled/)
})

test('对话框搜索框和新建项目比例选择器有可访问名称', () => {
  assert.match(filmListSource, /aria-label="画面比例"/)
  assert.match(filmListLibraryUiSource, /aria-label="搜索角色素材"/)
  assert.match(filmListLibraryUiSource, /aria-label="搜索场景素材"/)
  assert.match(filmListLibraryUiSource, /aria-label="搜索道具素材"/)
  assert.match(dramaDetailDialogsSource, /aria-label="角色类型"/)
  assert.match(dramaDetailDialogsSource, /aria-label="搜索待导入素材"/)
  assert.match(mediaLibrarySource, /aria-label="搜索素材"/)
})
