/**
 * AI 配置表单校验规则。页面仍负责提交和 loadList/openTest。
 */
import { computed } from 'vue'
import { hidesApiProtocolField } from '@/utils/aiConfigLabels.js'
import { parseModelText } from '@/utils/aiConfigDiscoverModels.js'
import { parseComfyWorkflowJson } from '@/utils/aiConfigFormSettings.js'
import { isApiKeyOptionalProvider, providerConfigs } from '@/utils/aiProviderPresets.js'
import { DEFAULT_MODEL_VALIDATION_MESSAGE } from '@/composables/useAiConfigUnsaved.js'

export function createAiConfigDefaultModelRules(isDefaultModelSelectionValid) {
  return [
    {
      validator: (_rule, value, cb) => {
        if (isDefaultModelSelectionValid(value)) return cb()
        cb(new Error(DEFAULT_MODEL_VALIDATION_MESSAGE))
      },
      trigger: 'change',
    },
  ]
}

export function buildAiConfigFormRules(form, {
  isComfyUi = false,
  defaultModelRules,
} = {}) {
  return {
    service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
    name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
    provider: [{ required: true, message: '请选择或输入厂商', trigger: 'change' }],
    base_url: [{ required: true, message: '请输入接口地址（Base URL）', trigger: 'blur' }],
    api_key: [
      {
        validator: (_rule, v, cb) => {
          const st = form.service_type
          if (st === 'jimeng2_character_auth') {
            if (v != null && String(v).trim()) return cb()
            return cb(new Error('请填写令牌（Token）'))
          }
          const proto = form.api_protocol
          if (isApiKeyOptionalProvider(form.provider, proto)) return cb()
          const ak = (form.kling_access_key || '').trim()
          const sk = (form.kling_secret_key || '').trim()
          if (st === 'video' && proto === 'kling_omni' && ak && sk) return cb()
          if (v != null && String(v).trim()) return cb()
          cb(new Error('请输入 API 密钥，或使用官方 AccessKey + SecretKey（可不填 API 密钥）'))
        },
        trigger: 'blur',
      },
    ],
    api_protocol: [
      {
        validator: (_rule, value, cb) => {
          const st = form.service_type
          const protocolVisible = !hidesApiProtocolField(st)
          const presetProvider = (providerConfigs[st] || []).some((item) => item.id === form.provider)
          if (!protocolVisible || presetProvider || String(value || '').trim()) return cb()
          cb(new Error('自定义厂商请选择接口规范'))
        },
        trigger: 'change',
      },
    ],
    endpoint: [
      {
        validator: (_rule, value, cb) => {
          const st = form.service_type
          const presetProvider = (providerConfigs[st] || []).some((item) => item.id === form.provider)
          if (st !== 'video' || presetProvider || String(value || '').trim()) return cb()
          cb(new Error('自定义视频厂商请输入提交端点'))
        },
        trigger: 'blur',
      },
    ],
    modelText: [
      {
        validator: (_rule, value, cb) => {
          if (form.service_type === 'jimeng2_character_auth' || isComfyUi || parseModelText(value).length > 0) return cb()
          cb(new Error('请填写至少一个模型'))
        },
        trigger: 'blur',
      },
    ],
    default_model: defaultModelRules,
    comfy_workflow_json: [
      {
        validator: (_rule, value, cb) => {
          if (!isComfyUi) return cb()
          try {
            parseComfyWorkflowJson(value)
            cb()
          } catch (error) {
            cb(error)
          }
        },
        trigger: 'blur',
      },
    ],
  }
}

export function useAiConfigFormRules(deps = {}) {
  const form = deps.form
  const isComfyUiForm = deps.isComfyUiForm
  const isDefaultModelSelectionValid = deps.isDefaultModelSelectionValid
  const defaultModelRules = deps.defaultModelRules || createAiConfigDefaultModelRules(isDefaultModelSelectionValid)
  const rules = computed(() => buildAiConfigFormRules(form.value, {
    isComfyUi: Boolean(isComfyUiForm?.value),
    defaultModelRules,
  }))
  return {
    defaultModelRules,
    rules,
  }
}
