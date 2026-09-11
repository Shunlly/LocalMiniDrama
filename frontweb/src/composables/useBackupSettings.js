/**
 * 数据备份与维护页的列表、创建和维护状态逻辑。
 * 文件校验与恢复确认在 useBackupSettingsRestore.js，本文件再导出公开 API。
 * 用户可见文案保持中文；内部操作日志可用英文 operation 名。
 */
import { computed, ref } from 'vue'
import request from '@/utils/request'
import { describeServiceLoadError, isRequestCanceled, isSafeUserFacingMessage, withRequestRetry } from '@/utils/requestError'
import { createOperationId, logOperation } from '@/utils/operationLog'
import {
  createValidateBackupFile,
  restoreConfirmationCopy,
  useBackupSettingsRestore,
} from './useBackupSettingsRestore.js'

export const BACKUP_ERROR_MESSAGES = Object.freeze({
  ARCHIVE_CHANGED: '校验过程中备份文件发生了变化，请重新选择。',
  ARCHIVE_LIMIT_EXCEEDED: '备份结果超过配置的压缩包大小限制。',
  ARCHIVE_UNAVAILABLE: '找不到可用的备份文件，或该文件不安全。',
  ARCHIVE_VALIDATION_FAILED: '备份文件无法安全校验，请重新导出后再试。',
  ARCHIVE_WRITE_FAILED: '备份文件写入失败。',
  BACKUP_DATA_CHANGED: '备份准备过程中数据文件发生了变化。',
  BACKUP_DATA_READ_FAILED: '无法安全读取备份数据文件。',
  BACKUP_FAILED: '数据备份未能完成。',
  BACKUP_FILE_EMPTY: '备份文件是空的，请重新选择。',
  BACKUP_FILE_INVALID_NAME: '备份文件名无效，请重新选择。',
  BACKUP_FILE_REQUIRED: '请先选择备份文件。',
  BACKUP_FILE_TYPE: '请选择 .zip 格式的备份文件。',
  BACKUP_LIST_INVALID: '备份列表格式无效。',
  COMPRESSION_LIMIT_EXCEEDED: '压缩条目超过配置的压缩比限制。',
  CONFIRMATION_REQUIRED: '恢复需要明确确认，当前数据不会被覆盖。',
  DATABASE_BACKUP_FAILED: '无法创建一致的数据库快照。',
  DATABASE_BUSY: '数据库正在使用中，请停止相关进程后再试。',
  DATABASE_CHANGED: '创建快照时数据库发生了变化。',
  DATABASE_HASH_MISMATCH: '数据库快照与备份清单不一致。',
  DATABASE_UNAVAILABLE: '配置的数据库不可用或不安全。',
  DUPLICATE_ARCHIVE_PATH: '存储中存在会在当前平台冲突的文件名。',
  FILE_LIMIT_EXCEEDED: '单个素材文件超过配置的备份大小限制。',
  INSUFFICIENT_STORAGE: '磁盘空间不足，无法完成备份或恢复。',
  INVALID_ARCHIVE: '备份压缩包内容无效或与清单不一致。',
  INVALID_ARGUMENT: '备份参数不完整，请检查后再试。',
  INVALID_DATA_ROOT: '数据根目录必须是已存在的绝对路径。',
  INVALID_DESCRIPTOR_PUBLICATION: '描述符发布需要普通文件描述符。',
  INVALID_LIMIT: '备份安全限制必须是正整数。',
  INVALID_MANIFEST: '备份清单无效或不完整，请重新选择备份文件。',
  INVALID_RESTORE_JOURNAL: '恢复日志无效，已停止写入。',
  MAINTENANCE_ACTIVE: '另一项维护操作正在进行，请等待结束后再试。',
  MAINTENANCE_LEASE_INVALID: '维护租约无效或已丢失，请稍后重试。',
  MAINTENANCE_LOCKED: '维护锁仍有效，请完成或恢复中断的维护后再试。',
  MAINTENANCE_LOCK_FAILED: '无法创建维护锁，请确认数据目录可写后重试。',
  MAINTENANCE_LOCK_FOREIGN: '检测到不受支持的旧维护锁，无法安全接管。',
  MAINTENANCE_LOCK_INVALID: '维护锁无效，无法安全读取。',
  MAINTENANCE_LOCK_MISSING: '未找到维护锁。',
  MAINTENANCE_LOCK_RELEASE_FAILED: '维护租约在释放过程中发生了变化。',
  MAINTENANCE_OWNER_MISMATCH: '维护锁所有者已变化，请重新检查后再恢复。',
  MAINTENANCE_RECOVERY_FAILED: '维护状态未能恢复。',
  MAINTENANCE_SCOPE_INVALID: '维护作用域无效。',
  MANIFEST_LIMIT_EXCEEDED: '生成的备份清单意外过大。',
  MACHINE_RESULT_TOO_LARGE: '备份发布结果超过机器通道限制。',
  MACHINE_RESULT_WRITE_FAILED: '无法写入备份发布结果。',
  NOT_FOUND: '找不到该备份文件。',
  OPERATION_ABORTED: '数据维护操作已中断。',
  OUTPUT_CLEANUP_FAILED: '无法安全清理失败的备份输出。',
  OUTPUT_COMMIT_FAILED: '备份输出不是普通文件。',
  OUTPUT_EXISTS: '目标备份文件已存在，请更换输出位置后再试。',
  PATH_CLAIM_RESTORE_FAILED: '无法安全恢复已声明的替换路径。',
  PENDING_RESTORE_INVALID: '待恢复登记无效，请重新确认恢复。',
  PERMISSION_DENIED: '当前路径没有读写权限，请检查数据目录或备份输出目录的权限后重试。',
  PUBLICATION_CONTENT_MISMATCH: '校验过程中描述符备份内容发生了变化。',
  PUBLICATION_IDENTITY_MISMATCH: '描述符备份未发布到预期路径。',
  PUBLICATION_TIMEOUT: '备份发布路径未在截止时间前完成提交。',
  RESTORE_FAILED: '数据恢复未能完成，原有数据应仍可用。',
  RESTORE_FINALIZE_FAILED: '恢复已提交，但清理未完成，启动时需要继续恢复。',
  RESTORE_JOURNAL_WRITE_FAILED: '无法安全写入恢复日志。',
  RESTORE_RECOVERY_FAILED: '中断的恢复无法自动完成。',
  RESTORE_VERIFY_FAILED: '恢复后的数据未通过校验。',
  ROLLBACK_FAILED: '恢复失败，且未能完整回退到原数据。',
  ROLLBACK_PREPARE_FAILED: '无法创建当前数据库的回退副本。',
  SECRET_EXCLUSION_FAILED: '无法从备份快照中安全排除密钥。',
  SERVICE_CHECK_FAILED: '无法确认后端服务状态，请稍后重试。',
  SERVICE_RUNNING: '请先停止本地短剧助手服务，再执行全量备份或恢复。',
  SIZE_LIMIT_EXCEEDED: '素材总量超过配置的备份大小限制。',
  SOURCE_TEXT_HASH_MISMATCH: '原文文件与备份清单不一致。',
  SOURCE_TEXT_MISSING: '有效原文引用指向了缺失或不安全的文件。',
  SOURCE_TEXT_REFERENCE_INVALID: '原文引用路径不安全。',
  SOURCE_TEXT_VALIDATION_FAILED: '无法安全校验原文引用。',
  SPECIAL_FILE_REJECTED: '存储中包含无法备份的非普通文件。',
  SQLITE_INTEGRITY_FAILED: '数据库完整性检查未通过。',
  STORAGE_CHANGED: '备份准备过程中素材目录发生了变化。',
  STORAGE_HASH_MISMATCH: '素材文件与备份清单不一致。',
  STORAGE_READ_FAILED: '无法安全枚举素材文件。',
  SYMLINK_REJECTED: '素材目录中的符号链接不会纳入备份。',
  TARGET_CHANGED: '恢复校验过程中目标数据库发生了变化。',
  TEMP_CLEANUP_FAILED: '无法安全删除临时数据库文件。',
  UNEXPECTED_ARCHIVE_ENTRY: '备份压缩包包含意外文件。',
  UNSAFE_ARCHIVE_PATH: '备份文件包含不安全的路径，已拒绝恢复。',
  UNSAFE_OUTPUT: '备份输出必须位于实时数据目录之外。',
  UNSAFE_STORAGE: '备份数据根目录必须是真实目录，不能是符号链接。',
  UNSAFE_TARGET: '数据目录目标不安全，已停止备份或恢复。',
  UNSUPPORTED_ARCHIVE: '备份压缩包使用了加密或不支持的压缩方式。',
  UNSUPPORTED_FORMAT: '不支持该备份格式版本。',
})

