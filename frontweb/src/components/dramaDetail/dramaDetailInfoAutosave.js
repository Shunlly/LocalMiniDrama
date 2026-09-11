/**
 * 剧集详情信息卡自动保存、离开保护和指纹同步。
 * 创建信息表单状态，不把剧集 ID 和分集 ID 混用。
 */
import { computed, reactive, ref, watch } from 'vue'

import { stylePromptMetadataForSave } from '@/constants/styleOptions'

export function createDramaDetailInfoAutosave({
  dramaId,
  drama,
  isDramaReady,
  dramaAPI,
  ElMessage,
  ElMessageBox,
  episodeBatchImportDialogRef,
  confirmResourceEditLeave,
  hasUnsavedResourceEdits,
  dramaDetailUserError,
} = {}) {
  const infoForm = reactive({ title: '', description: '', genre: '', style: '', aspect_ratio: '16:9' })
  const infoSaveState = ref('saved')
  const infoSaveError = ref('')
  const infoSaveScheduled = ref(false)
  const infoSavedFingerprint = ref('')
  let infoSaveTimer = null
  let infoSavePromise = null
  let infoSaveRequestedWhileSaving = false
  let infoSyncing = false
  let infoLeaveConfirmOpen = false

  function buildInfoSnapshot() {
    return {
      title: infoForm.title || '',
      description: infoForm.description || '',
      genre: infoForm.genre || '',
      style: infoForm.style || '',
      aspect_ratio: infoForm.aspect_ratio || '16:9',
    }
  }

  function buildInfoFingerprint(snapshot) {
    return JSON.stringify(snapshot)
  }

  const infoDraftFingerprint = computed(() => buildInfoFingerprint(buildInfoSnapshot()))
  const hasUnsavedInfoChanges = computed(() => (
    isDramaReady.value && infoDraftFingerprint.value !== infoSavedFingerprint.value
  ))
  const shouldProtectInfoLeave = computed(() => (
    isDramaReady.value
    && (
      infoSaveState.value === 'error'
      || infoSaveScheduled.value
      || Boolean(infoSavePromise)
      || hasUnsavedInfoChanges.value
    )
  ))
  const infoSaveStatusLabel = computed(() => {
    if (!isDramaReady.value) return ''
    if (infoSaveState.value === 'error') return infoSaveError.value || '保存失败'
    if (infoSaveState.value === 'saving' || infoSaveScheduled.value || hasUnsavedInfoChanges.value) return '保存中...'
    return '已保存'
  })

  function syncInfoFormFromDrama(currentDrama) {
    infoSyncing = true
    infoForm.title = currentDrama?.title || ''
    infoForm.description = currentDrama?.description || ''
    infoForm.genre = currentDrama?.genre || ''
    infoForm.style = currentDrama?.style || ''
    infoForm.aspect_ratio = currentDrama?.metadata?.aspect_ratio || '16:9'
    const snapshot = buildInfoSnapshot()
    infoSavedFingerprint.value = buildInfoFingerprint(snapshot)
    infoSaveState.value = 'saved'
    infoSaveError.value = ''
    infoSaveScheduled.value = false
    infoSaveRequestedWhileSaving = false
    infoSyncing = false
  }

  function clearInfoSaveTimer() {
    if (infoSaveTimer) {
      clearTimeout(infoSaveTimer)
      infoSaveTimer = null
    }
  }

  function applySavedInfoToDrama(snapshot) {
    if (!drama.value) return
    drama.value = {
      ...drama.value,
      title: snapshot.title,
      description: snapshot.description,
      genre: snapshot.genre,
      style: snapshot.style,
      metadata: {
        ...(drama.value.metadata || {}),
        ...stylePromptMetadataForSave(snapshot.style),
        aspect_ratio: snapshot.aspect_ratio || '16:9',
      },
    }
  }

  function scheduleInfoSave({ immediate = false } = {}) {
    if (!isDramaReady.value || infoSyncing) return
    if (infoSavePromise) {
      infoSaveRequestedWhileSaving = true
      return
    }
    clearInfoSaveTimer()
    infoSaveScheduled.value = true
    if (immediate) {
      void flushInfoSave()
      return
    }
    infoSaveTimer = setTimeout(() => {
      infoSaveTimer = null
      void flushInfoSave()
    }, 600)
  }

  async function flushInfoSave() {
    if (!isDramaReady.value) return true
    if (infoSavePromise) return infoSavePromise
    clearInfoSaveTimer()
    if (!hasUnsavedInfoChanges.value && infoSaveState.value !== 'error') {
      infoSaveScheduled.value = false
      infoSaveState.value = 'saved'
      return true
    }

    const snapshot = buildInfoSnapshot()
    const fingerprint = buildInfoFingerprint(snapshot)
    infoSaveScheduled.value = false
    infoSaveState.value = 'saving'
    infoSaveError.value = ''
    infoSavePromise = (async () => {
      try {
        await dramaAPI.update(dramaId, { title: snapshot.title, description: snapshot.description })
        await dramaAPI.saveOutline(dramaId, {
          genre: snapshot.genre || undefined,
          style: snapshot.style || undefined,
          metadata: {
            ...stylePromptMetadataForSave(snapshot.style),
            aspect_ratio: snapshot.aspect_ratio || '16:9',
          },
        })
        infoSavedFingerprint.value = fingerprint
        applySavedInfoToDrama(snapshot)
        infoSaveState.value = 'saved'
        infoSaveError.value = ''
        return true
      } catch (error) {
        infoSaveState.value = 'error'
        infoSaveError.value = dramaDetailUserError(error, '项目信息保存失败，请重试。')
        return false
      } finally {
        infoSavePromise = null
        if (infoSaveRequestedWhileSaving) {
          infoSaveRequestedWhileSaving = false
          if (hasUnsavedInfoChanges.value && infoSaveState.value !== 'error') {
            scheduleInfoSave({ immediate: true })
          }
        }
      }
    })()
    return infoSavePromise
  }

  async function retryInfoSave() {
    await flushInfoSave()
  }

  function describeInfoLeaveRisk() {
    if (infoSaveState.value === 'error') {
      return '项目信息保存失败，离开后本次修改会丢失。'
    }
    if (infoSaveState.value === 'saving' || infoSaveScheduled.value || hasUnsavedInfoChanges.value) {
      return '项目信息仍在自动保存，离开后可能丢失最新修改。'
    }
    return ''
  }

  async function confirmBatchImportLeave() {
    if (episodeBatchImportDialogRef.value?.isImporting?.()) {
      ElMessage.warning('正在导入剧集，请完成后再离开。')
      return false
    }
    if (!episodeBatchImportDialogRef.value?.hasUnsavedWork?.()) return true
    return (await episodeBatchImportDialogRef.value.requestClose?.()) !== false
  }

  async function confirmInfoLeave() {
    if ((await confirmBatchImportLeave()) === false) return false
    if ((await confirmResourceEditLeave()) === false) return false
    if (!shouldProtectInfoLeave.value) return true
    if (infoSaveState.value !== 'error') {
      const saved = await flushInfoSave()
      if (saved && !shouldProtectInfoLeave.value) return true
    }
    if (infoLeaveConfirmOpen) return false
    infoLeaveConfirmOpen = true
    try {
      await ElMessageBox.confirm(
        describeInfoLeaveRisk(),
        '离开项目信息编辑？',
        {
          confirmButtonText: '仍然离开',
          cancelButtonText: '继续编辑',
          type: 'warning',
          distinguishCancelAndClose: true,
        },
      )
      return true
    } catch (_) {
      return false
    } finally {
      infoLeaveConfirmOpen = false
    }
  }

  function handleInfoBeforeUnload(event) {
    if (!shouldProtectInfoLeave.value && !episodeBatchImportDialogRef.value?.hasUnsavedWork?.() && !hasUnsavedResourceEdits()) return
    event.preventDefault()
    event.returnValue = ''
  }

  function saveInfo() {
    scheduleInfoSave({ immediate: true })
  }

  watch(infoDraftFingerprint, () => {
    if (!isDramaReady.value || infoSyncing) return
    if (!hasUnsavedInfoChanges.value) {
      if (infoSaveState.value !== 'error') {
        infoSaveScheduled.value = false
        infoSaveState.value = 'saved'
      }
      return
    }
    if (infoSaveState.value === 'error') infoSaveError.value = ''
    scheduleInfoSave()
  })

  return {
    infoForm,
    infoSaveState,
    infoSaveError,
    infoSaveScheduled,
    infoSavedFingerprint,
    infoDraftFingerprint,
    hasUnsavedInfoChanges,
    shouldProtectInfoLeave,
    infoSaveStatusLabel,
    syncInfoFormFromDrama,
    clearInfoSaveTimer,
    scheduleInfoSave,
    flushInfoSave,
    retryInfoSave,
    confirmBatchImportLeave,
    confirmInfoLeave,
    handleInfoBeforeUnload,
    saveInfo,
  }
}
