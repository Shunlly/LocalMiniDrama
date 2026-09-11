/** 备份页展示文案与锁定原因，供页面和测试共用。 */

export const BACKUP_RESTORE_CANCEL_TEXT = '取消恢复备份'
export const BACKUP_LEAVE_CONFIRM_MESSAGE = '正在备份或恢复，离开会中断当前操作。仍要离开吗？'

export function getBackupWriteLockReason({
  creating = false,
  restoring = false,
  loading = false,
  hasSuccessfulReadinessLoad = false,
  readiness = null,
} = {}) {
  if (creating) return '正在创建备份，请稍候'
  if (restoring) return '正在恢复备份，请稍候'
  if (loading) return '备份列表正在加载，请稍候'
  if (hasSuccessfulReadinessLoad && readiness && readiness.ready === false) {
    return readiness.maintenanceError || '当前不能安全执行备份或恢复。'
  }
  return ''
}

export function getBackupRestoreLockReason({
  writeLockReason = '',
  listError = '',
  listIsStale = false,
  hasSuccessfulListLoad = false,
} = {}) {
  if (writeLockReason) return writeLockReason
  if (listError) {
    return listIsStale
      ? '备份列表刷新失败，成功重试前不能从列表恢复'
      : '备份列表加载失败，成功重试前不能从列表恢复'
  }
  if (!hasSuccessfulListLoad) return '备份列表尚未就绪'
  return ''
}

export function isBackupBusy({ creating = false, restoring = false } = {}) {
  return Boolean(creating || restoring)
}

export function confirmBackupLeave(busy, confirm = (message) => window.confirm(message)) {
  if (!busy) return true
  return confirm(BACKUP_LEAVE_CONFIRM_MESSAGE)
}
