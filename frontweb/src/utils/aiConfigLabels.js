/**
 * AI 配置页用户可见标签。不发真实厂商请求。
 */
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
