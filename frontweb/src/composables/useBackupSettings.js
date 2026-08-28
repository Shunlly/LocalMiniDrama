/**
 * 数据备份与维护页的列表、文件选择和恢复确认逻辑。
 * 用户可见文案保持中文；内部操作日志可用英文 operation 名。
 */
import { computed, ref } from 'vue'
import request from '@/utils/request'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import { createOperationId, logOperation } from '@/utils/operationLog'

const HAN_RE = /[\u3400-\u9fff]/
const BACKUP_ZIP_RE = /\.zip$/i
const UNSAFE_BACKUP_NAME_RE = /[\\/]|\.\./

export const BACKUP_ERROR_MESSAGES = Object.freeze({
  CONFIRMATION_REQUIRED: '恢复需要明确确认，当前数据不会被覆盖。',
  INVALID_ARGUMENT: '备份参数不完整，请重新选择备份文件后再试。',
  PERMISSION_DENIED: '当前路径没有读写权限，请检查数据目录或备份输出目录的权限后重试。',
  SERVICE_RUNNING: '请先停止本地短剧助手服务，再执行全量备份或恢复。',
  SERVICE_CHECK_FAILED: '无法确认后端服务状态，请稍后重试。',
  MAINTENANCE_ACTIVE: '另一项维护操作正在进行，请等待结束后再试。',
  MAINTENANCE_LOCKED: '维护锁仍有效，请完成或恢复中断的维护后再试。',
  MAINTENANCE_LOCK_FAILED: '无法创建维护锁，请确认数据目录可写后重试。',
  MAINTENANCE_LOCK_FOREIGN: '维护锁属于其他进程，请勿直接删除锁文件。',
  MAINTENANCE_LOCK_INVALID: '维护锁无效，请按维护恢复步骤处理后再试。',
  MAINTENANCE_LEASE_INVALID: '维护租约无效或已丢失，请稍后重试。',
  OUTPUT_EXISTS: '目标备份文件已存在，请更换输出位置后再试。',
  BACKUP_FAILED: '数据备份未能完成。',
  RESTORE_FAILED: '数据恢复未能完成，原有数据应仍可用。',
  INVALID_ARCHIVE: '备份文件不是有效的归档，请重新选择。',
  INVALID_MANIFEST: '备份清单无效，请选择完整的备份文件。',
  UNSUPPORTED_FORMAT: '不支持该备份格式版本。',
  UNSAFE_ARCHIVE_PATH: '备份文件包含不安全路径，已拒绝恢复。',
  DATABASE_BUSY: '数据库正在使用中，请停止相关进程后再恢复。',
  INSUFFICIENT_STORAGE: '磁盘空间不足，无法完成备份或恢复。',
  ARCHIVE_CHANGED: '校验过程中备份文件发生了变化，请重新选择。',
  ARCHIVE_VALIDATION_FAILED: '备份文件无法安全校验，请重新选择。',
  DATABASE_UNAVAILABLE: '目标数据库无法安全打开。',
  UNSAFE_TARGET: '当前数据目录不安全，已拒绝覆盖。',
  BACKUP_FILE_REQUIRED: '请先选择备份文件。',
  BACKUP_FILE_TYPE: '请选择 .zip 格式的备份文件。',
  BACKUP_FILE_EMPTY: '备份文件是空的，请重新选择。',
  BACKUP_FILE_INVALID_NAME: '备份文件名无效，请重新选择。',
  BACKUP_LIST_INVALID: '备份列表格式无效。',
})

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
  [/current path has no read.?write permission|permission denied/i, BACKUP_ERROR_MESSAGES.PERMISSION_DENIED],
])

function hasHan(text) {
  return HAN_RE.test(String(text || ''))
}

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
  if (hasHan(backendMessage)) return backendMessage
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
} = {}) {
  const error = Boolean(loadError)
  return {
    showEmpty: !loading && hasSuccessfulLoad && !error && Number(itemCount) === 0,
    showStale: error && hasSuccessfulLoad && Number(itemCount) > 0,
    writeLocked: Boolean(loading || creating || restoring),
    restoreFromListLocked: Boolean(loading || creating || restoring || !hasSuccessfulLoad || error),
    createLocked: Boolean(loading || creating || restoring),
  }
}

export function validateBackupFile(file) {
  if (!file) {
    return { ok: false, code: 'BACKUP_FILE_REQUIRED', message: BACKUP_ERROR_MESSAGES.BACKUP_FILE_REQUIRED }
  }
  const fileName = String(file.name || '').trim() || '未命名文件'
  if (UNSAFE_BACKUP_NAME_RE.test(fileName)) {
    return { ok: false, code: 'BACKUP_FILE_INVALID_NAME', message: BACKUP_ERROR_MESSAGES.BACKUP_FILE_INVALID_NAME, fileName }
  }
  if (!BACKUP_ZIP_RE.test(fileName)) {
    return { ok: false, code: 'BACKUP_FILE_TYPE', message: BACKUP_ERROR_MESSAGES.BACKUP_FILE_TYPE, fileName }
  }
  if (Number(file.size) === 0) {
    return { ok: false, code: 'BACKUP_FILE_EMPTY', message: BACKUP_ERROR_MESSAGES.BACKUP_FILE_EMPTY, fileName }
  }
  return { ok: true, fileName }
}

