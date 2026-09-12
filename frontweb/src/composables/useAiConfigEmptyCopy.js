/**
 * AI 配置列表空态与依赖错误文案。页面仍负责 loadList/openTest。
 */
import { computed } from 'vue'
import { describeConfigEmptyDescription, describeConfigEmptyTitle } from '@/utils/aiConfigEmptyCopy.js'

export function useAiConfigEmptyCopy(deps = {}) {
  const list = deps.list
  const configLoadState = deps.configLoadState
  const configLoadError = deps.configLoadError
  const vendorLockError = deps.vendorLockError
  const activeServiceFilter = deps.activeServiceFilter

  const configListPendingEmpty = computed(() => (
    !list.value.length && configLoadState.value !== 'ready' && configLoadState.value !== 'error'
  ))
  const configListFailedEmpty = computed(() => (
    !list.value.length && configLoadState.value === 'error'
  ))
  const configEmptyTitle = computed(() => describeConfigEmptyTitle({
    failed: configListFailedEmpty.value,
    pending: configListPendingEmpty.value,
    serviceFilter: activeServiceFilter.value,
  }))
  const configEmptyDescription = computed(() => describeConfigEmptyDescription({
    failed: configListFailedEmpty.value,
    pending: configListPendingEmpty.value,
    loadError: configLoadError.value,
    serviceFilter: activeServiceFilter.value,
  }))
  const configDependencyError = computed(() => (
    [configLoadError.value, vendorLockError.value].filter(Boolean).join('；')
  ))

  return {
    configListPendingEmpty,
    configListFailedEmpty,
    configEmptyTitle,
    configEmptyDescription,
    configDependencyError,
  }
}