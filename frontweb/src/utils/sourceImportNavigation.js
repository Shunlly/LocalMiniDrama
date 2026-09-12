import { resolveProjectEpisodeId } from './projectListRoute.js'

export function hasProjectEpisodes(project) {
  return resolveProjectEpisodeId(project?.episodes) != null
}

export function projectCardContinueLabel(project, sourceImportIntent) {
  if (sourceImportIntent) return '导入网页 URL'
  return hasProjectEpisodes(project) ? '继续制作' : '去创建剧集'
}

export function projectCardOpenLabel(project) {
  const title = project?.title || '未命名项目'
  return `打开项目「${title}」`
}

export function projectCardDescribedById(project) {
  const id = project?.id
  if (id == null || id === '') return ''
  return `project-card-next-${id}`
}

export function projectCardNextStepText(project, sourceImportIntent) {
  return `下一步：${projectCardContinueLabel(project, sourceImportIntent)}`
}

export function projectCardDestination(project, sourceImportIntent, returnTo) {
  const id = Number(project?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  if (sourceImportIntent) {
    return newProjectDestination(project, sourceImportIntent, returnTo)
  }
  const episodeId = resolveProjectEpisodeId(project?.episodes)
  if (!episodeId) {
    return {
      name: 'drama-detail',
      params: { id },
      query: { returnTo },
      hash: '#episode-list',
    }
  }
  return {
    name: 'film',
    params: { id },
    query: { returnTo, episode: String(episodeId) },
  }
}

export function newProjectDestination(project, sourceImportIntent, returnTo) {
  const id = Number(project?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    name: 'drama-detail',
    params: { id },
    query: sourceImportIntent
      ? { intake: 'source-url', returnTo }
      : { returnTo },
    hash: sourceImportIntent ? '#source-intake-workflow' : '#episode-list',
  }
}