export const validateBackupFile = createValidateBackupFile(BACKUP_ERROR_MESSAGES)
export { restoreConfirmationCopy }

const ENGLISH_BACKUP_MESSAGE_MAP = Object.freeze([
  [/restore requires explicit confirmation/i, BACKUP_ERROR_MESSAGES.CONFIRMATION_REQUIRED],
  [/stop the localminidrama backend/i, BACKUP_ERROR_MESSAGES.SERVICE_RUNNING],
  [/another localminidrama process holds a fresh maintenance lease/i, BACKUP_ERROR_MESSAGES.MAINTENANCE_ACTIVE],
  [/another maintenance operation is active/i, BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCKED],
  [/the requested backup output already exists/i, BACKUP_ERROR_MESSAGES.OUTPUT_EXISTS],
  [/the data backup could not be completed/i, BACKUP_ERROR_MESSAGES.BACKUP_FAILED],
  [/the data restore could not be completed/i, BACKUP_ERROR_MESSAGES.RESTORE_FAILED],
  [/restore failed; the original data was restored/i, BACKUP_ERROR_MESSAGES.RESTORE_FAILED],
  [/insufficient disk space/i, BACKUP_ERROR_MESSAGES.INSUFFICIENT_STORAGE],
  [/sqlite database is in use/i, BACKUP_ERROR_MESSAGES.DATABASE_BUSY],
  [/backup format version is not supported/i, BACKUP_ERROR_MESSAGES.UNSUPPORTED_FORMAT],
  [/archive contains an unsafe/i, BACKUP_ERROR_MESSAGES.UNSAFE_ARCHIVE_PATH],
  [/archive uses unsupported numeric sizes or offsets/i, BACKUP_ERROR_MESSAGES.UNSUPPORTED_ARCHIVE],
  [/descriptor-backed archive size is unsupported/i, BACKUP_ERROR_MESSAGES.ARCHIVE_VALIDATION_FAILED],
  [/failed backup output could not be claimed/i, BACKUP_ERROR_MESSAGES.OUTPUT_CLEANUP_FAILED],
  [/claimed failed backup output could not be removed/i, BACKUP_ERROR_MESSAGES.OUTPUT_CLEANUP_FAILED],
  [/could not safely clean up the failed backup output/i, BACKUP_ERROR_MESSAGES.OUTPUT_CLEANUP_FAILED],
  [/backup output is not a regular file/i, BACKUP_ERROR_MESSAGES.OUTPUT_COMMIT_FAILED],
  [/claimed maintenance recovery lease could not be removed/i, BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCK_RELEASE_FAILED],
  [/claimed service maintenance lock could not be removed/i, BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCK_RELEASE_FAILED],
  [/maintenance lease changed while it was being released/i, BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCK_RELEASE_FAILED],
  [/could not safely restore the claimed replacement path/i, BACKUP_ERROR_MESSAGES.PATH_CLAIM_RESTORE_FAILED],
  [/the private claim/i, BACKUP_ERROR_MESSAGES.PATH_CLAIM_RESTORE_FAILED],
  [/external maintenance lease/i, BACKUP_ERROR_MESSAGES.MAINTENANCE_LEASE_INVALID],
  [/backup manifest is not valid/i, BACKUP_ERROR_MESSAGES.INVALID_MANIFEST],
  [/current path has no read.?write permission|permission denied/i, BACKUP_ERROR_MESSAGES.PERMISSION_DENIED],
])

