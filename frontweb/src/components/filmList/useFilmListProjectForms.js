/** 项目列表的新建与编辑表单提交。 */
import { computed, ref } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { dramaAPI } from '@/api/drama'
import { describeProjectFormSubmitDisabledReason } from '@/components/filmList/filmListFormatters.js'
import { newProjectDestination } from '@/utils/sourceImportNavigation.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export function useFilmListProjectForms(deps = {}) {
  const {
    listWriteLocked,
    listWriteLockReason,
    loadList,
    sourceImportIntent,
    projectListReturnTo,
    router,
  } = deps

  const showNewDialog = ref(false)
  const newForm = ref({ title: '', description: '', aspect_ratio: '16:9' })
  const newSaving = ref(false)
  const showEditDialog = ref(false)
  const editForm = ref({ id: null, title: '', description: '' })
  const editSaving = ref(false)
  const newSubmitDisabledReason = computed(() => describeProjectFormSubmitDisabledReason({
    writeLocked: listWriteLocked.value,
    writeLockReason: listWriteLockReason.value,
    title: newForm.value.title,
  }))
  const editSubmitDisabledReason = computed(() => describeProjectFormSubmitDisabledReason({
    writeLocked: listWriteLocked.value,
    writeLockReason: listWriteLockReason.value,
    title: editForm.value.title,
  }))

  function resetNewForm() {
    newForm.value = { title: '', description: '', aspect_ratio: '16:9' }
  }

  async function submitNew() {
    if (listWriteLocked.value) return
    const title = newForm.value.title?.trim()
    if (!title) return
    newSaving.value = true
    try {
      const drama = await dramaAPI.create({ title, description: newForm.value.description?.trim() || undefined, metadata: { aspect_ratio: newForm.value.aspect_ratio || '16:9' } })
      showNewDialog.value = false
      ElMessage.success('项目已创建')
      loadList()
      router.push(newProjectDestination(drama, sourceImportIntent.value, projectListReturnTo.value))
    } catch (e) {
      if (isUserFacingAbort(e) || e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '创建失败'))
    } finally {
      newSaving.value = false
    }
  }

  function openEditDialog(d) {
    if (listWriteLocked.value) return
    editForm.value = { id: d.id, title: d.title || '', description: d.description || '' }
    showEditDialog.value = true
  }

  function resetEditForm() {
    editForm.value = { id: null, title: '', description: '' }
  }

  async function submitEdit() {
    if (listWriteLocked.value) return
    const title = editForm.value.title?.trim()
    if (!title || editForm.value.id == null) return
    editSaving.value = true
    try {
      await dramaAPI.update(editForm.value.id, { title, description: editForm.value.description?.trim() || undefined })
      showEditDialog.value = false
      ElMessage.success('已保存')
      loadList()
    } catch (e) {
      if (isUserFacingAbort(e) || e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      editSaving.value = false
    }
  }

  return {
    showNewDialog,
    newForm,
    newSaving,
    showEditDialog,
    editForm,
    editSaving,
    newSubmitDisabledReason,
    editSubmitDisabledReason,
    resetNewForm,
    submitNew,
    openEditDialog,
    resetEditForm,
    submitEdit,
  }
}
