export function projectCardDestination(project, sourceImportIntent, returnTo) {
  const id = Number(project?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  if (sourceImportIntent) {
    return {
      name: 'drama-detail',
      params: { id },
      query: {
        intake: 'source-url',
        returnTo,
      },
      hash: '#source-intake-workflow',
    }
  }
  return {
    name: 'film',
    params: { id },
    query: { returnTo },
  }
}
