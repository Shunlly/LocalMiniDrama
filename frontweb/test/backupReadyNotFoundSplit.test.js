import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { isRecoverableNotFoundBackPath } from '../src/utils/notFoundNavigation.js'
import { readBackupPageSource, readBackupSettingsSource } from './helpers/backupPageSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

const nginxSource = read('../nginx.conf')
const backendAppUrl = new URL('../../backend-node/src/app.js', import.meta.url)
const hasBackendApp = existsSync(fileURLToPath(backendAppUrl))
const backendAppSource = hasBackendApp ? readFileSync(backendAppUrl, 'utf8').replace(/\r\n?/g, '\n') : ''
const backupPageSource = readBackupPageSource()
const backupSettingsSource = readBackupSettingsSource()
const routerSource = read('../src/router/index.js')
const viewsSource = read('../src/router/views.js')

test('生产 Nginx 把 /ready 精确代理到后端，不会回退成前端 HTML', () => {
  const healthzBlockStart = nginxSource.indexOf('location = /healthz {')
  const readyBlockStart = nginxSource.indexOf('location = /ready {')
  const spaBlockStart = nginxSource.indexOf('location / {')
  const assetsBlockStart = nginxSource.indexOf('location /assets/ {')
  assert.ok(healthzBlockStart >= 0, '缺少 location = /healthz')
  assert.ok(readyBlockStart >= 0, '缺少 location = /ready')
  assert.ok(spaBlockStart > healthzBlockStart, '/healthz 必须写在 SPA 回退之前')
  assert.ok(spaBlockStart > readyBlockStart, '/ready 必须写在 SPA 回退之前')
  assert.ok(assetsBlockStart > readyBlockStart, '/ready 必须写在静态资源规则之前')

  const healthzBlock = nginxSource.slice(healthzBlockStart, nginxSource.indexOf('}', healthzBlockStart))
  assert.match(healthzBlock, /proxy_pass http:\/\/backend:5679\/ready/)
  assert.doesNotMatch(healthzBlock, /try_files/)
  assert.doesNotMatch(healthzBlock, /index\.html/)

  const readyBlock = nginxSource.slice(readyBlockStart, nginxSource.indexOf('}', readyBlockStart))
  assert.match(readyBlock, /proxy_pass http:\/\/backend:5679\/ready/)
  assert.doesNotMatch(readyBlock, /try_files/)
  assert.doesNotMatch(readyBlock, /index\.html/)

  const assetsBlock = nginxSource.slice(assetsBlockStart, nginxSource.indexOf('location / {'))
  assert.match(assetsBlock, /try_files \$uri =404;/)
  assert.doesNotMatch(assetsBlock, /\/index\.html/)

  const spaBlock = nginxSource.slice(spaBlockStart)
  assert.match(spaBlock, /try_files \$uri \$uri\/ \/index\.html;/)
  assert.doesNotMatch(nginxSource, /location = \/media/)
  assert.doesNotMatch(nginxSource, /location = \/film/)
  assert.doesNotMatch(nginxSource, /location = \/ai-config/)
  if (hasBackendApp) {
    assert.match(backendAppSource, /app\.get\('\*', \(req, res, next\) => \{/)
    assert.match(backendAppSource, /req\.path\.startsWith\('\/api'\)/)
    assert.match(backendAppSource, /res\.sendFile\(indexHtml\)/)
  }
})

test('备份页继续请求 /ready，空 HTML 不会当成维护锁定', () => {
  assert.match(backupSettingsSource, /from '\.\/useBackupSettingsRestore\.js'/)
  assert.match(backupSettingsSource, /export \{ restoreConfirmationCopy \}/)
  assert.match(backupPageSource, /from '@\/composables\/useBackupSettings\.js'/)
  assert.doesNotMatch(backupPageSource, /useBackupSettingsRestore/)
  assert.match(backupPageSource, /loadReadiness\(\)/)
  assert.match(backupSettingsSource, /fetch\('\/ready'/)
  assert.match(backupSettingsSource, /if \(hasReadinessChecksPayload\(data\)\) return data/)
  assert.doesNotMatch(
    backupSettingsSource,
    /if \(hasReadinessChecksPayload\(data\)\) return data\s*if \(!response\.ok\) \{[\s\S]*return data/,
  )
  assert.match(backupPageSource, /v-if="readinessError"/)
  assert.match(backupPageSource, /v-if="hasSuccessfulReadinessLoad && readiness"/)
  assert.doesNotMatch(backupPageSource, /v-else-if="!readinessLoading && hasSuccessfulReadinessLoad && readiness"/)
})

test('备份路由是独立页面，404 可回到 /backup，不会被 catch-all 吞掉', () => {
  assert.match(routerSource, /path: '\/backup'/)
  assert.match(routerSource, /name: 'backup'/)
  assert.match(routerSource, /component: \(\) => import\('@\/views\/Backup\.vue'\)/)
  assert.match(routerSource, /if \(to\.name === 'not-found-catchall'\) \{/)
  assert.match(viewsSource, /id: 'backup', view: 'backup', label: '数据备份'/)
  assert.equal(isRecoverableNotFoundBackPath('/backup'), true)
  assert.equal(isRecoverableNotFoundBackPath('/backup?returnTo=/ai-config'), true)
  assert.equal(isRecoverableNotFoundBackPath('/ready'), false)
  assert.equal(isRecoverableNotFoundBackPath('/this-page-does-not-exist'), false)
})

test('备份页就绪文案说明是 /ready 而不是 SPA HTML', () => {
  const copySource = read('../src/components/backup/backupPageCopy.js')
  const readinessSource = read('../src/components/backup/BackupReadiness.vue')
  assert.match(copySource, /BACKUP_READY_NOT_SPA_HINT/)
  assert.match(copySource, /BACKUP_READY_SPA_HTML_MESSAGE/)
  assert.match(copySource, /\/ready/)
  assert.match(copySource, /SPA HTML/)
  assert.match(copySource, /looksLikeBackupReadySpaHtmlFailure/)
  assert.match(copySource, /describeBackupReadinessDisplayError/)
  assert.match(readinessSource, /BACKUP_READY_NOT_SPA_HINT/)
  assert.match(readinessSource, /BACKUP_READY_SPA_HTML_MESSAGE/)
  assert.match(readinessSource, /data-testid="backup-readiness-ready-hint"/)
  assert.match(readinessSource, /data-testid="backup-readiness-spa-html"/)
  assert.match(readinessSource, /from '\.\/backupPageCopy\.js'/)
  assert.match(backupPageSource, /aria-label="取消恢复备份"/)
  assert.match(backupPageSource, />取消恢复备份<\/el-button>/)
  assert.match(backupPageSource, /正在备份或恢复，离开会中断当前操作/)
})
