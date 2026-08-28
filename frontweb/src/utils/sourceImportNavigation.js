export function hasProjectEpisodes(project) {
  return Array.isArray(project?.episodes) && project.episodes.length > 0
}

export function projectCardDestination(project, sourceImportIntent, returnTo) {
  const id = Number(project?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  if (sourceImportIntent) {
    return newProjectDestination(project, sourceImportIntent, returnTo)
  }
  if (!hasProjectEpisodes(project)) {
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
    query: { returnTo },
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
