import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BACKUP_ERROR_MESSAGES,
  backupAccessState,
  describeBackupError,
  formatBackupSize,
  formatBackupTimestamp,
  normalizeBackupList,
  normalizeBackupReturnTo,
  parseReadinessPayload,
  restoreConfirmationCopy,
  useBackupSettings,
  validateBackupFile,
} from '../src/composables/useBackupSettings.js'
import {
  getOperationLogs,
  installOperationLogSink,
  resetOperationLogs,
} from '../src/utils/operationLog.js'
import { createLocationSanitizer } from '../src/router/navigation.js'

import { readBackupPageSource, readBackupSettingsSource } from './helpers/backupPageSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = readBackupPageSource()
const routerSource = read('../src/router/index.js')
const aiConfigSource = read('../src/views/AiConfig.vue')
const viewsSource = read('../src/router/views.js')
const navigationSource = read('../src/router/navigation.js')
const routeRestoreSource = read('../src/router/routeRestore.js')

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
  return blocks.join('\n')
}

function fileStub(name, size = 12) {
  return { name, size }
}

function createApi(handlers = {}) {
  const calls = { list: 0, create: 0, restore: [], readiness: 0 }
  return {
    calls,
    async list() {
      calls.list += 1
      if (handlers.list) return handlers.list()
      return []
    },
    async create() {
      calls.create += 1
      if (handlers.create) return handlers.create()
      return { name: 'localminidrama-backup.zip' }
    },
    async restore(payload) {
      calls.restore.push(payload)
      if (handlers.restore) return handlers.restore(payload)
      return { ok: true }
    },
    async readiness() {
      calls.readiness += 1
      if (handlers.readiness) return handlers.readiness()
      return {
        status: 'ready',
        ready: true,
        checks: { maintenance: { ok: true }, database: { ok: true }, storage: { ok: true } },
      }
    },
  }
}

test('英文备份错误和错误码都会映射成中文，内部日志仍用英文 operation 名', () => {
  assert.equal(
    describeBackupError({
      code: 'SERVICE_RUNNING',
      message: 'Stop the LocalMiniDrama backend before data backup or restore.',
    }),
    '请先停止本地短剧助手服务，再执行全量备份或恢复。',
  )
  assert.equal(
    describeBackupError({
      response: {
        data: {
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Restore requires explicit confirmation with --yes.',
          },
        },
      },
    }),
    '恢复需要明确确认，当前数据不会被覆盖。',
  )
  assert.equal(
    describeBackupError({ message: 'The data backup could not be completed.' }),
    '数据备份未能完成。',
  )
  assert.equal(
    describeBackupError({
      response: {
        data: {
          error: { message: '当前路径没有读写权限，请检查数据目录或备份输出目录的权限后重试。' },
        },
      },
    }),
    '当前路径没有读写权限，请检查数据目录或备份输出目录的权限后重试。',
  )
  assert.equal(
    describeBackupError({ response: { status: 503 } }),
    '备份服务暂时不可用，请稍后重试',
  )
  assert.equal(typeof useBackupSettings, 'function')
})

test('备份列表格式错误不会被当成空备份', () => {
  assert.deepEqual(normalizeBackupList([]), { ok: true, items: [] })
  assert.deepEqual(
    normalizeBackupList({
      items: [{ filename: 'keep.zip', archive_bytes: 2048, created_at: '2026-08-29T00:00:00Z' }],
    }),
    {
      ok: true,
      items: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    },
  )
  assert.equal(normalizeBackupList({ unexpected: true }).ok, false)
  assert.equal(normalizeBackupList({ unexpected: true }).message, BACKUP_ERROR_MESSAGES.BACKUP_LIST_INVALID)
  assert.equal(formatBackupSize(2048), '2 KB')
})

