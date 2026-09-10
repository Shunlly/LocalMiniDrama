/**
 * AI 配置导入导出。页面仍负责文件选择器接线和 loadList。
 */
import { ElMessage as defaultElMessage } from 'element-plus'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import { sanitizeConfigForExport, stripMaskedSecretsFromSettings } from '@/utils/aiConfigExport.js'
import { runAiConfigCreateBatch as defaultRunAiConfigCreateBatch } from '@/utils/aiConfigMutations.js'
import { isMaskedSecret } from '@/composables/useAiConfigUnsaved.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'
import { describeServiceLoadError } from '@/utils/requestError.js'

export function useAiConfigImportExport(deps = {}) {
  const ElMessage = deps.ElMessage || defaultElMessage
  const aiAPI = deps.aiAPI || defaultAiAPI
  const runAiConfigCreateBatch = deps.runAiConfigCreateBatch || defaultRunAiConfigCreateBatch
  const configWriteLocked = deps.configWriteLocked
  const importFileRef = deps.importFileRef
  const loadList = deps.loadList
  const list = deps.list
  const configLoadError = deps.configLoadError
  const invalidateConnectionTestResults = deps.invalidateConnectionTestResults
  const notifyConfigurationChanged = deps.notifyConfigurationChanged

  async function exportConfigs() {
    try {
      const configs = await aiAPI.list(undefined, { suppressErrorToast: true })
      const exportData = configs.map(sanitizeConfigForExport)
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-configs-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      ElMessage.success(`已导出 ${exportData.length} 条配置`)
    } catch (e) {
      ElMessage.error(describeServiceLoadError(e, { serviceLabel: 'AI 配置服务', fallback: '导出失败，请稍后重试。' }))
    }
  }

  function triggerImport() {
    if (configWriteLocked.value) return
    importFileRef.value?.click()
  }

  async function importConfigs(event) {
    if (configWriteLocked.value) {
      event.target.value = ''
      return
    }
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const configs = JSON.parse(text)
      if (!Array.isArray(configs)) {
        ElMessage.error('文件格式不正确，需要 JSON 数组')
        return
      }
      const result = await runAiConfigCreateBatch(configs, (cfg) => {
        const models = Array.isArray(cfg.model) ? cfg.model : (cfg.model ? [cfg.model] : [])
        return aiAPI.create({
          service_type: cfg.service_type,
          name: cfg.name,
          provider: cfg.provider,
          api_protocol: cfg.api_protocol || null,
          base_url: cfg.base_url,
          api_key: isMaskedSecret(cfg.api_key) ? '' : (cfg.api_key || ''),
          endpoint: cfg.endpoint || null,
          query_endpoint: cfg.query_endpoint || null,
          model: models,
          default_model: cfg.default_model || null,
          priority: cfg.priority ?? 0,
          is_default: !!cfg.is_default,
          settings: stripMaskedSecretsFromSettings(cfg.settings) || null,
        })
      })
      const listConfirmed = await loadList()
      const createdIds = result.created.map((item) => Number(item?.id)).filter(Number.isFinite)
      const createdVisible = createdIds.length === result.success
        && createdIds.every((id) => list.value.some((item) => Number(item.id) === id))
      const message = `导入完成：${result.success} 条成功，${result.failed} 条失败`
      if (listConfirmed && (result.success === 0 || createdVisible)) {
        if (result.success > 0) {
          invalidateConnectionTestResults()
          notifyConfigurationChanged()
          ElMessage.success(message)
        }
        else ElMessage.error(message)
      } else if (result.success > 0) {
        const refreshError = configLoadError.value
        const unconfirmedMessage = '配置已导入但列表未确认，请勿重复导入。请点击“重试”刷新列表。'
        configLoadError.value = refreshError ? `${unconfirmedMessage} ${refreshError}` : unconfirmedMessage
        ElMessage.error(unconfirmedMessage)
      } else {
        ElMessage.error(message)
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '导入失败'))
    } finally {
      event.target.value = ''
    }
  }

  return {
    exportConfigs,
    triggerImport,
    importConfigs,
  }
}
