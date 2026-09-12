/**
 * AI 配置从服务读取模型。页面仍负责表单接线和 loadList/openTest。
 */
import { ref } from 'vue'
import { ElMessage as defaultElMessage } from '@/utils/elementPlusFeedback.js'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import { isMaskedSecret } from '@/composables/useAiConfigUnsaved.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'
import { DEFAULT_CONNECTION_TEST_TIMEOUT_MS } from '@/utils/requestError.js'
import { extractDiscoveredModelIds, mergeModelTextWithDiscovered } from '@/utils/aiConfigDiscoverModels.js'

export function useAiConfigDiscoverModels(deps = {}) {
  const ElMessage = deps.ElMessage || defaultElMessage
  const aiAPI = deps.aiAPI || defaultAiAPI
  const form = deps.form
  const editingId = deps.editingId
  const dialogVisible = deps.dialogVisible
  const discoverModelsDisabled = deps.discoverModelsDisabled
  const discoverModelsLoading = deps.discoverModelsLoading || ref(false)

  let discoverModelsAbortController = null
  let discoverModelsSequence = 0

  function abortDiscoverModelsRequest() {
    discoverModelsAbortController?.abort()
    discoverModelsAbortController = null
  }

  function resetDiscoverModelsState() {
    abortDiscoverModelsRequest()
    discoverModelsSequence += 1
    discoverModelsLoading.value = false
  }

  async function discoverModelsFromService() {
    if (discoverModelsDisabled.value) return
    discoverModelsAbortController?.abort()
    const controller = new AbortController()
    discoverModelsAbortController = controller
    const requestId = ++discoverModelsSequence
    const targetEditingId = editingId.value
    discoverModelsLoading.value = true
    try {
      const data = await aiAPI.discoverModels({
        id: editingId.value || undefined,
        base_url: String(form.value.base_url || '').trim(),
        api_key: isMaskedSecret(form.value.api_key) ? undefined : form.value.api_key,
        provider: form.value.provider,
        api_protocol: form.value.api_protocol,
        endpoint: form.value.endpoint,
        service_type: form.value.service_type,
      }, {
        signal: controller.signal,
        timeout: DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
        suppressErrorToast: true,
      })
      if (requestId !== discoverModelsSequence || !dialogVisible.value) return
      if (editingId.value !== targetEditingId) return
      const ids = extractDiscoveredModelIds(data)
      if (!ids.length) {
        ElMessage.warning('下一步：服务没有返回模型目录，请手工填写模型名')
        return
      }
      const result = mergeModelTextWithDiscovered(form.value.modelText, ids)
      form.value.modelText = result.text
      if (!String(form.value.default_model || '').trim() && result.merged.length) {
        form.value.default_model = result.merged[0]
      }
      if (result.appended.length) {
        ElMessage.success('已从服务追加 ' + result.appended.length + ' 个模型')
      } else {
        ElMessage.success('未发现新模型，已保留当前模型列表')
      }
    } catch (e) {
      if (requestId !== discoverModelsSequence) return
      if (isUserFacingAbort(e, controller.signal)) return
      ElMessage.error(toUserFacingError(e, '暂时无法读取模型目录，请稍后重试或手工填写模型名。', {
        serviceLabel: '模型目录服务',
        signal: controller.signal,
      }))
    } finally {
      if (requestId === discoverModelsSequence) discoverModelsLoading.value = false
      if (discoverModelsAbortController === controller) discoverModelsAbortController = null
    }
  }

  return {
    discoverModelsLoading,
    discoverModelsFromService,
    abortDiscoverModelsRequest,
    resetDiscoverModelsState,
  }
}
