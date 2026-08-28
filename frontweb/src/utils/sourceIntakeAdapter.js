export const SOURCE_TYPE_OPTIONS = [
  { label: '小说', value: 'novel' },
  { label: '梗概', value: 'outline' },
  { label: '剧本', value: 'script' },
  { label: '分镜', value: 'storyboard' },
  { label: '漫画', value: 'comic' },
  { label: '转写', value: 'transcript' },
]

export function normalizeSourceType(value) {
  const raw = String(value || '').trim().toLowerCase()
  return SOURCE_TYPE_OPTIONS.some((item) => item.value === raw) ? raw : ''
}

export function sourceTypeLabel(value) {
  const normalized = normalizeSourceType(value)
  if (!String(value || '').trim()) return '自动识别'
  return SOURCE_TYPE_OPTIONS.find((item) => item.value === normalized)?.label || '其他素材'
}

export function sourceProvenanceLabel(source) {
  const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {}
  if (metadata.imported_from === 'source_intake_url') {
    try {
      const hostname = new URL(String(metadata.source_url || '')).hostname
      return hostname ? `网页 · ${hostname}` : '网页'
    } catch {
      return '网页'
    }
  }
  if (metadata.imported_from === 'source_intake_upload') return '本地文件'
  if (metadata.imported_from === 'source_intake_panel') return '粘贴文本'
  return ''
}

const SOURCE_RELATION_LABELS = Object.freeze({
  next: '顺承',
  cause: '因果',
  conflict: '冲突',
  reveal: '揭示',
  hook: '悬念',
})

export function sourceRelationLabel(value) {
  return SOURCE_RELATION_LABELS[String(value || '').trim().toLowerCase()] || '事件关系'
}

export function inferSourceTypeFromFilename(filename) {
  const name = String(filename || '').toLowerCase()
  if (!name) return ''
  if (/\.(srt|vtt|ass)$/.test(name) || /transcript|字幕|转写|caption|subtitle/.test(name)) return 'transcript'
  if (/storyboard|shot|分镜|镜头/.test(name)) return 'storyboard'
  if (/script|剧本|screenplay/.test(name)) return 'script'
  if (/comic|漫画|panel/.test(name)) return 'comic'
  if (/outline|synopsis|梗概|大纲/.test(name)) return 'outline'
  if (/\.(csv|tsv)$/.test(name)) return 'storyboard'
  if (/\.(txt|md)$/.test(name) || /novel|小说|chapter|章节/.test(name)) return 'novel'
  return ''
}

export function buildSourceIntakePayload(form, drama) {
  const dramaMeta = drama?.metadata || {}
  const payload = {
    title: String(form?.title || '').trim(),
    source_type: normalizeSourceType(form?.source_type),
    text: String(form?.text || '').trim(),
    target_episode_count: Math.max(1, Math.floor(Number(form?.target_episode_count) || Number(drama?.total_episodes) || 1)),
    style: form?.style || drama?.style || '',
    metadata: {
      aspect_ratio: dramaMeta.aspect_ratio || '16:9',
      imported_from: 'source_intake_panel',
    },
  }
  if (!payload.title) payload.title = drama?.title ? `${drama.title} 素材` : '故事素材'
  return payload
}

export function buildWebSourceIntakePayload(form, drama) {
  const payload = buildSourceIntakePayload({ ...form, text: '' }, drama)
  const automaticTitle = drama?.title ? `${drama.title} 素材` : '故事素材'
  if (payload.title === automaticTitle) delete payload.title
  payload.source_url = String(form?.source_url || '').trim()
  return payload
}

export function buildSourceUploadFormData(form, drama, file) {
  const payload = buildSourceIntakePayload({ ...form, text: '' }, drama)
  const data = new FormData()
  data.append('file', file)
  data.append('title', payload.title)
  data.append('source_type', payload.source_type || inferSourceTypeFromFilename(file?.name) || '')
  data.append('target_episode_count', String(payload.target_episode_count))
  data.append('style', payload.style || '')
  data.append('metadata', JSON.stringify(payload.metadata || {}))
  return data
}
