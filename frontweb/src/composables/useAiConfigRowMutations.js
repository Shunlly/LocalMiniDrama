/**
 * AI 配置列表的批量换密钥与删除。页面仍负责弹窗接线和 loadList。
 */
import { ElMessage as defaultElMessage, ElMessageBox as defaultElMessageBox } from '@/utils/elementPlusFeedback.js'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'
import {
  confirmAiConfigBulkKeyResult,
  isAiConfigBulkKeyResult,
} from '@/utils/aiConfigMutations.js'
import { describeAiConfigBulkKeySuccess } from '@/utils/aiConfigLabels.js'

export function useAiConfigRowMutations(deps = {}) {
  const ElMessage = deps.ElMessage || defaultElMessage
  const ElMessageBox = deps.ElMessageBox || defaultElMessageBox
  const aiAPI = deps.aiAPI || defaultAiAPI
  const configWriteLocked = deps.configWriteLocked
  const bulkKeyInput = deps.bulkKeyInput
  const bulkKeyVisible = deps.bulkKeyVisible
  const bulkKeySaving = deps.bulkKeySaving
  const selectedRows = deps.selectedRows
  const batchDeleting = deps.batchDeleting
  const loadList = deps.loadList
  const list = deps.list
  const invalidateConnectionTestResults = deps.invalidateConnectionTestResults
  const notifyConfigurationChanged = deps.notifyConfigurationChanged

  function openBulkKey() {
    if (configWriteLocked.value) return
    bulkKeyInput.value = ''
    bulkKeyVisible.value = true
  }

  async function submitBulkKey() {
    if (configWriteLocked.value) return
    const key = bulkKeyInput.value.trim()
    if (!key) return
    try {
      await ElMessageBox.confirm(
        '确定用新密钥替换所有配置的 API 密钥？此操作不可恢复。',
        '批量换密钥确认',
        { type: 'warning', confirmButtonText: '确定替换', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
      )
    } catch (error) {
      if (!isUserFacingAbort(error)) {
        ElMessage.error(toUserFacingError(error, '无法确认替换密钥'))
      }
      return
    }
    if (configWriteLocked.value) return
    bulkKeySaving.value = true
    try {
      const res = await aiAPI.bulkUpdateKey(key)
      if (!isAiConfigBulkKeyResult(res)) {
        await loadList()
        ElMessage.error('服务端未返回完整的批量换密钥确认结果，请刷新后复核。')
        return
      }
      const listConfirmed = await loadList()
      const listMatches = listConfirmed && confirmAiConfigBulkKeyResult(res, list.value)
      if (Number(res?.updated) > 0) {
        invalidateConnectionTestResults()
        notifyConfigurationChanged()
      }
      bulkKeyVisible.value = false
      if (listMatches) ElMessage.success(describeAiConfigBulkKeySuccess(res))
      else ElMessage.warning('服务端已确认批量换密钥，但配置列表刷新或并发校验未完全一致，请刷新后复核。')
    } catch (error) {
      if (isUserFacingAbort(error)) return
      ElMessage.error(toUserFacingError(error, '批量换密钥失败'))
    } finally {
      bulkKeySaving.value = false
    }
  }

  async function onDelete(row) {
    if (configWriteLocked.value) return
    const name = String(row?.name || '').trim() || '未命名配置'
    try {
      await ElMessageBox.confirm(`确定删除配置「${name}」？此操作不可恢复。`, '删除确认', {
        type: 'warning',
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      })
    } catch (error) {
      if (!isUserFacingAbort(error)) {
        ElMessage.error(toUserFacingError(error, '无法确认删除'))
      }
      return
    }
    if (configWriteLocked.value) return
    try {
      await aiAPI.delete(row.id)
      ElMessage.success('已删除')
      invalidateConnectionTestResults()
      notifyConfigurationChanged()
      await loadList()
    } catch (error) {
      if (isUserFacingAbort(error)) return
      ElMessage.error(toUserFacingError(error, '删除失败'))
    }
  }

  function onSelectionChange(rows) {
    selectedRows.value = rows
  }

  async function onBatchDelete() {
    if (configWriteLocked.value) return
    if (!selectedRows.value.length) return
    try {
      await ElMessageBox.confirm(
        `确定删除选中的 ${selectedRows.value.length} 条配置？此操作不可恢复。`,
        '批量删除确认',
        { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
      )
    } catch (error) {
      if (!isUserFacingAbort(error)) {
        ElMessage.error(toUserFacingError(error, '无法确认删除'))
      }
      return
    }
    if (configWriteLocked.value) return
    batchDeleting.value = true
    let success = 0, failed = 0
    for (const row of selectedRows.value) {
      try {
        await aiAPI.delete(row.id)
        success++
      } catch (_) { failed++ }
    }
    batchDeleting.value = false
    selectedRows.value = []
    if (success > 0) {
      invalidateConnectionTestResults()
      notifyConfigurationChanged()
    }
    if (!success && failed) ElMessage.error(`删除失败，${failed} 条未能删除`)
    else if (failed) ElMessage.warning(`已删除 ${success} 条，${failed} 条失败`)
    else ElMessage.success(`已删除 ${success} 条`)
    await loadList()
  }

  return {
    openBulkKey,
    submitBulkKey,
    onDelete,
    onSelectionChange,
    onBatchDelete,
  }
}
