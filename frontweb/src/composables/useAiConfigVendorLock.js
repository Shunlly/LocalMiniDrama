/**
 * AI 配置厂商锁定状态。失败时写操作保持锁定；页面仍负责 loadList。
 */
import { ref } from 'vue'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import {
  describeServiceLoadError,
  isRequestCanceled,
  withRequestRetry,
} from '@/utils/requestError.js'
import { jsonRequestOptions as defaultJsonRequestOptions } from '@/utils/aiConfigRequestOptions.js'

export function useAiConfigVendorLock(deps = {}) {
  const aiAPI = deps.aiAPI || defaultAiAPI
  const jsonRequestOptions = deps.jsonRequestOptions || defaultJsonRequestOptions
  const vendorLock = ref({ enabled: false, config_file: '' })
  const vendorLockResolved = ref(false)
  const vendorLockLoading = ref(false)
  const vendorLockError = ref('')
  let vendorLockAbortController = null

  function abortVendorLockRequest() {
    vendorLockAbortController?.abort()
    vendorLockAbortController = null
  }

  async function loadVendorLock() {
    vendorLockAbortController?.abort()
    const controller = new AbortController()
    vendorLockAbortController = controller
    vendorLockLoading.value = true
    vendorLockResolved.value = false
    try {
      vendorLock.value = await withRequestRetry(
        () => aiAPI.getVendorLock(jsonRequestOptions(controller.signal)),
        { maxAttempts: 2, delayMs: 400, signal: controller.signal },
      )
      if (controller.signal.aborted) return
      vendorLockError.value = ''
      vendorLockResolved.value = true
    } catch (error) {
      if (isRequestCanceled(error) || controller.signal.aborted) return
      vendorLockError.value = describeServiceLoadError(error, {
        serviceLabel: '厂商锁定服务',
        fallback: '暂时无法确认厂商锁定状态，请稍后重试。',
        signal: controller.signal,
      })
      vendorLockResolved.value = false
    } finally {
      if (vendorLockAbortController === controller) {
        vendorLockAbortController = null
        vendorLockLoading.value = false
      }
    }
  }

  return {
    vendorLock,
    vendorLockResolved,
    vendorLockLoading,
    vendorLockError,
    loadVendorLock,
    abortVendorLockRequest,
  }
}