function backupErrorCode(error) {
  return String(
    error?.code
    || error?.response?.data?.error?.code
    || '',
  ).trim()
}

function backupErrorMessage(error) {
  return String(
    error?.response?.data?.error?.message
    || error?.publicMessage
    || error?.message
    || '',
  ).trim()
}

export function describeBackupError(error, options = {}) {
  const code = backupErrorCode(error)
  if (code && BACKUP_ERROR_MESSAGES[code]) return BACKUP_ERROR_MESSAGES[code]
  const backendMessage = backupErrorMessage(error)
  if (isSafeUserFacingMessage(backendMessage)) return backendMessage
  for (const [pattern, message] of ENGLISH_BACKUP_MESSAGE_MAP) {
    if (pattern.test(backendMessage)) return message
  }
  return describeServiceLoadError(error, {
    serviceLabel: options.serviceLabel || '备份服务',
    fallback: options.fallback || '备份操作失败，请稍后重试。',
    signal: options.signal,
  })
}

export function describeMaintenanceLoadError(error, signal) {
  return describeBackupError(error, {
    serviceLabel: '维护服务',
    fallback: '维护状态读取失败，请稍后重试。',
    signal,
  })
}

export function describeMaintenanceStatusError(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (isSafeUserFacingMessage(text)) return text
  return describeBackupError({ message: text }, {
    serviceLabel: '维护服务',
    fallback: '当前不能安全执行备份或恢复。',
  })
}

