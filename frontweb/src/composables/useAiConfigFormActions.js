/**
 * AI 配置表单打开、重置与提交。页面仍负责 loadList/openTest。
 */
import { nextTick as vueNextTick } from 'vue'
import { ElMessage as defaultElMessage, ElMessageBox as defaultElMessageBox } from '@/utils/elementPlusFeedback.js'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'
import { runWithOwnedRequestErrorToast as defaultRunWithOwnedRequestErrorToast } from '@/utils/request.js'
import { createBlankAiConfigForm, hydrateAiConfigForm } from '@/utils/aiConfigFormState.js'
import {
  findExistingDefaultConfig,
  buildReplaceDefaultConfirmCopy,
  buildAiConfigSubmitPayload,
} from '@/utils/aiConfigSubmitPayload.js'
import {
  confirmAiConfigMutationInList,
  confirmAiConfigMutationResult,
} from '@/utils/aiConfigMutations.js'
import { applyAiConfigRepairTarget } from '@/utils/aiConfigRepairTarget.js'
import { describeAiConfigSaveSuccess } from '@/utils/aiConfigLabels.js'
import { publishAiConfigChanged as defaultPublishAiConfigChanged } from '@/utils/aiConfigChangeBus.js'
import { configFormFingerprint as fingerprintConfigForm } from '@/composables/useAiConfigUnsaved.js'

