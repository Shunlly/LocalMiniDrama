/**
 * AI 配置页表单关闭、列表筛选与行选择等轻量处理器。
 * 页面仍负责 loadList/openTest；行选择继续跟随 configWriteLocked fail-closed。
 */
export function useAiConfigPageChrome(deps = {}) {
  const resetForm = deps.resetForm
  const configFormBaseline = deps.configFormBaseline
  const configDialogSaved = deps.configDialogSaved
  const activeServiceFilter = deps.activeServiceFilter
  const configWriteLocked = deps.configWriteLocked

  function handleConfigDialogClosed() {
    resetForm()
    configFormBaseline.value = ''
    configDialogSaved.value = false
  }

  function clearServiceFilter() {
    activeServiceFilter.value = ''
  }

  function isConfigRowSelectable() {
    return !configWriteLocked.value
  }

  return {
    handleConfigDialogClosed,
    clearServiceFilter,
    isConfigRowSelectable,
  }
}
