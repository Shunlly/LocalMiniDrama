/**
 * 即梦2素材资产弹窗。页面仍负责表单接线和 loadList/openTest。
 */
import { ElMessage as defaultElMessage } from '@/utils/elementPlusFeedback.js'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import { isMaskedSecret } from '@/composables/useAiConfigUnsaved.js'

export function useAiConfigJimeng2Assets(deps = {}) {
  const ElMessage = deps.ElMessage || defaultElMessage
  const aiAPI = deps.aiAPI || defaultAiAPI
  const form = deps.form
  const editingId = deps.editingId
  const jimeng2AssetsDialogVisible = deps.jimeng2AssetsDialogVisible
  const jimeng2AssetsLoading = deps.jimeng2AssetsLoading
  const jimeng2AssetsRows = deps.jimeng2AssetsRows
  const jimeng2AssetsHasMore = deps.jimeng2AssetsHasMore
  const jimeng2AssetsNextCursor = deps.jimeng2AssetsNextCursor

  function onJimeng2AssetsDialogClosed() {
    jimeng2AssetsRows.value = []
    jimeng2AssetsNextCursor.value = null
    jimeng2AssetsHasMore.value = false
  }

  async function fetchJimeng2MaterialAssets(firstPage) {
    if (!form.value.base_url?.trim() || !form.value.api_key?.trim()) {
      ElMessage.warning('请先填写网关 URL 与 Token')
      return
    }
    if (firstPage) {
      jimeng2AssetsRows.value = []
      jimeng2AssetsNextCursor.value = null
      jimeng2AssetsHasMore.value = false
      jimeng2AssetsDialogVisible.value = true
    }
    jimeng2AssetsLoading.value = true
    try {
      const data = await aiAPI.listJimeng2MaterialAssets({
        id: editingId.value || undefined,
        base_url: form.value.base_url.trim(),
        api_key: isMaskedSecret(form.value.api_key) ? undefined : form.value.api_key,
        limit: 20,
        cursor: firstPage ? undefined : jimeng2AssetsNextCursor.value || undefined,
      })
      const items = Array.isArray(data?.items) ? data.items : []
      if (firstPage) {
        jimeng2AssetsRows.value = items
      } else {
        jimeng2AssetsRows.value = [...jimeng2AssetsRows.value, ...items]
      }
      jimeng2AssetsNextCursor.value = data?.next_cursor ?? null
      jimeng2AssetsHasMore.value = !!data?.has_more
    } catch (_) {
      /* request 拦截器已 ElMessage */
    } finally {
      jimeng2AssetsLoading.value = false
    }
  }

  function openJimeng2MaterialAssetsDialog() {
    fetchJimeng2MaterialAssets(true)
  }

  function loadMoreJimeng2MaterialAssets() {
    if (!jimeng2AssetsHasMore.value || !jimeng2AssetsNextCursor.value) return
    fetchJimeng2MaterialAssets(false)
  }

  return {
    onJimeng2AssetsDialogClosed,
    fetchJimeng2MaterialAssets,
    openJimeng2MaterialAssetsDialog,
    loadMoreJimeng2MaterialAssets,
  }
}