export function restoreConfirmationCopy(targetName = '') {
  const name = String(targetName || '').trim() || '所选备份'
  return {
    title: '确认恢复备份',
    body: `将用「${name}」覆盖当前全部项目、素材和原文。默认备份不含 AI 密钥，恢复后需要重新填写。此操作不可撤销。`,
    confirmButtonText: '确认恢复',
    cancelButtonText: '取消',
  }
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
    maintenanceError: String(maintenance.error || '').trim(),
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
  if (!response.ok) {
    const error = new Error(data?.checks?.maintenance?.error || data?.error?.message || '维护状态读取失败')
    error.status = response.status
    error.response = { status: response.status, data }
    error.code = data?.error?.code || data?.checks?.maintenance?.code || ''
    throw error
  }
  return data
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
  const selectedFile = ref(null)
  const restoreDialogVisible = ref(false)
  const restoreTarget = ref(null)
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
  }))
  const listIsStale = computed(() => Boolean(listError.value) && hasSuccessfulListLoad.value)
  const restoreCopy = computed(() => restoreConfirmationCopy(restoreTarget.value?.name))

  let listAbortController = null
  let readinessAbortController = null
  let listRequestSequence = 0
  let readinessRequestSequence = 0

  function dismissFileError() {
    fileError.value = ''
    fileErrorName.value = ''
  }

  function clearSelectedFile() {
    selectedFile.value = null
    dismissFileError()
  }

  function selectBackupFile(file) {
    if (file == null) return { ok: true, cancelled: true }
    const validation = validateBackupFile(file)
    if (!validation.ok) {
      selectedFile.value = null
      fileError.value = validation.message
      fileErrorName.value = validation.fileName || ''
      restoreDialogVisible.value = false
      restoreTarget.value = null
      return validation
    }
    selectedFile.value = file
    dismissFileError()
    actionError.value = ''
    return validation
  }

  function requestRestoreFromSelection() {
    if (accessState.value.writeLocked) return false
    const validation = validateBackupFile(selectedFile.value)
    if (!validation.ok) {
      fileError.value = validation.message
      fileErrorName.value = validation.fileName || ''
      return false
    }
    restoreTarget.value = { kind: 'file', file: selectedFile.value, name: validation.fileName }
    restoreDialogVisible.value = true
    actionError.value = ''
    return true
  }

  function requestRestoreFromItem(item) {
    if (accessState.value.restoreFromListLocked) return false
    const name = String(item?.name || '').trim()
    if (!name) {
      actionError.value = BACKUP_ERROR_MESSAGES.BACKUP_FILE_REQUIRED
      return false
    }
    restoreTarget.value = { kind: 'item', name, id: item.id }
    restoreDialogVisible.value = true
    actionError.value = ''
    return true
  }

  function cancelRestore() {
    restoreDialogVisible.value = false
    restoreTarget.value = null
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
      if (isRequestCanceled(error) || requestId !== listRequestSequence) return false
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
      if (requestId !== readinessRequestSequence) return false
      readiness.value = parseReadinessPayload(payload)
      hasSuccessfulReadinessLoad.value = true
      readinessError.value = ''
      logOperation({ operation: 'maintenance_status_load', operationId, phase: 'success' })
      return true
    } catch (error) {
      if (isRequestCanceled(error) || requestId !== readinessRequestSequence) return false
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
      await loadBackups()
      return { ok: true, result }
    } catch (error) {
      const message = describeBackupError(error)
      actionError.value = message
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

  async function confirmRestore() {
    if (!restoreDialogVisible.value) {
      actionError.value = BACKUP_ERROR_MESSAGES.CONFIRMATION_REQUIRED
      return { ok: false, message: actionError.value }
    }
    const target = restoreTarget.value
    if (!target) {
      actionError.value = BACKUP_ERROR_MESSAGES.BACKUP_FILE_REQUIRED
      return { ok: false, message: actionError.value }
    }
    restoring.value = true
    actionError.value = ''
    const operationId = createOperationId('backup_restore')
    logOperation({ operation: 'backup_restore', operationId, phase: 'start', name: target.name })
    try {
      await api.restore({
        file: target.file,
        name: target.name,
        confirmed: true,
      })
      restoreDialogVisible.value = false
      restoreTarget.value = null
      selectedFile.value = null
      logOperation({ operation: 'backup_restore', operationId, phase: 'success', name: target.name })
      await loadBackups()
      return { ok: true }
    } catch (error) {
      const message = describeBackupError(error)
      actionError.value = message
      logOperation({
        operation: 'backup_restore',
        operationId,
        phase: 'error',
        error: backupErrorCode(error) || error?.message || 'RESTORE_FAILED',
        name: target.name,
      })
      return { ok: false, message }
    } finally {
      restoring.value = false
    }
  }

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
    cancelRestore,
    dismissFileError,
    clearSelectedFile,
    dispose,
  }
}
