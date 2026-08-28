/**
 * AI 配置页「未保存保护 / 校验摘要 / 指纹」逻辑。
 * 组件负责接线 refs 和弹窗；关闭判定、指纹和校验摘要在这里完成。
 */
import { nextTick as vueNextTick } from 'vue'
import { ElMessageBox } from 'element-plus'
import { hasUnsavedAiConfigChanges } from '@/utils/aiConfigUnsavedGuard.js'
import {
  createAiConfigValidationSummary,
  focusFirstInvalidAiConfigField,
  getAiConfigFieldDescription,
} from '@/utils/aiConfigValidationFocus.js'

export const MASKED_SECRET = '********'
export const DEFAULT_MODEL_VALIDATION_MESSAGE = '请选择模型列表中的有效默认模型'
export const AI_CONFIG_DISCARD_MESSAGE = '当前 AI 配置尚未保存，关闭后本次修改会丢失。'
export const AI_CONFIG_DISCARD_TITLE = '放弃未保存修改？'
export const AI_CONFIG_DISCARD_CONFIRM_TEXT = '放弃修改'
export const AI_CONFIG_DISCARD_CANCEL_TEXT = '继续编辑'

export function isMaskedSecret(value, maskedSecret = MASKED_SECRET) {
  return String(value || '').trim() === maskedSecret
}

export function configFormFingerprint(form) {
  return JSON.stringify(form)
}

export function generationSettingsFingerprint(concurrency, videoConcurrency) {
  return JSON.stringify([concurrency, videoConcurrency])
}

export function isDefaultModelSelectionValid(value, { isComfyUi = false, modelList = [] } = {}) {
  const selected = String(value || '').trim()
  if (isComfyUi && modelList.length === 0 && !selected) return true
  return Boolean(selected && modelList.includes(selected))
}

export function configFieldDescriptionId(field) {
  return `ai-config-${field}-description`
}

export function isConfigFieldInvalid(field, summary = []) {
  return summary.some((item) => item.field === field)
}

export function configFieldDescription(
  field,
  summary = [],
  defaultModelMessage = DEFAULT_MODEL_VALIDATION_MESSAGE,
) {
  return summary.find((item) => item.field === field)?.message
    || (field === 'default_model' ? defaultModelMessage : '')
    || getAiConfigFieldDescription(field)
}

export function clearConfigFieldValidation(summary = [], prop) {
  return summary.filter((item) => item.prop !== prop && item.field !== prop)
}

