/**
 * AI 配置页用户可见标签。不发真实厂商请求。
 */
import { isSafeUserFacingMessage } from '@/utils/requestError.js'

export function hidesApiProtocolField(serviceType) {
  return ['text', 'tts', 'ocr', 'transcription', 'jimeng2_character_auth'].includes(String(serviceType || ''))
}

export function serviceTypeLabel(t) {
  const map = {
    text: '文本',
    image: '文本生成图片',
    storyboard_image: '分镜图片生成',
    video: '视频',
    tts: '语音合成 TTS',
    ocr: '图片识别 OCR',
    transcription: '语音转写',
    jimeng2_character_auth: '即梦2角色认证',
    model_ark_asset: '认证资产库',
  }
  return map[t] || t
}

export function configFieldDisplayLabel(label) {
  const map = {
    'API Key': 'API 密钥',
    'Base URL': '接口地址（Base URL）',
    'Workflow JSON': '工作流 JSON',
  }
  return map[label] || label
}

export function jimeng2AssetTypeLabel(type) {
  const map = {
    image: '图片',
    video: '视频',
    audio: '音频',
    Image: '图片',
    Video: '视频',
    Audio: '音频',
  }
  const raw = String(type || '').trim()
  return map[raw] || raw || '—'
}

export function jimeng2AssetStatusLabel(status) {
  const map = {
    active: '可用',
    failed: '失败',
    pending: '处理中',
    processing: '处理中',
    inactive: '未启用',
  }
  const raw = String(status || '').trim()
  return map[raw] || raw || '—'
}

export function configActionLabel(action, row) {
  const name = String(row?.name || '').trim() || '未命名配置'
  return `${action}「${name}」`
}

export function describeAiConfigSaveSuccess(wasEditing, serviceType) {
  const verb = wasEditing ? '已保存' : '已添加'
  const type = String(serviceType || '')
  if (type === 'jimeng2_character_auth') {
    return verb + '「即梦2角色认证」配置，请到创作页的角色面板验证认证资产。'
  }
  if (type === 'model_ark_asset') {
    return verb + '「认证资产库」配置，请到认证资产管理标签页继续操作。'
  }
  const label = serviceTypeLabel(type)
  if (label && label !== type) {
    return verb + '「' + label + '」配置，可在列表中测试连接。'
  }
  return verb + '配置，可在列表中测试连接。'
}

export function describeAiConfigBulkKeySuccess(result) {
  const message = String(result?.message || '').trim()
  if (isSafeUserFacingMessage(message)) return message
  const updated = Number(result?.updated)
  if (Number.isInteger(updated) && updated > 0) return '已更新 ' + updated + ' 条配置的密钥'
  return '所有配置的 API 密钥已更新'
}


export function describeDisabledControlLabel(defaultLabel, {
  disabled = false,
  reason = '',
  loading = false,
  loadingLabel = '',
} = {}) {
  if (loading) return loadingLabel || defaultLabel
  const text = String(reason || '').trim()
  if (disabled && text) return text
  return defaultLabel
}
