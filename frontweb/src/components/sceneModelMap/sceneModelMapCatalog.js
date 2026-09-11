/** 场景模型映射的场景键目录、可用性装饰和写锁文案。 */

export const SCENE_MODEL_PREDEFINED_KEYS = [
  { value: 'image_polish', label: '分镜图提示词润色', service_type: 'text' },
  { value: 'role_image_polish', label: '角色图提示词润色', service_type: 'text' },
  { value: 'prop_image_polish', label: '道具图提示词润色', service_type: 'text' },
  { value: 'scene_image_polish', label: '场景图提示词润色', service_type: 'text' },
  { value: 'role_extraction', label: '角色提取', service_type: 'text' },
  { value: 'prop_extraction', label: '道具提取', service_type: 'text' },
  { value: 'scene_extraction', label: '场景提取', service_type: 'text' },
  { value: 'storyboard_extraction', label: '分镜生成', service_type: 'text' },
  { value: 'identity_anchors', label: '角色视觉锚点提炼', service_type: 'text' },
  { value: 'frame_prompt', label: '帧提示词生成', service_type: 'text' },
  { value: 'novel_import', label: '小说导入改写', service_type: 'text' },
  { value: 'story_generation', label: '故事生成', service_type: 'text' },
]

const SERVICE_TYPE_LABELS = {
  text: '文本/对话',
  image: '文本生成图片',
  storyboard_image: '分镜图片生成',
  video: '视频生成',
  tts: '语音合成 TTS',
}

const SERVICE_TYPE_TAG_TYPES = {
  text: 'primary',
  image: 'success',
  storyboard_image: 'warning',
  video: 'danger',
  tts: 'info',
}

export const SCENE_MODEL_EMPTY_DESCRIPTION = '暂无场景模型映射配置'

export function createEmptySceneModelForm() {
  return {
    key: '',
    description: '',
    service_type: 'text',
    config_id: null,
    model_override: '',
  }
}

export function formFromMapRow(row) {
  return {
    key: row?.key || '',
    description: row?.description || '',
    service_type: row?.service_type || 'text',
    config_id: row?.config_id || null,
    model_override: row?.model_override || '',
  }
}

export function isWriteLocked({ loading, loadError, hasSuccessfulLoad }) {
  return Boolean(loading || !hasSuccessfulLoad || loadError)
}

export function describeWriteLockReason({ loading, loadError, hasSuccessfulLoad }) {
  if (loading) return '场景模型映射正在加载，请稍候'
  if (loadError) {
    return hasSuccessfulLoad
      ? '场景模型映射刷新失败，成功重试前不能修改'
      : '场景模型映射加载失败，成功重试前不能添加'
  }
  if (!hasSuccessfulLoad) return '场景模型映射尚未就绪'
  return ''
}

export function serviceTypeLabel(type) {
  return SERVICE_TYPE_LABELS[type] || type
}

export function serviceTypeTagType(type) {
  return SERVICE_TYPE_TAG_TYPES[type] || ''
}

export function getSceneKeyLabel(key, predefinedKeys = SCENE_MODEL_PREDEFINED_KEYS) {
  return predefinedKeys.find((item) => item.value === key)?.label || ''
}

export function configOptionLabel(item) {
  const base = `${item.name} (${item.provider})`
  return item.is_active ? base : `${base}（已停用）`
}

export function decorateMapRow(item, configs) {
  const list = Array.isArray(configs) ? configs : []
  const config = list.find((entry) => String(entry.id) === String(item?.config_id))
  return {
    ...item,
    config_name: config?.name || null,
    config_missing: Boolean(item?.config_id) && !config,
    config_inactive: Boolean(config) && !config.is_active,
    config_type_mismatch: Boolean(config && item?.service_type && config.service_type !== item.service_type),
  }
}

export function filterConfigsForService(configs, serviceType, selectedId) {
  return (Array.isArray(configs) ? configs : []).filter((item) => {
    if (item.service_type !== serviceType) return false
    if (item.is_active) return true
    return selectedId != null && String(item.id) === String(selectedId)
  })
}

export function describeModelOverrideDisabledReason(models, currentOverride) {
  if ((Array.isArray(models) && models.length) || String(currentOverride || '').trim()) return ''
  return '请先选择 AI 配置'
}

export function applySceneKeyChange(form, key, predefinedKeys = SCENE_MODEL_PREDEFINED_KEYS) {
  const matched = predefinedKeys.find((item) => item.value === key)
  return {
    ...form,
    key,
    service_type: matched?.service_type || form?.service_type || 'text',
    config_id: null,
    model_override: '',
  }
}