export function useAiConfigUnsaved(deps = {}) {
  const {
    formModelList,
    isComfyUiForm,
    configValidationSummary,
    advancedFormSections,
    configDialogScrollRef,
    configFormDirty,
    generationSettingsDirty,
    credentialDraftDirty,
    promptEditorRef,
    sceneModelMapRef,
    configDialogSaved,
    dialogVisible,
    oneKeyTongyiKey,
    oneKeyTongyiVisible,
    oneKeyVolcKey,
    oneKeyVolcVisible,
    oneKeyAgnesKey,
    oneKeyAgnesVisible,
    bulkKeyInput,
    bulkKeyVisible,
  } = deps
  const nextTick = deps.nextTick || vueNextTick
  const confirmBox = deps.confirmBox || ((message, title, options) => (
    ElMessageBox.confirm(message, title, options)
  ))
  const discardMessage = deps.discardMessage || AI_CONFIG_DISCARD_MESSAGE
  const discardTitle = deps.discardTitle || AI_CONFIG_DISCARD_TITLE
  const discardConfirmText = deps.discardConfirmText || AI_CONFIG_DISCARD_CONFIRM_TEXT
  const discardCancelText = deps.discardCancelText || AI_CONFIG_DISCARD_CANCEL_TEXT

  function isDefaultModelSelectionValidBound(value) {
    return isDefaultModelSelectionValid(value, {
      isComfyUi: Boolean(isComfyUiForm?.value),
      modelList: formModelList?.value || [],
    })
  }

  function isConfigFieldInvalidBound(field) {
    return isConfigFieldInvalid(field, configValidationSummary?.value || [])
  }

  function configFieldDescriptionBound(field) {
    return configFieldDescription(field, configValidationSummary?.value || [])
  }

  function clearConfigValidationSummary() {
    if (configValidationSummary) configValidationSummary.value = []
  }

  function clearConfigFieldValidationBound(prop) {
    if (!configValidationSummary) return
    configValidationSummary.value = clearConfigFieldValidation(configValidationSummary.value || [], prop)
  }

  function handleConfigFieldValidated(prop, isValid) {
    if (isValid) clearConfigFieldValidationBound(prop)
  }

  function expandConfigValidationSection(section) {
    if (!section || !advancedFormSections) return
    if (advancedFormSections.value.includes(section)) return
    advancedFormSections.value = [...advancedFormSections.value, section]
  }

  async function handleConfigValidationFailure(invalidFields) {
    const summary = createAiConfigValidationSummary(invalidFields)
    if (invalidFields?.default_model) {
      summary.push({
        field: 'default_model',
        prop: 'default_model',
        label: '默认模型',
        message: DEFAULT_MODEL_VALIDATION_MESSAGE,
        section: null,
      })
    }
    if (configValidationSummary) configValidationSummary.value = summary
    await focusFirstInvalidAiConfigField(summary, {
      scrollContainer: configDialogScrollRef?.value,
      expandSection: expandConfigValidationSection,
      nextTickFn: nextTick,
    })
  }

  function hasUnsavedChanges() {
    return Boolean(configFormDirty?.value)
      || Boolean(generationSettingsDirty?.value)
      || Boolean(credentialDraftDirty?.value)
      || hasUnsavedAiConfigChanges([
        promptEditorRef?.value,
        sceneModelMapRef?.value,
      ])
  }

  async function confirmDiscard() {
    try {
      await confirmBox(
        discardMessage,
        discardTitle,
        {
          confirmButtonText: discardConfirmText,
          cancelButtonText: discardCancelText,
          type: 'warning',
          distinguishCancelAndClose: true,
        },
      )
      return true
    } catch (_) {
      return false
    }
  }

  async function requestClose() {
    if (!hasUnsavedChanges()) return true
    if (!await confirmDiscard()) return false
    return true
  }

  async function confirmConfigDialogClose(done) {
    if (configDialogSaved?.value || !configFormDirty?.value || await confirmDiscard()) done()
  }

  async function requestConfigDialogClose() {
    if (configDialogSaved?.value || !configFormDirty?.value || await confirmDiscard()) {
      if (dialogVisible) dialogVisible.value = false
    }
  }

  async function confirmCredentialDraftClose(input, done) {
    if (!input.value.trim() || await confirmDiscard()) done()
  }

  async function requestCredentialDraftClose(input, visible) {
    if (!input.value.trim() || await confirmDiscard()) visible.value = false
  }

  const confirmOneKeyTongyiClose = (done) => confirmCredentialDraftClose(oneKeyTongyiKey, done)
  const confirmOneKeyVolcClose = (done) => confirmCredentialDraftClose(oneKeyVolcKey, done)
  const confirmOneKeyAgnesClose = (done) => confirmCredentialDraftClose(oneKeyAgnesKey, done)
  const confirmBulkKeyClose = (done) => confirmCredentialDraftClose(bulkKeyInput, done)
  const requestOneKeyTongyiClose = () => requestCredentialDraftClose(oneKeyTongyiKey, oneKeyTongyiVisible)
  const requestOneKeyVolcClose = () => requestCredentialDraftClose(oneKeyVolcKey, oneKeyVolcVisible)
  const requestOneKeyAgnesClose = () => requestCredentialDraftClose(oneKeyAgnesKey, oneKeyAgnesVisible)
  const requestBulkKeyClose = () => requestCredentialDraftClose(bulkKeyInput, bulkKeyVisible)

  return {
    isDefaultModelSelectionValid: isDefaultModelSelectionValidBound,
    configFieldDescriptionId,
    isConfigFieldInvalid: isConfigFieldInvalidBound,
    configFieldDescription: configFieldDescriptionBound,
    clearConfigValidationSummary,
    clearConfigFieldValidation: clearConfigFieldValidationBound,
    handleConfigFieldValidated,
    expandConfigValidationSection,
    handleConfigValidationFailure,
    hasUnsavedChanges,
    confirmDiscard,
    requestClose,
    confirmConfigDialogClose,
    requestConfigDialogClose,
    confirmCredentialDraftClose,
    requestCredentialDraftClose,
    confirmOneKeyTongyiClose,
    confirmOneKeyVolcClose,
    confirmOneKeyAgnesClose,
    confirmBulkKeyClose,
    requestOneKeyTongyiClose,
    requestOneKeyVolcClose,
    requestOneKeyAgnesClose,
    requestBulkKeyClose,
  }
}
