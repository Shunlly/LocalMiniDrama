/**
 * AI 配置列表空态与依赖错误文案。页面仍负责 loadList/openTest。
 */
import { computed } from 'vue'
import { serviceTypeLabel } from '@/utils/aiConfigLabels.js'

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
  const configEmptyTitle = computed(() => {
    if (configListFailedEmpty.value) return '暂时无法读取配置列表'
    if (configListPendingEmpty.value) return '正在读取配置列表'
    if (activeServiceFilter.value) return `暂无${serviceTypeLabel(activeServiceFilter.value)}配置`
    return '还没有 AI 服务配置'
  })
  const configEmptyDescription = computed(() => {
    if (configListFailedEmpty.value) {
      return configLoadError.value || '请点击重试后再查看或添加配置。'
    }
    if (configListPendingEmpty.value) return '正在从本地服务读取已保存的厂商配置。'
    if (activeServiceFilter.value === 'ocr') return '添加一个配置并设为默认，即可用于 PDF/图片识别。'
    if (activeServiceFilter.value === 'transcription') return '添加一个配置并设为默认，即可用于音频/视频转写。'
    if (activeServiceFilter.value) return '添加一个配置并设为默认，即可用于对应生成环节。'
    return '先添加文本、图片或视频厂商，生成流程会自动使用默认配置。'
  })
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