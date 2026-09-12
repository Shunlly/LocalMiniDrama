/**
 * AI 配置页「服务能力卡片」的展示与点击逻辑。
 * 覆盖率数据计算仍在 aiConfigCoverage.js，这里只处理卡片文案、焦点和动作分发。
 */
import { nextTick as vueNextTick, ref } from 'vue'
import { getAiServiceCoverageActions } from '@/utils/aiConfigCoverage.js'

export function coverageStateLabel(item) {
  if (item.ready) return '可用'
  if (item.issue === 'missing_credentials') return '缺少凭据'
  if (item.issue === 'missing_model') return '缺少模型'
  if (item.issue === 'missing_workflow') return '缺少工作流'
  if (item.issue === 'connection_failed') return '连接失败'
  if (item.issue === 'inactive') return '未启用'
  if (item.state === 'configured') return '缺少默认'
  return '未配置'
}

export function coverageStateTagType(item) {
  if (item.ready) return 'success'
  if (item.state === 'configured') return 'warning'
  return 'danger'
}

export function coverageConfigDetail(item) {
  if (item.state === 'missing') return '尚无配置'
  if (item.issue === 'inactive') return `${item.configuredCount} 个配置，均未启用`
  if (!item.defaultConfig) return `${item.activeCount} 个启用配置，请设置默认项`
  if (item.issue === 'missing_credentials') return '默认配置缺少凭据'
  if (item.issue === 'missing_model') return '默认配置缺少模型'
  if (item.issue === 'missing_workflow') return '默认配置缺少工作流'
  if (item.issue === 'connection_failed') return '默认配置最近连接失败'
  const config = item.defaultConfig
  const model = config.default_model || (Array.isArray(config.model) ? config.model[0] : config.model)
  const identity = config.name || config.provider || '默认配置'
  return model ? `${identity} · ${model}` : identity
}

export function coverageInventoryLabel(item) {
  if (item.state === 'missing') return '未配置'
  const active = item.activeCount ? `启用 ${item.activeCount}` : '启用 0'
  return `已配置 ${item.configuredCount} 条 · ${active}`
}

export function coverageTestLabel(test) {
  if (test.status === 'passed') return test.source === 'session' ? '本次测试通过' : '最近测试通过'
  if (test.status === 'failed') return test.source === 'session' ? '本次测试失败' : '最近测试失败'
  return '尚无测试记录'
}

export function useAiConfigCoverage(deps = {}) {
  const {
    vendorLock,
    configWriteLocked,
    testingConfigId,
    canAutoOpenMissingService,
    configWorkspaceView,
    activeServiceFilter,
    serviceCoverage,
    coverageWorkspaceModeRef,
    configListSectionRef,
    selectConfigWorkspaceView,
    normalizeInitialServiceType,
    openAddForService,
    openEdit,
    openTest,
    abortConnectionTest,
  } = deps
  const nextTick = deps.nextTick || vueNextTick
  const coverageCardRefs = deps.coverageCardRefs || new Map()
  const lastTestedCoverageServiceType = deps.lastTestedCoverageServiceType || ref('')

  function coverageActions(item) {
    return getAiServiceCoverageActions(item, {
      vendorLocked: vendorLock.value.enabled,
      writesLocked: configWriteLocked.value,
    })
  }

  function setCoverageCardRef(serviceType, element) {
    if (element) coverageCardRefs.set(serviceType, element)
    else coverageCardRefs.delete(serviceType)
  }

  async function restoreTestedCoverageCardFocus() {
    abortConnectionTest?.()
    const serviceType = lastTestedCoverageServiceType.value
    lastTestedCoverageServiceType.value = ''
    if (!serviceType) return
    await nextTick()
    const target = coverageCardRefs.get(serviceType)
    if (target) target.focus()
    else coverageWorkspaceModeRef.value?.focus?.()
  }

  function isCoverageActionTesting(item, action) {
    if (action.action !== 'test' || testingConfigId.value === null) return false
    return String(testingConfigId.value) === String(item.targetConfig?.id)
  }

  function isCoverageActionDisabled(item, action) {
    if (['add', 'edit'].includes(action.action)) return configWriteLocked.value
    if (action.action !== 'test') return false
    return isCoverageActionTesting(item, action) || testingConfigId.value !== null
  }

  async function focusServiceConfigs(serviceType, { focusMode = false } = {}) {
    selectConfigWorkspaceView('configs', { focus: focusMode })
    activeServiceFilter.value = serviceType
    await nextTick()
    configListSectionRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }

  async function applyRequestedService(serviceType) {
    const normalized = normalizeInitialServiceType(serviceType)
    if (normalized) configWorkspaceView.value = 'configs'
    activeServiceFilter.value = normalized
    if (!normalized) return
    const coverageItem = serviceCoverage.value.services.find((item) => item.type === normalized)
    if (shouldAutoOpenRequestedService(coverageItem)) {
      openAddForService(normalized)
      return
    }
    if (coverageItem?.targetConfig && !coverageItem.ready && !configWriteLocked.value) {
      await openEdit(coverageItem.targetConfig, { repairIssue: coverageItem.issue })
      return
    }
    await focusServiceConfigs(normalized)
  }

  async function onCoverageSelect(item) {
    if (shouldAutoOpenRequestedService(item)) {
      openAddForService(item.type)
      return
    }
    await focusServiceConfigs(item.type, { focusMode: true })
  }

  function shouldAutoOpenRequestedService(coverageItem) {
    return (
      canAutoOpenMissingService.value
      && coverageItem?.state === 'missing'
      && !vendorLock.value.enabled
    )
  }

  async function onCoverageAction(item, action) {
    if (configWriteLocked.value && ['add', 'edit'].includes(action.action)) return
    if (action.action === 'add') {
      openAddForService(item.type)
      return
    }
    if (action.action === 'edit') {
      if (item.targetConfig) {
        await openEdit(item.targetConfig, { repairIssue: item.issue })
      } else {
        openAddForService(item.type)
      }
      return
    }
    if (action.action === 'test') {
      if (item.targetConfig) {
        lastTestedCoverageServiceType.value = item.type
        await openTest(item.targetConfig)
      }
      return
    }
    await focusServiceConfigs(item.type, { focusMode: true })
  }

  return {
    coverageStateLabel,
    coverageStateTagType,
    coverageConfigDetail,
    coverageInventoryLabel,
    coverageTestLabel,
    coverageActions,
    setCoverageCardRef,
    restoreTestedCoverageCardFocus,
    isCoverageActionTesting,
    isCoverageActionDisabled,
    focusServiceConfigs,
    applyRequestedService,
    onCoverageSelect,
    shouldAutoOpenRequestedService,
    onCoverageAction,
  }
}