test('失败空态与无备份空态互斥，加载失败时锁定列表恢复', () => {
  assert.deepEqual(
    backupAccessState({
      loading: false,
      hasSuccessfulLoad: false,
      loadError: '备份服务暂时不可用，请稍后重试',
      itemCount: 0,
    }),
    {
      showEmpty: false,
      showStale: false,
      writeLocked: false,
      restoreLocked: false,
      restoreFromListLocked: true,
      createLocked: false,
    },
  )
  assert.equal(
    backupAccessState({ loading: false, hasSuccessfulLoad: true, loadError: '', itemCount: 0 }).showEmpty,
    true,
  )
  assert.equal(
    backupAccessState({ loading: false, hasSuccessfulLoad: true, loadError: '超时', itemCount: 2 }).showStale,
    true,
  )
  assert.deepEqual(
    backupAccessState({
      loading: false,
      hasSuccessfulLoad: true,
      loadError: '',
      itemCount: 1,
      maintenanceBlocked: true,
    }),
    {
      showEmpty: false,
      showStale: false,
      writeLocked: false,
      restoreLocked: true,
      restoreFromListLocked: true,
      createLocked: true,
    },
  )
})

test('备份文件选择失败给出中文原因，取消选择不算失败', () => {
  assert.equal(validateBackupFile(null).code, 'BACKUP_FILE_REQUIRED')
  assert.equal(validateBackupFile(fileStub('notes.txt')).code, 'BACKUP_FILE_TYPE')
  assert.equal(validateBackupFile(fileStub('data.zip', 0)).code, 'BACKUP_FILE_EMPTY')
  assert.equal(validateBackupFile(fileStub('..\\escape.zip')).code, 'BACKUP_FILE_INVALID_NAME')
  assert.equal(validateBackupFile(fileStub('ok-backup.zip', 32)).ok, true)
  const copy = restoreConfirmationCopy('ok-backup.zip')
  assert.equal(copy.title, '确认恢复备份')
  assert.match(copy.body, /ok-backup\.zip/)
  assert.match(copy.body, /不可撤销/)
  assert.equal(copy.confirmButtonText, '确认恢复')
  assert.equal(copy.cancelButtonText, '取消')
})

test('returnTo 只接受首页和 AI 配置', () => {
  assert.equal(normalizeBackupReturnTo('/ai-config'), '/ai-config')
  assert.equal(normalizeBackupReturnTo('/'), '/')
  assert.equal(normalizeBackupReturnTo('https://evil.test/'), '')
  assert.equal(normalizeBackupReturnTo('/film/12'), '')
})

test('加载失败保留中文错误，不会把失败渲染成无备份', async () => {
  const api = createApi({
    list: async () => {
      const error = new Error('Stop the LocalMiniDrama backend before data backup or restore.')
      error.code = 'SERVICE_RUNNING'
      throw error
    },
  })
  const harness = useBackupSettings({ api })
  const loaded = await harness.loadBackups()
  assert.equal(loaded, false)
  assert.equal(harness.hasSuccessfulListLoad.value, false)
  assert.equal(harness.listError.value, BACKUP_ERROR_MESSAGES.SERVICE_RUNNING)
  assert.equal(harness.accessState.value.showEmpty, false)
  assert.equal(harness.accessState.value.restoreFromListLocked, true)
  assert.equal(harness.backups.value.length, 0)
})

test('成功加载空列表才显示无备份，失败后重试成功会退出失败态', async () => {
  let shouldFail = true
  const api = createApi({
    list: async () => {
      if (shouldFail) {
        shouldFail = false
        const error = new Error('network error')
        error.response = { status: 404 }
        throw error
      }
      return []
    },
  })
  const harness = useBackupSettings({ api })
  await harness.loadBackups()
  assert.equal(harness.accessState.value.showEmpty, false)
  assert.match(harness.listError.value, /备份服务未找到/)
  await harness.loadBackups()
  assert.equal(harness.listError.value, '')
  assert.equal(harness.hasSuccessfulListLoad.value, true)
  assert.equal(harness.accessState.value.showEmpty, true)
})

