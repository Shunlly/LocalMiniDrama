export function projectCardDestination(project, sourceImportIntent, returnTo) {
  const id = Number(project?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  if (sourceImportIntent) {
    return newProjectDestination(project, sourceImportIntent, returnTo)
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
