import { ElMessageBox } from '@/utils/elementPlusFeedback.js'

/** 备份页展示文案与锁定原因，供页面和测试共用。 */

export const BACKUP_RESTORE_CANCEL_TEXT = '取消恢复备份'
export const BACKUP_LEAVE_CONFIRM_MESSAGE = '正在备份或恢复，离开会中断当前操作。仍要离开吗？'
export const BACKUP_LEAVE_CONFIRM_TITLE = '确认离开？'
export const BACKUP_LEAVE_CONFIRM_BUTTON_TEXT = '离开'
export const BACKUP_LEAVE_STAY_BUTTON_TEXT = '继续留在本页'
export const BACKUP_READY_NOT_SPA_HINT = '这是后端就绪检查 /ready 的结果，不是备份页或 SPA HTML。'
export const BACKUP_READY_SPA_HTML_MESSAGE = '后端就绪检查 /ready 没有返回 JSON，而是前端页面。请确认网关把 /ready 精确代理到后端，而不是回退成 SPA HTML。'

/** 当 /ready 返回 SPA HTML 或非 JSON 时，转成用户能看懂的中文说明。 */
export function looksLikeBackupReadySpaHtmlFailure(raw) {
  const text = String(raw || '')
  if (!text.trim()) return false
  if (/<!DOCTYPE\s+html/i.test(text)) return true
  if (/<html[\s>]/i.test(text) || /<\/html>/i.test(text)) return true
  if (/<div[^>]*id=["']app["']/i.test(text)) return true
  if (/\bHTTP\s*200\b/i.test(text)) return true
  if (/unexpected token\s+'?</i.test(text)) return true
  if (/text\/html/i.test(text)) return true
  return false
}

export function describeBackupReadinessDisplayError(rawError) {
  const text = String(rawError || '').trim()
  if (!text) return ''
  if (looksLikeBackupReadySpaHtmlFailure(text)) return BACKUP_READY_SPA_HTML_MESSAGE
  return text
}

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

let pendingBackupLeaveConfirm = null

/** 忙碌时弹出中文离开确认；取消则留在本页，不中断备份或恢复。 */
export async function confirmBackupLeave(busy) {
  if (!busy) return true
  if (pendingBackupLeaveConfirm) return pendingBackupLeaveConfirm
  pendingBackupLeaveConfirm = (async () => {
    try {
      await ElMessageBox.confirm(
        BACKUP_LEAVE_CONFIRM_MESSAGE,
        BACKUP_LEAVE_CONFIRM_TITLE,
        {
          type: 'warning',
          confirmButtonText: BACKUP_LEAVE_CONFIRM_BUTTON_TEXT,
          cancelButtonText: BACKUP_LEAVE_STAY_BUTTON_TEXT,
          distinguishCancelAndClose: true,
        },
      )
      return true
    } catch (_) {
      return false
    }
  })()
  try {
    return await pendingBackupLeaveConfirm
  } finally {
    pendingBackupLeaveConfirm = null
  }
}
