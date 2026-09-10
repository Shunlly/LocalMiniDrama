import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { isRecoverableNotFoundBackPath } from '../src/utils/notFoundNavigation.js'
import { requireValidDramaId } from '../src/utils/routeValidation.js'
import { APP_NAV_ITEMS, isAllowedView } from '../src/router/views.js'
import { resolveWorkspaceNavItem } from '../src/layouts/AppWorkspaceNav.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const scopedSources = [
  { name: 'App.vue', source: read('../src/App.vue') },
  { name: 'FilmList.vue', source: read('../src/views/FilmList.vue') },
  { name: 'DramaDetail.vue', source: read('../src/views/DramaDetail.vue') },
  { name: 'MediaLibrary.vue', source: read('../src/views/MediaLibrary.vue') },
  { name: 'Backup.vue', source: read('../src/views/Backup.vue') },
  { name: 'NotFound.vue', source: read('../src/views/NotFound.vue') },
]
const routerSource = read('../src/router/index.js')
const viewsSource = read('../src/router/views.js')
const filmListSource = scopedSources.find((item) => item.name === 'FilmList.vue').source
const mediaLibrarySource = scopedSources.find((item) => item.name === 'MediaLibrary.vue').source
const backupSource = scopedSources.find((item) => item.name === 'Backup.vue').source

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
    .replace(/\{\{[^}]+\}\}/g, '文案')
    .replace(/\s+/g, ' ')
    .trim()
}

test('范围内页面没有空 aria-label、英文按钮或非语义点击', () => {
  const emptyAria = []
  const englishButtons = []
  const nonSemanticClicks = []
  for (const { name, source } of scopedSources) {
    for (const match of source.matchAll(/(?:^|\s)(?:aria-label|:aria-label)\s*=\s*(["'])\s*\1/g)) {
      emptyAria.push(`${name} 空 aria-label`)
    }
    const template = templateOnly(source)
    for (const tag of openingTags(source, ['div', 'span', 'li', 'p', 'article', 'section', 'img'])) {
      if (!/@click/.test(tag.opening)) continue
      if (/(?:^|\s):?role\s*=/.test(tag.opening) || /(?:^|\s):?tabindex\s*=/.test(tag.opening) || /@keydown/.test(tag.opening)) continue
      nonSemanticClicks.push(`${name}:${tag.line}`)
    }
    for (const button of openingTags(source, ['button', 'el-button'])) {
      const closing = `</${button.tag}>`
      const closeIndex = button.template.indexOf(closing, button.innerStart)
      const inner = closeIndex >= 0 ? button.template.slice(button.innerStart, closeIndex) : ''
      const text = visibleButtonText(inner)
      if (/^[A-Za-z][A-Za-z0-9 +/_-]{0,24}$/.test(text) && !/[\u4e00-\u9fff]/.test(button.opening + inner)) {
        englishButtons.push(`${name}:${button.line}:${text}`)
      }
    }
    void template
  }
  assert.deepEqual(emptyAria, [])
  assert.deepEqual(nonSemanticClicks, [])
  assert.deepEqual(englishButtons, [])
})

test('顶栏已去掉微信入口，设置深链接接到备份页', () => {
  for (const { name, source } of scopedSources) {
    assert.doesNotMatch(source, /微信我/)
    assert.doesNotMatch(source, /WeChat/i)
    void name
  }
  assert.match(filmListSource, /<el-icon><Setting \/><\/el-icon>AI 配置/)
  assert.doesNotMatch(filmListSource, /<el-icon><Setting \/><\/el-icon>AI配置/)
  assert.match(routerSource, /path: '\/settings'[\s\S]*redirect: '\/backup'/)
  assert.match(viewsSource, /id: 'backup', view: 'backup', label: '数据备份'/)
  assert.equal(isAllowedView('backup'), true)
  assert.equal(resolveWorkspaceNavItem('backup').name, 'backup')
})

test('项目列表和素材中心的主导航走注册表，未知路径进入命名 404', () => {
  assert.deepEqual(APP_NAV_ITEMS.map((item) => item.id), ['list', 'media-library', 'free-create', 'ai-config', 'backup'])
  assert.match(filmListSource, /function goMaterialCenter\(\) \{\s*openWorkspaceNavItem\(router, 'media-library'\)\s*\}/)
  assert.match(filmListSource, /function goFreeCreate\(\) \{\s*openWorkspaceNavItem\(router, 'free-create'\)\s*\}/)
  assert.match(filmListSource, /openWorkspaceNavItem\(router, backupNavItem\.id, \{ query: \{ returnTo \} \}/)
  assert.match(mediaLibrarySource, /openWorkspaceNavItem\(router, 'list', \{ query: \{ new: '1' \} \}/)
  assert.match(mediaLibrarySource, /openWorkspaceNavItem\(router, 'list', \{ query: \{ intent: 'source-import' \} \}/)
  assert.match(routerSource, /if \(to\.name === 'not-found-catchall'\) \{\s*return resolveCatchallNotFoundLocation\(to\.fullPath, router\.options\.history\.state\?\.current\)/)
  assert.deepEqual(
    requireValidDramaId({ params: { id: 'abc' }, fullPath: '/drama/abc' }),
    { name: 'not-found', replace: true, query: { from: '/drama/abc' } },
  )
  assert.equal(isRecoverableNotFoundBackPath('/backup'), true)
  assert.equal(isRecoverableNotFoundBackPath('/backup?returnTo=/ai-config'), true)
})

test('备份页、回收站和素材预览弹窗保持中文操作名', () => {
  assert.match(backupSource, /aria-label="创建全量备份"/)
  assert.match(backupSource, /创建备份/)
  assert.match(backupSource, /选择备份文件/)
  assert.match(backupSource, /aria-label="确认恢复备份"/)
  assert.match(filmListSource, /aria-label="打开项目回收站"/)
  assert.match(filmListSource, /:aria-label="`恢复项目「\$\{item\.title \|\| '未命名项目'\}」`"/)
  assert.match(mediaLibrarySource, /aria-label="上传图片或视频到素材中心"/)
  assert.match(mediaLibrarySource, />关闭预览<\/el-button>/)
})

test('项目包导入导出和 404 回退都有中文离开或返回文案', () => {
  assert.match(filmListSource, /function hasPendingProjectPackageWork\(\)/)
  assert.match(filmListSource, /项目包正在导入，请完成后再离开。/)
  assert.match(filmListSource, /项目包正在导出，请完成后再离开。/)
  assert.match(filmListSource, /aria-label="导入项目包"/)
  const notFoundSource = read('../src/views/NotFound.vue')
  assert.match(notFoundSource, /aria-label="返回项目列表"/)
  assert.match(notFoundSource, /aria-label="返回上一页"/)
})
