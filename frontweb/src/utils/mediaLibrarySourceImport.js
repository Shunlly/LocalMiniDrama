/**
 * 素材中心网页 URL 导入：在本页选定目标项目后进入该项目的素材流程。
 * 不要把人先踢回项目首页再选项目。
 */

export function normalizeMediaLibrarySourceImportProjectId(value) {
  const projectId = Number(value)
  return Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null
}

export function describeMediaLibrarySourceImportProjectAction(project) {
  const title = String(project?.title || '').trim() || '未命名项目'
  return `导入到项目「${title}」`
}

export function buildMediaLibrarySourceImportDestination({ projectId, returnTo } = {}) {
  const id = normalizeMediaLibrarySourceImportProjectId(projectId)
  if (!id) return null
  const query = { intake: 'source-url' }
  const safeReturnTo = typeof returnTo === 'string' ? returnTo.trim() : ''
  if (safeReturnTo) query.returnTo = safeReturnTo
  return {
    name: 'drama-detail',
    params: { id },
    query,
    hash: '#source-intake-workflow',
  }
}

export function normalizeMediaLibrarySourceImportProjects(payload = {}, requested = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const pagination = payload?.pagination && typeof payload.pagination === 'object'
    ? payload.pagination
    : {}
  const requestedPage = Math.max(1, Number(requested.page) || 1)
  const requestedPageSize = Math.max(1, Number(requested.pageSize) || 24)
  const pageSize = Math.max(1, Number(pagination.page_size ?? requestedPageSize) || requestedPageSize)
  const total = Math.max(0, Number(pagination.total ?? items.length) || 0)
  const lastPage = Math.max(1, Math.ceil(total / pageSize) || 1)
  const page = Math.min(Math.max(1, Number(pagination.page ?? requestedPage) || requestedPage), lastPage)
  return {
    items: items
      .map((item) => {
        const id = normalizeMediaLibrarySourceImportProjectId(item?.id)
        if (!id) return null
        return {
          id,
          title: String(item?.title || '').trim(),
          episodeCount: Array.isArray(item?.episodes) ? item.episodes.length : null,
        }
      })
      .filter(Boolean),
    total,
    page,
    pageSize,
    lastPage,
  }
}
