/**
 * 备份恢复的文件校验、确认文案和确认/重试流程。
 * 页面仍从 useBackupSettings 取公开 API。
 */
import { createOperationId, logOperation } from '@/utils/operationLog'
import { isRequestCanceled } from '@/utils/requestError'
import { isUserFacingAbort } from '@/utils/userFacingError'

const BACKUP_ZIP_RE = /\.zip$/i
const UNSAFE_BACKUP_NAME_RE = /[\\/]|\.\./

export function createValidateBackupFile(errorMessages) {
  return function validateBackupFile(file) {
    if (!file) {
      return { ok: false, code: 'BACKUP_FILE_REQUIRED', message: errorMessages.BACKUP_FILE_REQUIRED }
    }
    const fileName = String(file.name || '').trim() || '未命名文件'
    if (UNSAFE_BACKUP_NAME_RE.test(fileName)) {
      return { ok: false, code: 'BACKUP_FILE_INVALID_NAME', message: errorMessages.BACKUP_FILE_INVALID_NAME, fileName }
    }
    if (!BACKUP_ZIP_RE.test(fileName)) {
      return { ok: false, code: 'BACKUP_FILE_TYPE', message: errorMessages.BACKUP_FILE_TYPE, fileName }
    }
    if (Number(file.size) === 0) {
      return { ok: false, code: 'BACKUP_FILE_EMPTY', message: errorMessages.BACKUP_FILE_EMPTY, fileName }
    }
    return { ok: true, fileName }
  }
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

export function useBackupSettingsRestore({
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
  errorMessages,
  validateBackupFile,
  describeBackupError,
  backupErrorCode,
  loadBackups,
}) {
  function dismissFileError() {
    fileError.value = ''
    fileErrorName.value = ''
  }

  function clearSelectedFile() {
    const current = selectedFile.value
    selectedFile.value = null
    dismissFileError()
    if (restoreTarget.value?.kind === 'file') {
      restoreDialogVisible.value = false
      restoreTarget.value = null
    }
    if (lastRestoreTarget.value?.kind === 'file' && lastRestoreTarget.value?.file === current) {
      lastRestoreTarget.value = null
    }
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
    if (accessState.value.restoreLocked) return false
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
      actionError.value = errorMessages.BACKUP_FILE_REQUIRED
      lastFailedAction.value = 'restore'
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

  async function confirmRestore() {
    if (!restoreDialogVisible.value) {
      actionError.value = errorMessages.CONFIRMATION_REQUIRED
      lastFailedAction.value = 'restore'
      return { ok: false, message: actionError.value }
    }
    const target = restoreTarget.value
    if (!target) {
      actionError.value = errorMessages.BACKUP_FILE_REQUIRED
      lastFailedAction.value = 'restore'
      return { ok: false, message: actionError.value }
    }
    restoring.value = true
    actionError.value = ''
    const operationId = createOperationId('backup_restore')
    logOperation({ operation: 'backup_restore', operationId, phase: 'start', name: target.name })
    try {
      const result = await api.restore({
        file: target.file,
        name: target.name,
        confirmed: true,
      })
      restoreDialogVisible.value = false
      restoreTarget.value = null
      lastRestoreTarget.value = null
      selectedFile.value = null
      lastFailedAction.value = ''
      logOperation({ operation: 'backup_restore', operationId, phase: 'success', name: target.name })
      await loadBackups()
      const pendingRestart = Boolean(result?.pending_restart)
      return {
        ok: true,
        pendingRestart,
        message: pendingRestart
          ? (result?.message || '已安排在下次启动时恢复，请重启应用。')
          : '备份已恢复',
      }
    } catch (error) {
      const cancelled = isUserFacingAbort(error) || isRequestCanceled(error)
      if (cancelled) {
        logOperation({
          operation: 'backup_restore',
          operationId,
          phase: 'cancel',
          status: 'cancelled',
          name: target.name,
        })
        return { ok: false, cancelled: true, message: '操作已取消' }
      }
      const message = describeBackupError(error)
      actionError.value = message
      lastFailedAction.value = 'restore'
      lastRestoreTarget.value = target
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

  async function retryRestore() {
    const target = restoreTarget.value || lastRestoreTarget.value
    if (!target) {
      actionError.value = errorMessages.BACKUP_FILE_REQUIRED
      lastFailedAction.value = 'restore'
      return { ok: false, message: actionError.value }
    }
    restoreTarget.value = target
    lastRestoreTarget.value = target
    if (!restoreDialogVisible.value) {
      restoreDialogVisible.value = true
      return { ok: false, needsConfirmation: true }
    }
    return confirmRestore()
  }

  return {
    dismissFileError,
    clearSelectedFile,
    selectBackupFile,
    requestRestoreFromSelection,
    requestRestoreFromItem,
    cancelRestore,
    confirmRestore,
    retryRestore,
  }
}