export function hasReadinessChecksPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.checks || typeof payload.checks !== 'object') return false
  const status = String(payload.status || '')
  if (status === 'ready' || status === 'not_ready') return true
  if (typeof payload.ready === 'boolean') return true
  return Boolean(payload.checks.maintenance || payload.checks.database || payload.checks.storage)
}

export function normalizeBackupItem(item = {}) {
  const name = String(item.name || item.filename || item.id || '').trim()
  const bytes = Number(item.archive_bytes ?? item.size ?? item.bytes ?? 0)
  return {
    id: String(item.id || name),
    name,
    createdAt: String(item.created_at || item.createdAt || ''),
    bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
  }
}

export function normalizeBackupList(payload) {
  if (payload == null) return { ok: true, items: [] }
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.backups)
        ? payload.backups
        : null
  if (!raw) {
    return { ok: false, message: BACKUP_ERROR_MESSAGES.BACKUP_LIST_INVALID }
  }
  return {
    ok: true,
    items: raw.map((item) => normalizeBackupItem(item)).filter((item) => item.name),
  }
}

export function backupAccessState({
  loading = false,
  creating = false,
  restoring = false,
  hasSuccessfulLoad = false,
  loadError = '',
  itemCount = 0,
  maintenanceBlocked = false,
} = {}) {
  const error = Boolean(loadError)
  const busy = Boolean(loading || creating || restoring)
  return {
    showEmpty: !loading && hasSuccessfulLoad && !error && Number(itemCount) === 0,
    showStale: error && hasSuccessfulLoad && Number(itemCount) > 0,
    writeLocked: busy,
    restoreLocked: Boolean(busy || maintenanceBlocked),
    restoreFromListLocked: Boolean(busy || !hasSuccessfulLoad || error || maintenanceBlocked),
    createLocked: Boolean(busy || maintenanceBlocked),
  }
}

