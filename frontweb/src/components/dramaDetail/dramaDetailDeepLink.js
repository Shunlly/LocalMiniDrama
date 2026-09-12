/**
 * 剧集详情深链接恢复：识别无效锚点和已删除分集，给出中文下一步。
 */
import { normalizeDramaDetailHash } from '@/utils/routeValidation.js'

export const DRAMA_DETAIL_SECTION_IDS = Object.freeze([
  'source-intake-workflow',
  'episode-list',
  'project-resources',
])

export function firstDramaDetailQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

export function hasRequestedEpisode(queryEpisode) {
  const raw = firstDramaDetailQueryValue(queryEpisode)
  return raw != null && String(raw).trim() !== ''
}

export function requestedEpisodeExists(episodes, queryEpisode) {
  const requestedId = Number(firstDramaDetailQueryValue(queryEpisode))
  if (!Number.isSafeInteger(requestedId) || requestedId <= 0) return false
  return (Array.isArray(episodes) ? episodes : []).some((episode) => Number(episode?.id) === requestedId)
}

export function describeDramaDetailDeepLink({ hash, episodeQuery, episodes } = {}) {
  const currentHash = String(hash || '')
  const normalizedHash = currentHash ? normalizeDramaDetailHash(currentHash) : ''
  const invalidHash = Boolean(currentHash) && !normalizedHash
  const invalidEpisode = hasRequestedEpisode(episodeQuery) && !requestedEpisodeExists(episodes, episodeQuery)
  const emptyEpisodes = !Array.isArray(episodes) || episodes.length === 0

  if (invalidHash || invalidEpisode) {
    const message = invalidEpisode
      ? (emptyEpisodes
        ? '链接中的分集不存在或已删除。请先新增一集，或批量导入剧本。'
        : '链接中的分集不存在或已删除。请从分集列表选择要继续制作的一集。')
      : '链接中的位置无效，已打开项目详情。可从分集列表继续，或返回项目列表。'
    return {
      kind: invalidEpisode ? (invalidHash ? 'invalid-episode+hash' : 'invalid-episode') : 'invalid-hash',
      message,
      scrollTo: invalidEpisode ? 'episode-list' : '',
      dropHash: invalidHash,
      dropEpisode: invalidEpisode,
    }
  }

  if (normalizedHash) {
    return {
      kind: 'section',
      message: '',
      scrollTo: normalizedHash.replace(/^#/, ''),
      dropHash: false,
      dropEpisode: false,
    }
  }

  return null
}

export function stripDramaDetailDeepLinkQuery(query = {}, recovery = {}) {
  const nextQuery = { ...(query || {}) }
  if (recovery.dropEpisode) delete nextQuery.episode
  return nextQuery
}
