/** 项目列表展示格式化，以及导入失败信息清洗。 */
import { getProjectCover } from '@/utils/projectList.js'
import { toUserFacingError } from '@/utils/userFacingError.js'

export function projectSearchText(drama) {
  return [
    drama?.title,
    drama?.description,
    formatStatus(drama?.status),
    formatStyle(drama?.style),
    formatGenre(drama?.genre),
    drama?.metadata?.aspect_ratio,
  ].filter(Boolean).join(' ').toLowerCase()
}

export function projectCoverUrl(drama, coverErrors) {
  const id = String(drama?.id ?? '')
  if (coverErrors?.has(id)) return ''
  return getProjectCover(drama)?.url || ''
}

export function formatDate(val) {
  if (!val) return ''
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function resolveChineseLabel(value, map, emptyFallback, unknownFallback) {
  const key = String(value || '').trim()
  if (!key) return emptyFallback
  if (map[key]) return map[key]
  return /[\u4e00-\u9fff]/.test(key) ? key : unknownFallback
}

export function formatStatus(status) {
  return resolveChineseLabel(status, {
    draft: '草稿',
    published: '已发布',
    archived: '已归档',
    generating: '生成中',
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
  }, '草稿', '未知状态')
}

export function formatStyle(style) {
  const map = {
    // 写实 / 影视
    realistic: '写实',
    cinematic: '电影感',
    documentary: '纪录片',
    noir: '黑色电影',
    'retro film': '复古胶片',
    horror: '恐怖',
    // 动漫 / 卡通
    'anime style': '日本动漫',
    anime: '日本动漫',
    'comic style': '欧美漫画',
    cartoon: '卡通',
    // 中国风格
    'ink wash': '国画水墨',
    'chinese style': '中国风',
    historical: '古装',
    wuxia: '武侠',
    // 绘画艺术
    watercolor: '水彩',
    'oil painting': '油画',
    sketch: '素描',
    'woodblock print': '版画',
    impressionist: '印象派',
    // 幻想 / 科幻
    fantasy: '奇幻',
    'dark fantasy': '暗黑奇幻',
    'sci-fi': '科幻',
    sci_fi: '科幻',
    cyberpunk: '赛博朋克',
    steampunk: '蒸汽朋克',
    'post-apocalyptic': '末世废土',
    // 数字 / 现代
    '3d render': '3D渲染',
    'pixel art': '像素风',
    'low poly': '低多边形',
    minimalist: '极简',
    dreamy: '唯美梦幻',
  }
  return resolveChineseLabel(style, map, '', '未知风格')
}

export function formatGenre(genre) {
  const map = { drama: '剧情', comedy: '喜剧', adventure: '冒险', romance: '爱情', thriller: '悬疑', action: '动作', horror: '恐怖' }
  return resolveChineseLabel(genre, map, '', '未知类型')
}

export function totalStoryboards(d) {
  return (d.episodes || []).reduce((sum, ep) => sum + (ep.storyboards?.length || 0), 0)
}

export function countProjectEpisodes(project) {
  const episodes = Array.isArray(project?.episodes) ? project.episodes : []
  return episodes.filter((episode) => {
    const id = Number(episode?.id)
    return Number.isInteger(id) && id > 0
  }).length
}

export function normalizeImportFailureFilename(name) {
  let fileName = String(name || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  if (!fileName) fileName = '未命名项目包'
  return fileName
}

export function sanitizeImportFailureReason(message) {
  const collapsed = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return '项目包导入失败，请重新选择项目包后重试'

  const redacted = collapsed
    .replace(/file:\/\/\/\S+/gi, '本地文件')
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '本地文件')
    .replace(/\/(?:[^/\s]+\/)+[^/\s]*/g, '服务器文件')
    .replace(/\bHTTP\s*\d{3}\b/gi, '')
    .replace(/request failed with status code \d+/gi, '')
    .replace(/\b(?:ECONNABORTED|ERR_NETWORK|ERR_CANCELED|ERR_FAILED|ETIMEDOUT|ECONNREFUSED)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (/(traceback|stack|sqlite|sqlstate|sql\b|errno|exception|node_modules|backend-node|frontweb| at [A-Za-z_$][\w$]*\s*\()/i.test(redacted)) {
    return '项目包解析失败，请确认文件完整且与当前版本兼容'
  }

  return redacted.slice(0, 160) || '项目包导入失败，请重新选择项目包后重试'
}

export function resolveImportFailureMessage(error) {
  const fallback = '项目包导入失败，请重新选择项目包后重试'
  const responseBody = error?.response?.data
  if (typeof responseBody === 'string' && responseBody.trim()) {
    return toUserFacingError({ message: sanitizeImportFailureReason(responseBody) }, fallback)
  }
  if (responseBody && typeof responseBody === 'object') {
    const responseMessage = responseBody?.error?.message
      || responseBody?.message
      || (typeof responseBody?.error === 'string' ? responseBody.error : '')
    if (responseMessage) return toUserFacingError({ message: sanitizeImportFailureReason(responseMessage) }, fallback)
  }
  return toUserFacingError({ message: sanitizeImportFailureReason(error?.message) }, fallback)
}

export function projectCoverAlt(drama) {
  const title = drama?.title || '未命名项目'
  return `项目「${title}」画面预览`
}

export function truncateProjectTitle(title, maxLength = 20) {
  const text = String(title || '未命名')
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

export function projectListCountLabel({ total, page, pageSize, filteredCount, hasFilters }) {
  const projectTotal = Number(total) || 0
  const currentPage = Math.max(1, Number(page) || 1)
  const currentPageSize = Math.max(1, Number(pageSize) || 24)
  if (projectTotal === 0) return hasFilters ? '0 个项目' : '暂无项目'
  if (projectTotal <= currentPageSize) return `${Number(filteredCount) || 0} / ${projectTotal} 个项目`
  const start = (currentPage - 1) * currentPageSize + 1
  const end = Math.min(projectTotal, start + currentPageSize - 1)
  return `${start}-${end} / ${projectTotal} 个项目`
}

export function describeListWriteLockReason({ loading, listError, isStale, hasSuccessfulListLoad }) {
  if (loading) return '项目列表正在加载，请稍候'
  if (listError) {
    return isStale
      ? '项目列表刷新失败，成功重试前不能新增或导入'
      : '项目数据加载失败，成功重试前不能新增或导入'
  }
  if (!hasSuccessfulListLoad) return '项目列表尚未就绪'
  return ''
}

export function describeProjectFormSubmitDisabledReason({ writeLocked, writeLockReason, title }) {
  if (writeLocked) return writeLockReason || ''
  if (!String(title || '').trim()) return '请先填写项目标题'
  return ''
}

export const FILM_LIST_LEAVE_CONFIRM_TITLE = '确认离开？'
export const FILM_LIST_LEAVE_CONFIRM_BUTTON_TEXT = '离开'
export const FILM_LIST_LEAVE_STAY_BUTTON_TEXT = '继续留在本页'

export function describePendingProjectPackageWork({ importing, importingExample, exportingId }) {
  if (importing || importingExample) return '项目包正在导入，请完成后再离开。'
  if (exportingId !== null && exportingId !== undefined) return '项目包正在导出，请完成后再离开。'
  return ''
}

export function describeTrashLiveStatus({ announcement, loading, total }) {
  if (announcement) return announcement
  if (loading) return '正在加载回收站'
  return `回收站中共有 ${Number(total) || 0} 个项目`
}

export function describeTrashRestoreBusyReason(restoringId, itemId) {
  return restoringId !== null && restoringId !== itemId ? '正在恢复其他项目，请稍候' : ''
}

export function describeTrashRestoreAnnouncement(title) {
  return `项目「${title || '未命名项目'}」已恢复，内容与关联素材保持不变。`
}
