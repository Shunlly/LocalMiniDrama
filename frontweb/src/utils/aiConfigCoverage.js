export const AI_SERVICE_COVERAGE_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: 'text',
    label: '文本生成',
    description: '故事、剧本与提示词处理',
  }),
  Object.freeze({
    type: 'image',
    label: '素材图片',
    description: '角色、场景与道具图片',
  }),
  Object.freeze({
    type: 'storyboard_image',
    label: '分镜图片',
    description: '支持参考图的分镜画面',
  }),
  Object.freeze({
    type: 'video',
    label: '视频生成',
    description: '将分镜画面生成视频片段',
  }),
  Object.freeze({
    type: 'tts',
    label: '语音合成',
    description: '为分镜对白生成配音',
  }),
])

function isEnabled(config) {
  return config?.is_active !== false && config?.is_active !== 0
}

function isDefault(config) {
  return config?.is_default === true || config?.is_default === 1
}

function normalizeTestStatus(value) {
  const raw = typeof value === 'object' && value !== null
    ? value.status ?? value.result
    : value
  const normalized = String(raw ?? '').trim().toLowerCase()

  if (['passed', 'pass', 'success', 'succeeded', 'ok', 'healthy'].includes(normalized)) {
    return 'passed'
  }
  if (['failed', 'fail', 'failure', 'error', 'unhealthy'].includes(normalized)) {
    return 'failed'
  }
  return 'unknown'
}

function readTestedAt(value, config) {
  if (typeof value === 'object' && value !== null) {
    return value.tested_at ?? value.testedAt ?? value.updated_at ?? null
  }
  return config?.last_tested_at ?? config?.tested_at ?? null
}

function buildCoverageSummary(services) {
  return {
    readyCount: services.filter((service) => service.ready).length,
    configuredCount: services.filter((service) => service.configuredCount > 0).length,
    missingCount: services.filter((service) => service.state === 'missing').length,
    attentionCount: services.filter((service) => service.needsAttention).length,
    testPassedCount: services.filter((service) => service.test.status === 'passed').length,
    testFailedCount: services.filter((service) => service.test.status === 'failed').length,
    untestedCount: services.filter((service) => service.test.status === 'unknown').length,
  }
}

export function getConfigTestStatus(config, sessionTestStatusById = {}) {
  if (!config) {
    return { status: 'unknown', source: 'none', testedAt: null }
  }

  const sessionValue = sessionTestStatusById?.[config.id]
  const sessionStatus = normalizeTestStatus(sessionValue)
  if (sessionStatus !== 'unknown') {
    return {
      status: sessionStatus,
      source: 'session',
      testedAt: readTestedAt(sessionValue, config),
    }
  }

  const persistedValue = config.last_test_status
    ?? config.test_status
    ?? config.connection_status
  const persistedStatus = normalizeTestStatus(persistedValue)
  if (persistedStatus !== 'unknown') {
    return {
      status: persistedStatus,
      source: 'persisted',
      testedAt: readTestedAt(persistedValue, config),
    }
  }

  return { status: 'unknown', source: 'none', testedAt: null }
}

export function getAiServiceCoverageActions(service, options = {}) {
  const vendorLocked = !!options.vendorLocked
  const actions = []

  if (service.state === 'missing') {
    if (!vendorLocked) {
      actions.push({
        key: 'add',
        label: `添加${service.label}配置`,
        action: 'add',
        emphasis: 'primary',
      })
    }
    actions.push({
      key: 'view',
      label: '查看配置',
      action: 'view',
      emphasis: 'secondary',
    })
    return actions
  }

  if (!vendorLocked && service.issue === 'no_default') {
    actions.push({
      key: 'fix-default',
      label: service.targetConfig ? '补齐默认' : '添加默认',
      action: service.targetConfig ? 'edit' : 'add',
      emphasis: 'primary',
    })
  } else if (!vendorLocked && service.issue === 'inactive') {
    actions.push({
      key: 'activate',
      label: service.targetConfig ? '启用默认' : '添加配置',
      action: service.targetConfig ? 'edit' : 'add',
      emphasis: 'primary',
    })
  }

  actions.push({
    key: 'view',
    label: '查看配置',
    action: 'view',
    emphasis: actions.length ? 'secondary' : 'primary',
  })

  if (service.targetConfig) {
    actions.push({
      key: 'test',
      label: service.test.status === 'passed' ? '重新测试' : '立即测试',
      action: 'test',
      emphasis: 'secondary',
    })
  }

  return actions
}

export function buildAiServiceCoverage(configs = [], sessionTestStatusById = {}) {
  const source = Array.isArray(configs) ? configs : []
  const services = AI_SERVICE_COVERAGE_DEFINITIONS.map((definition) => {
    const serviceConfigs = source.filter((config) => config?.service_type === definition.type)
    const activeConfigs = serviceConfigs.filter(isEnabled)
    const defaultConfig = activeConfigs.find(isDefault) ?? null
    const targetConfig = defaultConfig ?? activeConfigs[0] ?? serviceConfigs[0] ?? null

    let state = 'missing'
    let issue = 'missing'
    if (serviceConfigs.length > 0) {
      state = defaultConfig ? 'default' : 'configured'
      issue = activeConfigs.length === 0 ? 'inactive' : (defaultConfig ? null : 'no_default')
    }

    return {
      ...definition,
      state,
      issue,
      ready: state === 'default',
      needsAttention: state !== 'default',
      configuredCount: serviceConfigs.length,
      activeCount: activeConfigs.length,
      defaultConfig,
      targetConfig,
      test: getConfigTestStatus(targetConfig, sessionTestStatusById),
    }
  })

  const summary = buildCoverageSummary(services)

  return {
    services,
    ...summary,
    totalCount: services.length,
    ready: summary.readyCount === services.length,
  }
}
