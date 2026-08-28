import { assetImageUrl, storyboardImageUrl } from './mediaUrl.js'

function normalized(value) {
  return String(value || '').trim().toLowerCase()
}

function projectSearchText(project) {
  return [
    project?.title,
    project?.description,
    project?.status,
    project?.style,
    project?.genre,
    project?.metadata?.aspect_ratio,
  ].filter(Boolean).join(' ').toLowerCase()
}

function projectTimeValue(project, field) {
  const value = Date.parse(project?.[field] || '')
  return Number.isFinite(value) ? value : 0
}

function compareProjects(a, b, sort) {
  if (sort === 'server') return 0
  let result = 0
  if (sort === 'created-desc') {
    result = projectTimeValue(b, 'created_at') - projectTimeValue(a, 'created_at')
  } else if (sort === 'title-asc') {
    result = String(a?.title || '').localeCompare(String(b?.title || ''), 'zh-CN', { numeric: true })
  } else {
    result = projectTimeValue(b, 'updated_at') - projectTimeValue(a, 'updated_at')
  }
  if (result !== 0) return result
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), 'zh-CN', { numeric: true })
}

/** Return a stable, renderable cover candidate from project-owned media. */
export function getProjectCover(project) {
  const explicitCover = assetImageUrl({
    local_path: project?.cover_local_path || project?.poster_local_path,
    image_url: project?.cover_image_url || project?.poster_url,
  })
  if (explicitCover) return { url: explicitCover, source: 'project' }

  for (const episode of Array.isArray(project?.episodes) ? project.episodes : []) {
    for (const storyboard of Array.isArray(episode?.storyboards) ? episode.storyboards : []) {
      const url = storyboardImageUrl(storyboard)
      if (url) return { url, source: 'storyboard' }
    }
  }

  const fallbackCover = assetImageUrl({
    local_path: project?.fallback_cover_local_path,
    image_url: project?.fallback_cover_image_url,
  })
  if (fallbackCover) return { url: fallbackCover, source: project?.fallback_cover_source || 'asset' }

  for (const collection of [project?.characters, project?.scenes, project?.props]) {
    for (const asset of Array.isArray(collection) ? collection : []) {
      const url = assetImageUrl(asset)
      if (url) return { url, source: 'asset' }
    }
  }

  return null
}

/** Filter and sort without mutating the API response array. */
export function filterProjectList(projects, options = {}) {
  const source = Array.isArray(projects) ? projects : []
  const keyword = normalized(options.keyword)
  const status = normalized(options.status || 'all') || 'all'
  const sort = options.sort || 'updated-desc'
  const getSearchText = typeof options.getSearchText === 'function'
    ? options.getSearchText
    : projectSearchText

  return source
    .filter((project) => status === 'all' || normalized(project?.status || 'draft') === status)
    .filter((project) => !keyword || normalized(getSearchText(project)).includes(keyword))
    .sort((a, b) => compareProjects(a, b, sort))
}