export function formatBackupTimestamp(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatBackupSize(size) {
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function normalizeBackupReturnTo(value) {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (typeof rawValue !== 'string') return ''
  const candidate = rawValue.trim()
  if (!candidate || candidate.length > 2048 || !candidate.startsWith('/') || /[\u0000-\u001f\u007f]/.test(candidate)) return ''
  try {
    const decodedPath = decodeURIComponent(candidate.split(/[?#]/, 1)[0])
    if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return ''
    const parsed = new URL(candidate, 'https://localminidrama.invalid')
    if (parsed.origin !== 'https://localminidrama.invalid') return ''
    if (parsed.pathname === '/ai-config') return '/ai-config'
    if (parsed.pathname === '/') return '/'
    return ''
  } catch (_) {
    return ''
  }
}

export function parseReadinessPayload(payload = {}) {
  const checks = payload?.checks && typeof payload.checks === 'object' ? payload.checks : {}
  const maintenance = checks.maintenance && typeof checks.maintenance === 'object' ? checks.maintenance : {}
  const ready = payload?.status === 'ready' || payload?.ready === true
  return {
    ready,
    maintenanceOk: maintenance.ok === true,
    maintenanceError: describeMaintenanceStatusError(maintenance.error),
    databaseOk: checks.database?.ok === true,
    storageOk: checks.storage?.ok === true,
  }
}

async function defaultReadinessRequest({ signal } = {}) {
  const response = await fetch('/ready', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (hasReadinessChecksPayload(data)) return data
  const error = new Error(data?.checks?.maintenance?.error || data?.error?.message || '维护状态读取失败')
  error.status = response.status
  error.response = { status: response.status, data }
  error.code = data?.error?.code || data?.checks?.maintenance?.code || ''
  throw error
}

export const backupSettingsAPI = {
  list(options = {}) {
    return request.get('/settings/backups', { suppressErrorToast: true, ...options })
  },
  create(options = {}) {
    return request.post('/settings/backups', {}, { suppressErrorToast: true, ...options })
  },
  restore({ file, name, confirmed } = {}, options = {}) {
    if (file) {
      const form = new FormData()
      form.append('file', file)
      form.append('confirmed', confirmed ? 'true' : 'false')
      if (name) form.append('name', name)
      return request.post('/settings/backups/restore', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        suppressErrorToast: true,
        ...options,
      })
    }
    return request.post('/settings/backups/restore', { name, confirmed: Boolean(confirmed) }, {
      suppressErrorToast: true,
      ...options,
    })
  },
  readiness: defaultReadinessRequest,
}

function isBlobLike(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

export function useBackupSettings(options = {}) {
  const api = options.api || backupSettingsAPI
  const downloadBackup = options.downloadBackup
  const backups = ref([])
  const loading = ref(false)
  const creating = ref(false)
  const restoring = ref(false)
  const hasSuccessfulListLoad = ref(false)
  const listError = ref('')
  const fileError = ref('')
  const fileErrorName = ref('')
  const actionError = ref('')
  const lastFailedAction = ref('')
  const selectedFile = ref(null)
  const restoreDialogVisible = ref(false)
  const restoreTarget = ref(null)
  const lastRestoreTarget = ref(null)
  const readinessLoading = ref(false)
  const readinessError = ref('')
  const hasSuccessfulReadinessLoad = ref(false)
  const readiness = ref(null)

  const accessState = computed(() => backupAccessState({
    loading: loading.value,
    creating: creating.value,
    restoring: restoring.value,
    hasSuccessfulLoad: hasSuccessfulListLoad.value,
    loadError: listError.value,
    itemCount: backups.value.length,
    maintenanceBlocked: Boolean(hasSuccessfulReadinessLoad.value && readiness.value && readiness.value.ready === false),
  }))
  const listIsStale = computed(() => Boolean(listError.value) && hasSuccessfulListLoad.value)
  const restoreCopy = computed(() => restoreConfirmationCopy(restoreTarget.value?.name))

  let listAbortController = null
  let readinessAbortController = null
  let listRequestSequence = 0
  let readinessRequestSequence = 0

  function dismissActionError() {
    actionError.value = ''
    lastFailedAction.value = ''
  }

  async function loadBackups() {
    listAbortController?.abort()
    const controller = new AbortController()
    listAbortController = controller
    const requestId = ++listRequestSequence
    const operationId = createOperationId('backup_list_load')
    loading.value = true
    logOperation({ operation: 'backup_list_load', operationId, phase: 'start' })
    const startedAt = Date.now()
    try {
      const payload = await withRequestRetry(
        () => api.list({ signal: controller.signal }),
        { maxAttempts: 2, delayMs: 400, signal: controller.signal },
      )
      if (requestId !== listRequestSequence) {
        logOperation({
          operation: 'backup_list_load',
          operationId,
          phase: 'cancel',
          status: 'stale',
          durationMs: Date.now() - startedAt,
        })
        return false
      }
      const parsed = normalizeBackupList(payload)
      if (!parsed.ok) {
        listError.value = parsed.message
        logOperation({
          operation: 'backup_list_load',
          operationId,
          phase: 'error',
          error: 'BACKUP_LIST_INVALID',
          durationMs: Date.now() - startedAt,
        })
        return false
      }
      backups.value = parsed.items
      hasSuccessfulListLoad.value = true
      listError.value = ''
      logOperation({
        operation: 'backup_list_load',
        operationId,
        phase: 'success',
        durationMs: Date.now() - startedAt,
        count: parsed.items.length,
      })
      return true
    } catch (error) {
      if (isRequestCanceled(error) || requestId !== listRequestSequence) {
        logOperation({
          operation: 'backup_list_load',
          operationId,
          phase: 'cancel',
          status: isRequestCanceled(error) ? 'cancelled' : 'stale',
          durationMs: Date.now() - startedAt,
        })
        return false
      }
      listError.value = describeBackupError(error, { signal: controller.signal })
      logOperation({
        operation: 'backup_list_load',
        operationId,
        phase: 'error',
        error: backupErrorCode(error) || error?.message || 'BACKUP_LIST_FAILED',
        durationMs: Date.now() - startedAt,
      })
      return false
    } finally {
      if (listAbortController === controller) {
        loading.value = false
        listAbortController = null
      }
    }
  }

  async function loadReadiness() {
    readinessAbortController?.abort()
    const controller = new AbortController()
    readinessAbortController = controller
    const requestId = ++readinessRequestSequence
    readinessLoading.value = true
    const operationId = createOperationId('maintenance_status_load')
    logOperation({ operation: 'maintenance_status_load', operationId, phase: 'start' })
    try {
      const payload = await api.readiness({ signal: controller.signal })
      if (requestId !== readinessRequestSequence) {
        logOperation({
          operation: 'maintenance_status_load',
          operationId,
          phase: 'cancel',
          status: 'stale',
        })
        return false
      }
      readiness.value = parseReadinessPayload(payload)
      hasSuccessfulReadinessLoad.value = true
      readinessError.value = ''
      logOperation({ operation: 'maintenance_status_load', operationId, phase: 'success' })
      return true
    } catch (error) {
      if (isRequestCanceled(error) || requestId !== readinessRequestSequence) {
        logOperation({
          operation: 'maintenance_status_load',
          operationId,
          phase: 'cancel',
          status: isRequestCanceled(error) ? 'cancelled' : 'stale',
        })
        return false
      }
      const failedPayload = error?.response?.data
      if (hasReadinessChecksPayload(failedPayload)) {
        readiness.value = parseReadinessPayload(failedPayload)
        hasSuccessfulReadinessLoad.value = true
        readinessError.value = ''
        logOperation({ operation: 'maintenance_status_load', operationId, phase: 'success' })
        return true
      }
      readinessError.value = describeMaintenanceLoadError(error, controller.signal)
      logOperation({
        operation: 'maintenance_status_load',
        operationId,
        phase: 'error',
        error: backupErrorCode(error) || error?.message || 'MAINTENANCE_STATUS_FAILED',
      })
      return false
    } finally {
      if (readinessAbortController === controller) {
        readinessLoading.value = false
        readinessAbortController = null
      }
    }
  }

  async function createBackup() {
    if (accessState.value.createLocked) return { ok: false, locked: true }
    creating.value = true
    actionError.value = ''
    const operationId = createOperationId('backup_create')
    logOperation({ operation: 'backup_create', operationId, phase: 'start' })
    try {
      const result = await api.create()
      if (downloadBackup && isBlobLike(result)) {
        downloadBackup(result, 'localminidrama-backup.zip')
      }
      logOperation({ operation: 'backup_create', operationId, phase: 'success' })
      lastFailedAction.value = ''
      await loadBackups()
      return { ok: true, result }
    } catch (error) {
      const message = describeBackupError(error)
      actionError.value = message
      lastFailedAction.value = 'create'
      logOperation({
        operation: 'backup_create',
        operationId,
        phase: 'error',
        error: backupErrorCode(error) || error?.message || 'BACKUP_FAILED',
      })
      return { ok: false, message }
    } finally {
      creating.value = false
    }
  }

  const {
    dismissFileError,
    clearSelectedFile,
    selectBackupFile,
    requestRestoreFromSelection,
    requestRestoreFromItem,
    cancelRestore,
    confirmRestore,
    retryRestore,
  } = useBackupSettingsRestore({
    api,
    accessState,
    selectedFile,
    restoreDialogVisible,
    restoreTarget,
    lastRestoreTarget,
    restoring,
    actionError,
    lastFailedAction,
    fileError,
    fileErrorName,
    errorMessages: BACKUP_ERROR_MESSAGES,
    validateBackupFile,
    describeBackupError,
    backupErrorCode,
    loadBackups,
  })

  function dispose() {
    listAbortController?.abort()
    readinessAbortController?.abort()
  }

  return {
    backups,
    loading,
    creating,
    restoring,
    hasSuccessfulListLoad,
    listError,
    listIsStale,
    fileError,
    fileErrorName,
    actionError,
    lastFailedAction,
    selectedFile,
    restoreDialogVisible,
    restoreTarget,
    restoreCopy,
    accessState,
    readinessLoading,
    readinessError,
    hasSuccessfulReadinessLoad,
    readiness,
    loadBackups,
    loadReadiness,
    createBackup,
    selectBackupFile,
    requestRestoreFromSelection,
    requestRestoreFromItem,
    confirmRestore,
    retryRestore,
    cancelRestore,
    dismissFileError,
    dismissActionError,
    clearSelectedFile,
    dispose,
  }
}