test('刷新失败会保留上次备份，而不是改成空列表', async () => {
  let mode = 'ok'
  const api = createApi({
    list: async () => {
      if (mode === 'ok') return [{ name: 'keep.zip', archive_bytes: 100 }]
      const error = new Error('timeout')
      error.response = { status: 502 }
      throw error
    },
  })
  const harness = useBackupSettings({ api })
  await harness.loadBackups()
  assert.equal(harness.backups.value[0].name, 'keep.zip')
  mode = 'fail'
  await harness.loadBackups()
  assert.equal(harness.backups.value[0].name, 'keep.zip')
  assert.equal(harness.listIsStale.value, true)
  assert.equal(harness.accessState.value.showEmpty, false)
  assert.equal(harness.accessState.value.showStale, true)
})

test('文件选择取消不记失败，错误文件不会打开恢复确认', () => {
  const harness = useBackupSettings({ api: createApi() })
  assert.deepEqual(harness.selectBackupFile(null), { ok: true, cancelled: true })
  assert.equal(harness.fileError.value, '')
  const bad = harness.selectBackupFile(fileStub('readme.md', 8))
  assert.equal(bad.ok, false)
  assert.equal(harness.fileError.value, BACKUP_ERROR_MESSAGES.BACKUP_FILE_TYPE)
  assert.equal(harness.fileErrorName.value, 'readme.md')
  assert.equal(harness.requestRestoreFromSelection(), false)
  assert.equal(harness.restoreDialogVisible.value, false)
})

test('恢复必须先确认，未确认不会请求接口', async () => {
  const api = createApi()
  const harness = useBackupSettings({ api })
  harness.selectBackupFile(fileStub('keep.zip', 64))
  const skipped = await harness.confirmRestore()
  assert.equal(skipped.ok, false)
  assert.equal(skipped.message, BACKUP_ERROR_MESSAGES.CONFIRMATION_REQUIRED)
  assert.equal(api.calls.restore.length, 0)
  assert.equal(harness.requestRestoreFromSelection(), true)
  assert.equal(harness.restoreDialogVisible.value, true)
  assert.equal(api.calls.restore.length, 0)
  harness.cancelRestore()
  assert.equal(harness.restoreDialogVisible.value, false)
  assert.equal(api.calls.restore.length, 0)
  assert.equal(harness.actionError.value, '')
  harness.requestRestoreFromSelection()
  const result = await harness.confirmRestore()
  assert.equal(result.ok, true)
  assert.equal(api.calls.restore.length, 1)
  assert.equal(api.calls.restore[0].confirmed, true)
  assert.equal(api.calls.restore[0].name, 'keep.zip')
})

test('列表恢复在加载失败时不可用，选本地文件仍可进入确认', async () => {
  const api = createApi({
    list: async () => {
      const error = new Error('gone')
      error.response = { status: 404 }
      throw error
    },
  })
  const harness = useBackupSettings({ api })
  await harness.loadBackups()
  assert.equal(harness.requestRestoreFromItem({ name: 'keep.zip' }), false)
  harness.selectBackupFile(fileStub('local.zip', 20))
  assert.equal(harness.requestRestoreFromSelection(), true)
})

test('维护状态失败不会显示正常空态，操作日志保持英文 operation 名', async () => {
  resetOperationLogs()
  const captured = []
  const restoreSink = installOperationLogSink((record) => captured.push(record))
  const api = createApi({
    readiness: async () => {
      const error = new Error('Service unavailable')
      error.response = { status: 503 }
      throw error
    },
  })
  try {
    const harness = useBackupSettings({ api })
    await harness.loadReadiness()
    assert.equal(harness.hasSuccessfulReadinessLoad.value, false)
    assert.match(harness.readinessError.value, /维护服务暂时不可用|维护状态读取失败/)
    assert.equal(harness.readiness.value, null)
  } finally {
    restoreSink()
  }
  assert.ok(captured.some((item) => item.operation === 'maintenance_status_load' && item.phase === 'error'))
})