export function useAiConfigFormActions(deps = {}) {
  const ElMessage = deps.ElMessage || defaultElMessage
  const ElMessageBox = deps.ElMessageBox || defaultElMessageBox
  const aiAPI = deps.aiAPI || defaultAiAPI
  const runWithOwnedRequestErrorToast = deps.runWithOwnedRequestErrorToast || defaultRunWithOwnedRequestErrorToast
  const nextTick = deps.nextTick || vueNextTick
  const emit = deps.emit
  const configWriteLocked = deps.configWriteLocked
  const form = deps.form
  const formRef = deps.formRef
  const editingId = deps.editingId
  const editingUpdatedAt = deps.editingUpdatedAt
  const presetModelPick = deps.presetModelPick
  const advancedFormSections = deps.advancedFormSections
  const dialogVisible = deps.dialogVisible
  const configDialogSaved = deps.configDialogSaved
  const configFormBaseline = deps.configFormBaseline
  const configDialogScrollRef = deps.configDialogScrollRef
  const saving = deps.saving
  const list = deps.list
  const loadList = deps.loadList
  const resetDiscoverModelsState = deps.resetDiscoverModelsState
  const clearConfigValidationSummary = deps.clearConfigValidationSummary
  const handleConfigValidationFailure = deps.handleConfigValidationFailure
  const onServiceTypeChange = deps.onServiceTypeChange
  const activeServiceFilter = deps.activeServiceFilter
  const apiKeyInputRef = deps.apiKeyInputRef
  const modelListInputRef = deps.modelListInputRef
  const workflowInputRef = deps.workflowInputRef
  const isComfyUiForm = deps.isComfyUiForm
  const isDeepSeekOfficialForm = deps.isDeepSeekOfficialForm
  const invalidateConnectionTestResults = deps.invalidateConnectionTestResults
  const revealSavedConfigs = deps.revealSavedConfigs
  const publishAiConfigChanged = deps.publishAiConfigChanged || defaultPublishAiConfigChanged

  function notifyConfigurationChanged() {
    emit('configuration-changed')
    publishAiConfigChanged({ action: 'changed' })
  }

  function resetForm() {
    resetDiscoverModelsState()
    editingId.value = null
    editingUpdatedAt.value = ''
    presetModelPick.value = ''
    advancedFormSections.value = []
    clearConfigValidationSummary()
    form.value = createBlankAiConfigForm()
    formRef.value?.resetFields?.()
  }

  function configFormFingerprint() {
    return fingerprintConfigForm(form.value)
  }

  function openConfigDialog() {
    configDialogSaved.value = false
    clearConfigValidationSummary()
    dialogVisible.value = true
    nextTick(() => {
      configFormBaseline.value = configFormFingerprint()
      if (configDialogScrollRef.value) configDialogScrollRef.value.scrollTop = 0
    })
  }

  function openAdd() {
    if (configWriteLocked.value) return
    resetForm()
    openConfigDialog()
  }

  function openAddForService(serviceType) {
    if (configWriteLocked.value) return
    resetForm()
    form.value.service_type = serviceType || 'text'
    activeServiceFilter.value = form.value.service_type
    onServiceTypeChange()
    openConfigDialog()
  }

  async function openEdit(row, { repairIssue = '' } = {}) {
    if (configWriteLocked.value) return
    editingId.value = row.id
    editingUpdatedAt.value = String(row.updated_at || '')
    advancedFormSections.value = []
    form.value = hydrateAiConfigForm(row)
    openConfigDialog()
    await applyAiConfigRepairTarget(repairIssue, {
      advancedSections: advancedFormSections,
      fieldRefs: {
        credentials: apiKeyInputRef,
        model: modelListInputRef,
        workflow: workflowInputRef,
      },
      nextTickFn: nextTick,
    })
  }

  async function confirmReplaceDefaultConfig() {
    if (!form.value.is_default) return true
    const existing = findExistingDefaultConfig(list.value, form.value.service_type, editingId.value)
    if (!existing) return true
    const copy = buildReplaceDefaultConfirmCopy(form.value, existing)
    try {
      await ElMessageBox.confirm(
        copy.message,
        copy.title,
        { type: 'warning', confirmButtonText: copy.confirmButtonText, cancelButtonText: copy.cancelButtonText },
      )
      return true
    } catch (error) {
      if (!isUserFacingAbort(error)) {
        ElMessage.error(toUserFacingError(error, '无法确认保存'))
      }
      return false
    }
  }

  async function submit() {
    if (configWriteLocked.value) return
    try {
      await formRef.value?.validate?.()
    } catch (invalidFields) {
      await handleConfigValidationFailure(invalidFields)
      return
    }
    clearConfigValidationSummary()
    if (!await confirmReplaceDefaultConfig()) return
    if (configWriteLocked.value) return
    saving.value = true
    try {
      const previous = editingId.value
        ? list.value.find((row) => String(row.id) === String(editingId.value))
        : null
      const payload = buildAiConfigSubmitPayload(form.value, {
        editingId: editingId.value,
        editingUpdatedAt: editingUpdatedAt.value,
        previous,
        isComfyUi: isComfyUiForm.value,
        isDeepSeekOfficial: isDeepSeekOfficialForm.value,
      })
      const wasEditing = Boolean(editingId.value)
      const mutationResult = await runWithOwnedRequestErrorToast(async () => (
        wasEditing
          ? await aiAPI.update(editingId.value, payload)
          : await aiAPI.create(payload)
      ))
      const serverConfirmation = confirmAiConfigMutationResult(mutationResult, payload, previous || {})
      if (!serverConfirmation) {
        await loadList()
        ElMessage.error('服务端返回的配置快照与本次提交不一致，未确认保存结果，请重新打开配置核对。')
        return
      }
      const listConfirmed = await loadList()
      const listMatches = listConfirmed && confirmAiConfigMutationInList(serverConfirmation, list.value)
      invalidateConnectionTestResults()
      notifyConfigurationChanged()
      configDialogSaved.value = true
      configFormBaseline.value = configFormFingerprint()
      dialogVisible.value = false
      revealSavedConfigs?.()
      if (listMatches) ElMessage.success(describeAiConfigSaveSuccess(wasEditing, form.value.service_type))
      else ElMessage.warning('服务端已确认保存，但配置列表刷新或并发校验未完全一致，请刷新后复核。')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      if (e?.response?.status === 409) {
        await loadList()
        ElMessage.warning('配置已被其他操作更新，本次修改未覆盖现有配置，请重新打开后再保存。')
        return
      }
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      saving.value = false
    }
  }

  return {
    notifyConfigurationChanged,
    resetForm,
    configFormFingerprint,
    openConfigDialog,
    openAdd,
    openAddForService,
    openEdit,
    confirmReplaceDefaultConfig,
    submit,
  }
}
