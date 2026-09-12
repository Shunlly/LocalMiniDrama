export function formatJimeng2AssetCreatedAt(value) {
  const timestamp = Date.parse(String(value ?? ''))
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
