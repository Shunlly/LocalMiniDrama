/** 项目回收站的打开、加载、恢复和移入确认。 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { dramaAPI } from '@/api/drama'
import { describeTrashRestoreAnnouncement, truncateProjectTitle } from '@/components/filmList/filmListFormatters.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export function useFilmListTrash(deps = {}) {
  const { listWriteLocked, loadList } = deps

  const showTrashDialog = ref(false)
  const trashItems = ref([])
  const trashLoading = ref(false)
  const trashError = ref('')
  const trashAnnouncement = ref('')
  const trashPage = ref(1)
  const trashPageSize = ref(10)
  const trashTotal = ref(0)
  const restoringId = ref(null)

  function openTrash() {
    trashError.value = ''
    trashAnnouncement.value = ''
    showTrashDialog.value = true
  }

  async function loadTrash() {
    trashLoading.value = true
    trashError.value = ''
    try {
      const res = await dramaAPI.listTrash({
        page: trashPage.value,
        page_size: trashPageSize.value,
      })
      trashItems.value = res?.items ?? []
      trashTotal.value = res?.pagination?.total ?? 0
      if (res?.pagination?.page != null) trashPage.value = res.pagination.page
    } catch (error) {
      trashError.value = toUserFacingError(error, '回收站加载失败，请重试')
    } finally {
      trashLoading.value = false
    }
  }

  async function restoreFromTrash(item) {
    if (restoringId.value !== null) return
    restoringId.value = item.id
    trashError.value = ''
    trashAnnouncement.value = ''
    try {
      await dramaAPI.restore(item.id)
      if (trashItems.value.length === 1 && trashPage.value > 1) trashPage.value -= 1
      await loadTrash()
      loadList()
      trashAnnouncement.value = describeTrashRestoreAnnouncement(item.title)
      ElMessage.success('项目已恢复')
    } catch (error) {
      trashError.value = toUserFacingError(error, '恢复失败，请重试')
    } finally {
      restoringId.value = null
    }
  }

  async function moveToTrash(d) {
    if (listWriteLocked.value) return
    try {
      await ElMessageBox.confirm(
        `项目「${truncateProjectTitle(d.title)}」将移入回收站。项目内容和关联素材会完整保留，可随时恢复。`,
        '移入回收站',
        { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    try {
      await dramaAPI.moveToTrash(d.id)
      ElMessage.success('项目已移入回收站')
      loadList()
      if (showTrashDialog.value) loadTrash()
    } catch (e) {
      if (isUserFacingAbort(e) || e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '移入回收站失败'))
    }
  }

  return {
    showTrashDialog,
    trashItems,
    trashLoading,
    trashError,
    trashAnnouncement,
    trashPage,
    trashPageSize,
    trashTotal,
    restoringId,
    openTrash,
    loadTrash,
    restoreFromTrash,
    moveToTrash,
  }
}
