/**
 * AI 配置连接测试状态。页面仍负责 loadList/openTest 与实际店写入。
 */
import { ref } from 'vue'
import {
  createAiConfigConnectionStatusStore,
  resolveAiConfigConnectionStatusScope,
} from '@/utils/aiConfigConnectionStatusStore.js'

export function useAiConfigSessionStatus(deps = {}) {
  const sessionTestStatusById = deps.sessionTestStatusById || ref({})
  const getConnectionStatusStore = deps.getConnectionStatusStore
  const setConnectionStatusStore = deps.setConnectionStatusStore
  let connectionStatusScopeAbortController = null
  const connectionStatusStore = {
    invalidateAll() {
      getConnectionStatusStore()?.invalidateAll()
    },
  }

  async function initializeConnectionStatusStore() {
    connectionStatusScopeAbortController?.abort()
    const controller = new AbortController()
    connectionStatusScopeAbortController = controller
    const scope = await resolveAiConfigConnectionStatusScope({
      fallbackScope: import.meta.env.VITE_LOCALMINIDRAMA_INSTANCE_ID || '',
      signal: controller.signal,
    })
    if (controller.signal.aborted) return
    setConnectionStatusStore(createAiConfigConnectionStatusStore({ scope }))
  }

  function invalidateConnectionTestResults() {
    connectionStatusStore.invalidateAll()
    sessionTestStatusById.value = {}
  }

  function abortConnectionStatusScopeRequest() {
    connectionStatusScopeAbortController?.abort()
    connectionStatusScopeAbortController = null
  }

  return {
    sessionTestStatusById,
    initializeConnectionStatusStore,
    invalidateConnectionTestResults,
    abortConnectionStatusScopeRequest,
  }
}
