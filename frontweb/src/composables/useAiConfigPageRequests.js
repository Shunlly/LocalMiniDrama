/**
 * AI 配置页请求取消与依赖重试。retryConfigDependencies 仍调用页面 loadList。
 */
export function useAiConfigPageRequests(deps = {}) {
  const abortVendorLockRequest = deps.abortVendorLockRequest
  const abortGenerationSettingsRequest = deps.abortGenerationSettingsRequest
  const abortDiscoverModelsRequest = deps.abortDiscoverModelsRequest
  const abortConfigListRequest = deps.abortConfigListRequest
  const abortConnectionTestRequest = deps.abortConnectionTestRequest
  const abortConnectionStatusScopeRequest = deps.abortConnectionStatusScopeRequest
  const loadVendorLock = deps.loadVendorLock
  const loadList = deps.loadList
  const testingConfigId = deps.testingConfigId
  const openTest = deps.openTest
  const getLastTestedConfig = deps.getLastTestedConfig

  function abortAiConfigPageRequests() {
    abortConfigListRequest()
    abortVendorLockRequest()
    abortGenerationSettingsRequest()
    abortConnectionTestRequest()
    abortConnectionStatusScopeRequest()
    abortDiscoverModelsRequest()
  }

  function retryConnectionTest() {
    const lastTestedConfig = getLastTestedConfig()
    if (!lastTestedConfig || testingConfigId.value !== null) return
    openTest(lastTestedConfig)
  }

  async function retryConfigDependencies() {
    await Promise.all([loadVendorLock(), loadList()])
  }

  return {
    abortAiConfigPageRequests,
    retryConnectionTest,
    retryConfigDependencies,
  }
}