test('备份页把失败、空态和恢复确认分成独立用户路径', () => {
  const template = templateOnly(pageSource)
  assert.match(template, /<h1 class="page-title">数据备份与维护<\/h1>/)
  assert.match(template, /v-if="listError"[\s\S]*备份列表加载失败[\s\S]*备份空态不会在连接恢复前显示/)
  assert.match(template, /v-if="accessState.showEmpty"[\s\S]*还没有备份/)
  assert.match(template, /正在加载备份列表/)
  assert.match(template, /aria-label="清除所选备份文件"/)
  assert.match(template, /v-if="fileError"[\s\S]*备份文件选择失败[\s\S]*重新选择备份文件/)
  assert.match(template, /<AccessibleDialog[\s\S]*:title="restoreCopy.title"/)
  assert.match(template, /type="danger"[\s\S]*aria-label="确认恢复备份"/)
  assert.match(template, /v-if="readinessError"[\s\S]*维护状态加载失败[\s\S]*维护正常空态不会在连接恢复前显示/)
  assert.match(template, /lastFailedAction === 'restore'/)
})

test('路由、深链接和设置入口都接到备份页', () => {
  assert.match(routerSource, /path: '\/backup'/)
  assert.match(routerSource, /name: 'backup'/)
  assert.match(routerSource, /component: \(\) => import\('@\/views\/Backup\.vue'\)/)
  assert.match(routerSource, /path: '\/settings'[\s\S]*redirect: '\/backup'/)
  assert.match(aiConfigSource, /aria-label="打开数据备份与维护"/)
  assert.match(aiConfigSource, /name: 'backup', query: \{ returnTo: '\/ai-config' \}/)
  assert.match(pageSource, /normalizeBackupReturnTo\(route\.query.returnTo\)/)
  assert.match(pageSource, /unregisterLeaveProtection\?\.\(\)/)
  assert.match(pageSource, /loadBackups\(\)/)
  assert.match(pageSource, /loadReadiness\(\)/)
  assert.match(viewsSource, /name: 'backup'/)
  assert.match(viewsSource, /component: 'Backup.vue'/)
  assert.match(viewsSource, /id: 'backup', view: 'backup', label: '数据备份'/)
  assert.match(navigationSource, /to.name === 'backup'/)
  assert.match(navigationSource, /normalizeBackupReturnTo/)
  assert.match(routerSource, /export function normalizeBackupReturnTo/)
  assert.doesNotMatch(routerSource, /from ['"][^'"]*useBackupSettings/)
  assert.doesNotMatch(routerSource, /from ['"][^'"]*utils\/request/)
  assert.doesNotMatch(navigationSource, /from ['"][^'"]*useBackupSettings/)
  assert.doesNotMatch(navigationSource, /from ['"][^'"]*utils\/request/)
  assert.doesNotMatch(viewsSource, /from ['"][^'"]*useBackupSettings/)
  assert.doesNotMatch(viewsSource, /from ['"][^'"]*utils\/request/)
  assert.doesNotMatch(routeRestoreSource, /from ['"][^'"]*useBackupSettings/)
  assert.doesNotMatch(routeRestoreSource, /from ['"][^'"]*utils\/request/)
})

test('确认恢复若返回待重启，不会假装当前进程已经覆盖数据', async () => {
  const api = createApi({
    restore: async () => ({
      pending_restart: true,
      message: '已安排在下次启动时恢复，请重启应用。',
    }),
  })
  const harness = useBackupSettings({ api })
  harness.selectBackupFile(fileStub('keep.zip', 64))
  harness.requestRestoreFromSelection()
  const result = await harness.confirmRestore()
  assert.equal(result.ok, true)
  assert.equal(result.pendingRestart, true)
  assert.match(result.message, /重启应用/)
})

test('备份页在创建或恢复时注册离开保护', () => {
  const source = pageSource
  assert.match(viewsSource, /backup:\s*\{[\s\S]*?name:\s*'backup'[\s\S]*?leaveProtection:\s*true/)
  assert.match(source, /inject\('appRouteLeaveProtection'/)
  assert.match(source, /leaveProtection\?\.register\?\.\('backup'/)
  assert.match(source, /正在备份或恢复，离开会中断当前操作/)
  assert.match(pageSource, /BACKUP_READY_NOT_SPA_HINT/)
  assert.match(pageSource, /BACKUP_READY_SPA_HTML_MESSAGE/)
  assert.match(pageSource, /\/ready/)
  assert.match(pageSource, /SPA HTML/)

  assert.match(source, /onBeforeRouteLeave/)
  assert.match(source, /result\.message/)
})

test('备份操作失败可重试或关闭，空态也能创建或选择备份', () => {
  const template = templateOnly(pageSource)
  assert.match(template, /v-if="actionError"[\s\S]*备份操作失败[\s\S]*重试恢复[\s\S]*重试创建备份[\s\S]*关闭备份操作错误/)
  assert.match(template, /aria-label="重试恢复备份"[\s\S]*>\s*重试恢复/)
  assert.match(template, /aria-label="重试创建备份"[\s\S]*>\s*重试创建备份/)
  assert.match(template, /aria-label="关闭备份操作错误"[\s\S]*>关闭/)
  assert.match(template, /v-if="accessState.showEmpty"[\s\S]*创建备份[\s\S]*>创建备份[\s\S]*选择已有备份/)
  assert.match(template, /aria-label="确认恢复备份"/)
  assert.match(template, /aria-label="创建全量备份"/)
  assert.match(template, /aria-label="选择备份文件"/)
  assert.doesNotMatch(template, /v-if="accessState.showEmpty"[\s\S]*aria-label="创建全量备份"/)
  assert.doesNotMatch(template, /v-if="accessState.showEmpty"[\s\S]*aria-label="选择备份文件"/)
})

test('关闭备份操作错误会清掉失败条', () => {
  const harness = useBackupSettings({ api: createApi() })
  harness.actionError.value = '数据恢复未能完成，原有数据应仍可用。'
  harness.lastFailedAction.value = 'restore'
  harness.dismissActionError()
  assert.equal(harness.actionError.value, '')
  assert.equal(harness.lastFailedAction.value, '')
})

test('维护租约不可用显示阻塞态而不是加载失败，并锁定写入', async () => {
  const blockedPayload = {
    status: 'not_ready',
    ready: false,
    checks: {
      maintenance: { ok: false, error: '维护租约不可用' },
      database: { ok: true },
      storage: { ok: true },
    },
  }
  const returned = useBackupSettings({
    api: createApi({
      readiness: async () => blockedPayload,
    }),
  })
  await returned.loadReadiness()
  assert.equal(returned.readinessError.value, '')
  assert.equal(returned.hasSuccessfulReadinessLoad.value, true)
  assert.equal(returned.readiness.value.ready, false)
  assert.equal(returned.readiness.value.maintenanceError, '维护租约不可用')
  assert.equal(returned.accessState.value.createLocked, true)
  assert.equal(returned.accessState.value.restoreLocked, true)
  assert.equal(returned.accessState.value.writeLocked, false)
  returned.selectBackupFile(fileStub('keep.zip', 64))
  assert.equal(returned.requestRestoreFromSelection(), false)
  assert.equal((await returned.createBackup()).locked, true)

  const thrown = useBackupSettings({
    api: createApi({
      readiness: async () => {
        const error = new Error('Service unavailable')
        error.response = { status: 503, data: blockedPayload }
        throw error
      },
    }),
  })
  await thrown.loadReadiness()
  assert.equal(thrown.readinessError.value, '')
  assert.equal(thrown.hasSuccessfulReadinessLoad.value, true)
  assert.equal(thrown.readiness.value.ready, false)
  assert.equal(thrown.accessState.value.createLocked, true)
})

test('恢复失败后关闭确认框，重试仍走恢复而不是创建', async () => {
  const api = createApi({
    restore: async () => {
      const error = new Error('restore failed')
      error.code = 'RESTORE_FAILED'
      throw error
    },
  })
  const harness = useBackupSettings({ api })
  harness.selectBackupFile(fileStub('keep.zip', 64))
  assert.equal(harness.requestRestoreFromSelection(), true)
  const failed = await harness.confirmRestore()
  assert.equal(failed.ok, false)
  assert.equal(harness.lastFailedAction.value, 'restore')
  assert.match(harness.actionError.value, /数据恢复未能完成/)
  harness.cancelRestore()
  assert.equal(harness.restoreDialogVisible.value, false)
  const retry = await harness.retryRestore()
  assert.equal(retry.needsConfirmation, true)
  assert.equal(harness.restoreDialogVisible.value, true)
  assert.equal(api.calls.create, 0)
  assert.equal(api.calls.restore.length, 1)
})

test('英文维护错误会映射成中文，不把原文漏到页面', () => {
  const parsed = parseReadinessPayload({
    status: 'not_ready',
    checks: {
      maintenance: { ok: false, error: 'another maintenance operation is active' },
      database: { ok: true },
      storage: { ok: true },
    },
  })
  assert.equal(parsed.ready, false)
  assert.equal(parsed.maintenanceError, BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCKED)
  assert.match(parsed.maintenanceError, /[㐀-鿿]/)
})

test('备份禁用按钮给出中文原因', () => {
  assert.match(pageSource, /const backupWriteLockReason = computed/)
  assert.match(pageSource, /正在创建备份，请稍候/)
  assert.match(pageSource, /备份列表加载失败，成功重试前不能从列表恢复/)
  assert.match(pageSource, /当前不能安全执行备份或恢复/)
  assert.match(pageSource, /:title="accessState.createLocked \? backupWriteLockReason : undefined"/)
  assert.match(pageSource, /:title="accessState.writeLocked \? backupWriteLockReason : undefined"/)
  assert.match(pageSource, /:title="accessState.restoreFromListLocked \? backupRestoreLockReason : undefined"/)
  assert.match(pageSource, /:title="accessState.restoreLocked \? backupWriteLockReason : undefined"/)
  assert.match(pageSource, /:title="loading \? '备份列表正在加载，请稍候' : undefined"/)
  assert.match(pageSource, /:title="readinessLoading \? '维护状态正在加载，请稍候' : undefined"/)
})


test('清除所选备份会关掉对应的恢复确认', () => {
  const harness = useBackupSettings({ api: createApi() })
  harness.selectBackupFile(fileStub('keep.zip', 64))
  assert.equal(harness.requestRestoreFromSelection(), true)
  assert.equal(harness.restoreDialogVisible.value, true)
  harness.clearSelectedFile()
  assert.equal(harness.selectedFile.value, null)
  assert.equal(harness.restoreDialogVisible.value, false)
})

test('备份时间显示中文格式，无效值不漏原文', () => {
  const formatted = formatBackupTimestamp('2026-08-29T00:00:00Z')
  assert.match(formatted, /2026/)
  assert.doesNotMatch(formatted, /T00:00:00Z/)
  assert.equal(formatBackupTimestamp('not-a-date'), '')
  assert.equal(formatBackupTimestamp(''), '')
  assert.match(pageSource, /formatBackupTimestamp\(item\.createdAt\)/)
  assert.doesNotMatch(pageSource, /\{\{ item\.createdAt \}\}/)
})

test('空的 200 响应不能当成维护未就绪去锁恢复', () => {
  const parsed = parseReadinessPayload({})
  assert.equal(parsed.ready, false)
  assert.equal(
    backupAccessState({
      loading: false,
      hasSuccessfulLoad: true,
      loadError: '',
      itemCount: 1,
      maintenanceBlocked: false,
    }).restoreFromListLocked,
    false,
  )
  const source = readBackupSettingsSource()
  assert.match(source, /if \(hasReadinessChecksPayload\(data\)\) return data/)
  assert.match(source, /throw error/)
  assert.doesNotMatch(
    source,
    /if \(hasReadinessChecksPayload\(data\)\) return data\s*if \(!response\.ok\) \{[\s\S]*return data/,
  )
})

test('恢复确认取消按钮可见文案也是取消恢复备份，过期维护状态仍显示', () => {
  const template = templateOnly(pageSource)
  assert.match(template, /aria-label="取消恢复备份"/)
  assert.match(template, />取消恢复备份<\/el-button>/)
  assert.doesNotMatch(template, /restoreCopy\.cancelButtonText/)
  assert.match(template, /v-if="hasSuccessfulReadinessLoad && readiness"/)
  assert.match(template, /data-testid="backup-readiness-status"/)
  assert.match(template, /当前内容已过期，以上为上次成功读取的维护状态/)
  assert.match(template, /:close-on-press-escape="!restoring"/)
  assert.match(template, /:show-close="!restoring"/)
  assert.match(template, /onRestoreDialogVisible/)
  assert.match(pageSource, /if \(restoring\.value\) \{[\s\S]*restoreDialogVisible\.value = true/)
})

test('恢复过程中取消不会记成失败，也不把英文异常漏出', async () => {
  const englishCancelRe = /canceled|cancelled|\babort(?:ed|error)?\b/i
  const cancelErrors = [
    Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' }),
    Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }),
  ]
  for (const error of cancelErrors) {
    resetOperationLogs()
    const api = createApi({
      restore: async () => {
        throw error
      },
    })
    const harness = useBackupSettings({ api })
    harness.selectBackupFile(fileStub('keep.zip', 64))
    harness.requestRestoreFromSelection()
    harness.actionError.value = '数据恢复未能完成，原有数据应仍可用。'
    const result = await harness.confirmRestore()
    assert.equal(result.ok, false)
    assert.equal(result.cancelled, true)
    assert.equal(result.message, '操作已取消')
    assert.equal(harness.actionError.value, '')
    assert.equal(harness.lastFailedAction.value, '')
    assert.equal(harness.fileError.value, '')
    assert.doesNotMatch(result.message, englishCancelRe)
    assert.doesNotMatch(harness.actionError.value, englishCancelRe)
    const logs = getOperationLogs().filter((item) => item.operation === 'backup_restore')
    assert.deepEqual(logs.map((item) => item.phase), ['start', 'cancel'])
    assert.equal(logs.some((item) => item.phase === 'error'), false)
    assert.equal(logs.some((item) => item.phase === 'success'), false)
    assert.ok(logs.every((item) => item.operationId))

    const retry = await harness.retryRestore()
    assert.equal(retry.ok, false)
    assert.equal(retry.cancelled, true)
    assert.equal(retry.message, '操作已取消')
    assert.equal(harness.actionError.value, '')
    assert.equal(harness.lastFailedAction.value, '')
    assert.doesNotMatch(retry.message, englishCancelRe)
    const retryLogs = getOperationLogs().filter((item) => item.operation === 'backup_restore')
    assert.deepEqual(retryLogs.map((item) => item.phase), ['start', 'cancel', 'start', 'cancel'])
    assert.equal(retryLogs.some((item) => item.phase === 'error' || item.phase === 'success'), false)
  }

  assert.match(pageSource, /async function onConfirmRestore\(\) \{\s*const result = await confirmRestore\(\)\s*if \(result\.ok\) ElMessage\.success/)
  assert.match(pageSource, /async function onRetryRestore\(\) \{\s*const result = await retryRestore\(\)\s*if \(result\.ok\) ElMessage\.success/)
  assert.doesNotMatch(pageSource, /ElMessage\.error/)
  assert.match(pageSource, /v-if="actionError"[\s\S]*备份操作失败/)
  assert.match(pageSource, /aria-label="取消恢复备份"/)
  assert.match(pageSource, />取消恢复备份<\/el-button>/)
})

test('恢复超时仍记失败，不会当成取消', async () => {
  resetOperationLogs()
  const api = createApi({
    restore: async () => {
      throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', isTimeout: true })
    },
  })
  const harness = useBackupSettings({ api })
  harness.selectBackupFile(fileStub('keep.zip', 64))
  harness.requestRestoreFromSelection()
  const result = await harness.confirmRestore()
  assert.equal(result.ok, false)
  assert.notEqual(result.cancelled, true)
  assert.equal(harness.lastFailedAction.value, 'restore')
  assert.match(harness.actionError.value, /[\u3400-\u9fff]/)
  assert.doesNotMatch(harness.actionError.value, /timeout|canceled|cancelled|\babort/i)
  const logs = getOperationLogs().filter((item) => item.operation === 'backup_restore')
  assert.deepEqual(logs.map((item) => item.phase), ['start', 'error'])
})
