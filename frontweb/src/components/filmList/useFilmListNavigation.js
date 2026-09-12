/** 项目列表工作区导航、离开保护和备份入口。 */
import { ElMessageBox } from '@/utils/elementPlusFeedback.js'
import {
  describePendingProjectPackageWork,
  FILM_LIST_LEAVE_CONFIRM_BUTTON_TEXT,
  FILM_LIST_LEAVE_CONFIRM_TITLE,
  FILM_LIST_LEAVE_STAY_BUTTON_TEXT,
} from '@/components/filmList/filmListFormatters.js'
import { LIBRARY_IMAGE_LEAVE_MESSAGE } from '@/components/filmList/filmListLibraryImage.js'
import { normalizeBackupReturnTo } from '@/composables/useBackupSettings.js'
import { listWorkspaceNavItems, openWorkspaceNavItem } from '@/layouts/AppWorkspaceNav.js'

let pendingFilmListLeaveConfirm = null

/** 忙碌时弹出中文离开确认；取消则留在本页。 */
export async function confirmFilmListLeave(busy, message) {
  if (!busy) return true
  if (pendingFilmListLeaveConfirm) return pendingFilmListLeaveConfirm
  pendingFilmListLeaveConfirm = (async () => {
    try {
      await ElMessageBox.confirm(
        message,
        FILM_LIST_LEAVE_CONFIRM_TITLE,
        {
          type: 'warning',
          confirmButtonText: FILM_LIST_LEAVE_CONFIRM_BUTTON_TEXT,
          cancelButtonText: FILM_LIST_LEAVE_STAY_BUTTON_TEXT,
          distinguishCancelAndClose: true,
        },
      )
      return true
    } catch (_) {
      return false
    }
  })()
  try {
    return await pendingFilmListLeaveConfirm
  } finally {
    pendingFilmListLeaveConfirm = null
  }
}

export function useFilmListNavigation(deps = {}) {
  const {
    router,
    listWriteLocked,
    showNewDialog,
    projectListReturnTo,
    importing,
    importingExample,
    exportingId,
    showAiConfigDialog,
    aiConfigContentRef,
    hasPendingLibraryImageWork,
  } = deps

  const backupNavItem = listWorkspaceNavItems().find((item) => item.id === 'backup') || null

  function goNewProject() {
    if (listWriteLocked.value) return
    showNewDialog.value = true
  }

  function goMaterialCenter() {
    openWorkspaceNavItem(router, 'media-library')
  }

  function goFreeCreate() {
    openWorkspaceNavItem(router, 'free-create')
  }

  function goBackup() {
    if (!backupNavItem) return
    const returnTo = normalizeBackupReturnTo(projectListReturnTo.value) || '/'
    openWorkspaceNavItem(router, backupNavItem.id, { query: { returnTo } })
  }

  function hasPendingProjectPackageWork() {
    return importing.value || Boolean(importingExample.value) || exportingId.value !== null
  }

  function pendingLibraryImageWork() {
    return hasPendingLibraryImageWork?.() === true
  }

  function pendingProjectPackageWorkMessage() {
    if (pendingLibraryImageWork()) return LIBRARY_IMAGE_LEAVE_MESSAGE
    return describePendingProjectPackageWork({
      importing: importing.value,
      importingExample: importingExample.value,
      exportingId: exportingId.value,
    })
  }

  async function requestFilmListNavigation() {
    if (hasPendingProjectPackageWork() || pendingLibraryImageWork()) {
      const allowed = await confirmFilmListLeave(true, pendingProjectPackageWorkMessage())
      if (!allowed) return false
    }
    if (!showAiConfigDialog.value) return true
    return (await aiConfigContentRef.value?.requestClose?.()) !== false
  }

  function handleBeforeUnload(event) {
    const hasUnsavedAiConfig = showAiConfigDialog.value
      && aiConfigContentRef.value?.hasUnsavedChanges?.()
    if (!hasUnsavedAiConfig && !hasPendingProjectPackageWork() && !pendingLibraryImageWork()) return
    event.preventDefault()
    event.returnValue = ''
  }

  return {
    backupNavItem,
    goNewProject,
    goMaterialCenter,
    goFreeCreate,
    goBackup,
    hasPendingProjectPackageWork,
    pendingProjectPackageWorkMessage,
    requestFilmListNavigation,
    handleBeforeUnload,
  }
}
