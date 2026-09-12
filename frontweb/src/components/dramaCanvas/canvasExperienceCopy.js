/** 画布空态下一步和用户可见错误文案，避免英文技术原文漏到界面。 */
const TECH_ERROR_RE = /(Internal Server Error|Failed to fetch|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|TypeError|ReferenceError|timeout of \d+ms)/i

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

export function toCanvasChineseMessage(message, fallback = '操作失败，请稍后重试') {
  const text = String(message || '').trim()
  const safeFallback = String(fallback || '').trim() || '操作失败，请稍后重试'
  if (!text) return safeFallback
  if (hasChinese(text) && !TECH_ERROR_RE.test(text)) return text
  return safeFallback
}

export function getCanvasEpisodeEmptyNextCopy(episode) {
  if (!episode) return ''
  const hasScript = Boolean(String(episode.script_content || '').trim())
  const storyboardCount = Array.isArray(episode.storyboards) ? episode.storyboards.length : 0
  if (hasScript && storyboardCount > 0) return ''
  if (!hasScript && storyboardCount === 0) return '这一集还是空的，下一步可先写剧本或新建分镜'
  if (!hasScript) return '还没有剧本，下一步可先编辑剧本'
  return '还没有分镜，下一步可新建分镜或用 AI 生成分镜'
}
