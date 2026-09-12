import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describeBackupError } from '../src/composables/useBackupSettings.js'
import {
  BACKUP_LEAVE_CONFIRM_BUTTON_TEXT,
  BACKUP_LEAVE_CONFIRM_MESSAGE,
  BACKUP_LEAVE_CONFIRM_TITLE,
  BACKUP_LEAVE_STAY_BUTTON_TEXT,
  BACKUP_READY_SPA_HTML_MESSAGE,
  BACKUP_RESTORE_CANCEL_TEXT,
} from '../src/components/backup/backupPageCopy.js'
import { resolveNotFoundCopy } from '../src/utils/notFoundNavigation.js'
import { readBackupPageSource } from './helpers/backupPageSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

const appSource = read('../src/App.vue')
const notFoundSource = read('../src/views/NotFound.vue')
const backupPageSource = readBackupPageSource()
const backupCopySource = read('../src/components/backup/backupPageCopy.js')
const backupCss = read('../src/components/backup/backupPage.css')
const backupViewSource = read('../src/views/Backup.vue')
const filmListHeaderSource = read('../src/components/filmList/FilmListHeader.vue')
const dramaHeaderSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const canvasHeaderSource = read('../src/components/dramaCanvas/CanvasPageHeader.vue')
const filmCreateHeaderSource = read('../src/components/filmCreate/FilmCreateHeader.vue')
const aiConfigSource = read('../src/views/AiConfig.vue')
const freeCreateHeaderSource = read('../src/components/freeCreate/FreeCreateHeader.vue')
const mediaHeaderSource = read('../src/components/mediaLibrary/MediaLibraryHeader.vue')
const leaveProtectionSource = read('../src/layouts/routeLeaveProtection.js')
const nginxSource = read('../nginx.conf')

const headerSources = [
  ['App.vue', appSource],
  ['FilmListHeader.vue', filmListHeaderSource],
  ['DramaDetailHeader.vue', dramaHeaderSource],
  ['CanvasPageHeader.vue', canvasHeaderSource],
  ['FreeCreateHeader.vue', freeCreateHeaderSource],
  ['MediaLibraryHeader.vue', mediaHeaderSource],
  ['AiConfig.vue', aiConfigSource],
  ['NotFound.vue', notFoundSource],
  ['Backup.vue', backupViewSource],
]

