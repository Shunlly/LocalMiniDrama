import { resolveProjectEpisodeId } from './projectListRoute.js'

export function hasProjectEpisodes(project) {
  return resolveProjectEpisodeId(project?.episodes) != null
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
    hash: '#source-intake-workflow',
  }
}
