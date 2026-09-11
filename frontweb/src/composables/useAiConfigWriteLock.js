/**
 * AI 配置写入锁。列表未就绪或厂商锁定未解析时保持 fail-closed。
 */
import { computed, watch } from 'vue'

export function useAiConfigWriteLock(deps = {}) {
  const configLoadState = deps.configLoadState
  const vendorLockResolved = deps.vendorLockResolved
  const saving = deps.saving
  const bulkKeySaving = deps.bulkKeySaving
  const batchDeleting = deps.batchDeleting
  const oneKeyTongyiSaving = deps.oneKeyTongyiSaving
  const oneKeyVolcSaving = deps.oneKeyVolcSaving
  const oneKeyAgnesSaving = deps.oneKeyAgnesSaving
  const selectedRows = deps.selectedRows

  const configWriteLocked = computed(() => (
    configLoadState.value !== 'ready'
    || !vendorLockResolved.value
    || saving.value
    || bulkKeySaving.value
    || batchDeleting.value
    || oneKeyTongyiSaving.value
    || oneKeyVolcSaving.value
    || oneKeyAgnesSaving.value
  ))

  const configWriteLockReason = computed(() => {
    if (saving.value) return '正在保存配置，请稍候'
    if (bulkKeySaving.value) return '正在批量替换密钥，请稍候'
    if (batchDeleting.value) return '正在批量删除配置，请稍候'
    if (oneKeyTongyiSaving.value || oneKeyVolcSaving.value || oneKeyAgnesSaving.value) {
      return '正在一键配置，请稍候'
    }
    if (configLoadState.value !== 'ready') return '配置列表尚未就绪'
    if (!vendorLockResolved.value) return '厂商锁定状态尚未解析'
    return ''
  })

  if (selectedRows) {
    watch(configWriteLocked, (locked) => {
      if (locked) selectedRows.value = []
    })
  }

  const canAutoOpenMissingService = computed(() => (
    configLoadState.value === 'ready' && vendorLockResolved.value
  ))

  return {
    configWriteLocked,
    configWriteLockReason,
    canAutoOpenMissingService,
  }
}