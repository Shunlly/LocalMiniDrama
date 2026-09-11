/** 项目列表工作区导航、离开保护和备份入口。 */
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { describePendingProjectPackageWork } from '@/components/filmList/filmListFormatters.js'
import { LIBRARY_IMAGE_LEAVE_MESSAGE } from '@/components/filmList/filmListLibraryImage.js'
import { normalizeBackupReturnTo } from '@/composables/useBackupSettings.js'
import { listWorkspaceNavItems, openWorkspaceNavItem } from '@/layouts/AppWorkspaceNav.js'

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
      ElMessage.warning(pendingProjectPackageWorkMessage())
      return false
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