function templateOnly(source) {
  const blocks = []
  let cursor = 0
  while (true) {
    const start = source.indexOf('<template', cursor)
    if (start < 0) break
    const end = source.indexOf('</template>', start)
    if (end < 0) break
    blocks.push(source.slice(start, end + '</template>'.length))
    cursor = end + '</template>'.length
  }
  return blocks.join('\n').replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
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

test('页头没有微信我，可点 Logo 读屏名是本地短剧助手，返回项目列表', () => {
  for (const [name, source] of headerSources) {
    assert.doesNotMatch(source, /微信我/, name)
    assert.doesNotMatch(source, /WeChat/i, name)
  }
  assert.match(canvasHeaderSource, /aria-label="本地短剧助手，返回项目列表"/)
  assert.match(dramaHeaderSource, /aria-label="本地短剧助手，返回项目列表"/)
  assert.match(filmCreateHeaderSource, /aria-label="本地短剧助手，返回项目列表"/)
  assert.match(aiConfigSource, /const logoBackLabel = computed\(\(\) => '本地短剧助手，' \+ backButtonLabel\.value\)/)
  assert.match(aiConfigSource, /return returnTo\.value \? '返回原项目' : '返回项目列表'/)
})

test('404 主按钮仍是返回项目列表，装饰数字不对读屏朗读', () => {
  assert.match(notFoundSource, />返回项目列表<\/el-button>/)
  assert.match(notFoundSource, /aria-label="返回项目列表"/)
  assert.match(notFoundSource, /<p class="status-code" aria-hidden="true">404<\/p>/)
  assert.match(notFoundSource, /<h1 id="not-found-title"[^>]*>\{\{ copy.title \}\}<\/h1>/)
  const copy = resolveNotFoundCopy('/this-page-does-not-exist')
  assert.equal(copy.title, '页面不存在')
  assert.match(copy.reason, /这个地址不在应用里/)
  assert.doesNotMatch(copy.title, /HTTP\s*\d{3}/)
  assert.doesNotMatch(copy.reason, /HTTP\s*\d{3}/)
  assert.doesNotMatch(copy.nextStep, /HTTP\s*\d{3}/)
  assert.doesNotMatch(copy.nextStep, /\b(Cancel|Retry|Home|Back)\b/)
})

test('备份恢复取消仍是取消恢复备份，离开确认走中文 ElMessageBox', () => {
  assert.equal(BACKUP_RESTORE_CANCEL_TEXT, '取消恢复备份')
  assert.match(backupPageSource, /aria-label="取消恢复备份"/)
  assert.match(backupPageSource, />取消恢复备份<\/el-button>/)
  assert.match(backupCopySource, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.match(backupCopySource, /await ElMessageBox\.confirm\(/)
  assert.match(backupCopySource, /confirmButtonText: BACKUP_LEAVE_CONFIRM_BUTTON_TEXT/)
  assert.match(backupCopySource, /cancelButtonText: BACKUP_LEAVE_STAY_BUTTON_TEXT/)
  assert.equal(BACKUP_LEAVE_CONFIRM_TITLE, '确认离开？')
  assert.equal(BACKUP_LEAVE_CONFIRM_BUTTON_TEXT, '离开')
  assert.equal(BACKUP_LEAVE_STAY_BUTTON_TEXT, '继续留在本页')
  assert.match(BACKUP_LEAVE_CONFIRM_MESSAGE, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(BACKUP_LEAVE_CONFIRM_MESSAGE, /leave|unload|busy|confirm/i)
  assert.doesNotMatch(backupCopySource, /window\.confirm/)
  assert.doesNotMatch(backupViewSource, /window\.confirm/)
  assert.doesNotMatch(leaveProtectionSource, /window\.confirm/)
  assert.doesNotMatch(appSource, /window\.confirm/)
})

test('备份失败不会把 HTTP 状态码或英文错误码直接渲给用户', () => {
  assert.equal(describeBackupError({ response: { status: 404 } }), '备份服务未找到')
  assert.equal(describeBackupError({ response: { status: 503 } }), '备份服务暂时不可用，请稍后重试')
  assert.doesNotMatch(describeBackupError({ response: { status: 500 } }), /HTTP\s*\d{3}|\b500\b/)
  assert.doesNotMatch(describeBackupError({ code: 'NOT_FOUND' }), /NOT_FOUND/)
  assert.doesNotMatch(BACKUP_READY_SPA_HTML_MESSAGE, /HTTP\s*\d{3}/)
  assert.doesNotMatch(BACKUP_READY_SPA_HTML_MESSAGE, /<!DOCTYPE html/i)
  const backupTemplate = templateOnly(read('../src/components/backup/BackupReadiness.vue'))
    + templateOnly(read('../src/components/backup/BackupFailureBanners.vue'))
    + templateOnly(read('../src/components/backup/BackupRestoreDialog.vue'))
  assert.doesNotMatch(backupTemplate, /HTTP\s*\d{3}/)
  assert.doesNotMatch(backupTemplate, /\b(Cancel|Retry|OK|Close|Restore)\b/)
})

test('404、备份页和全局页头没有英文按钮', () => {
  const englishButtons = []
  const scoped = [
    ['NotFound.vue', notFoundSource],
    ['Backup page', backupPageSource],
    ['FilmListHeader.vue', filmListHeaderSource],
    ['DramaDetailHeader.vue', dramaHeaderSource],
    ['CanvasPageHeader.vue', canvasHeaderSource],
    ['FreeCreateHeader.vue', freeCreateHeaderSource],
    ['MediaLibraryHeader.vue', mediaHeaderSource],
    ['AiConfig.vue', aiConfigSource],
  ]
  for (const [name, source] of scoped) {
    for (const button of openingTags(source, ['button', 'el-button'])) {
      const closing = `</${button.tag}>`
      const closeIndex = button.template.indexOf(closing, button.innerStart)
      const inner = closeIndex >= 0 ? button.template.slice(button.innerStart, closeIndex) : ''
      const text = visibleButtonText(inner)
      if (/^[A-Za-z][A-Za-z0-9 +/_-]{0,24}$/.test(text) && !/[\u4e00-\u9fff]/.test(button.opening + inner)) {
        englishButtons.push(`${name}:${button.line}:${text}`)
      }
    }
  }
  assert.deepEqual(englishButtons, [])
})

test('窄屏页头和备份恢复区会折行，不再用 96vw 撑出横向滚动', () => {
  assert.match(filmListHeaderSource, /overflow-x: clip;/)
  assert.match(filmListHeaderSource, /max-width: min\(1400px, 100%\);/)
  assert.doesNotMatch(filmListHeaderSource, /96vw/)
  assert.match(filmListHeaderSource, /\.header-actions \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(filmListHeaderSource, /@media \(max-width: 960px\)/)
  assert.match(dramaHeaderSource, /overflow-x: clip;/)
  assert.match(dramaHeaderSource, /max-width: min\(1200px, 100%\);/)
  assert.doesNotMatch(dramaHeaderSource, /96vw/)
  assert.match(dramaHeaderSource, /@media \(max-width: 1100px\)/)
  assert.match(dramaHeaderSource, /id="drama-header-episode-reason"/)
  assert.match(canvasHeaderSource, /overflow-x: clip;/)
  assert.match(canvasHeaderSource, /class="episode-select"/)
  assert.match(canvasHeaderSource, /width: min\(150px, 100%\);/)
  assert.match(freeCreateHeaderSource, /overflow-x: clip;/)
  assert.match(mediaHeaderSource, /overflow-x: clip;/)
  assert.match(aiConfigSource, /overflow-x: clip;/)
  assert.match(notFoundSource, /overflow-x: clip;/)
  assert.match(notFoundSource, /overflow-wrap: anywhere;/)
  assert.match(backupViewSource, /overflow-x: clip;/)
  assert.match(backupCss, /\.backup-item-copy strong,[\s\S]*overflow-wrap: anywhere;/)
  assert.match(
    backupCss,
    /@media \(max-width: 720px\) \{[\s\S]*\.backup-item,[\s\S]*\.selected-file,[\s\S]*\.maintenance-status \{[\s\S]*flex-direction: column;/,
  )
})

test('生产 Nginx 仍把 /ready 精确代理到后端，写在 SPA 回退之前', () => {
  const readyBlockStart = nginxSource.indexOf('location = /ready {')
  const spaBlockStart = nginxSource.indexOf('location / {')
  assert.ok(readyBlockStart >= 0, '缺少 location = /ready')
  assert.ok(spaBlockStart > readyBlockStart, '/ready 必须写在 SPA 回退之前')
  const readyBlock = nginxSource.slice(readyBlockStart, nginxSource.indexOf('}', readyBlockStart))
  assert.match(readyBlock, /proxy_pass http:\/\/backend:5679\/ready/)
  assert.doesNotMatch(readyBlock, /try_files/)
  assert.doesNotMatch(readyBlock, /index\.html/)
})
