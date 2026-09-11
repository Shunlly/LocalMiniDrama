export function parseCanvasFocusNodeId(routeLike) {
  const raw = Array.isArray(routeLike?.query?.focus) ? routeLike.query.focus[0] : routeLike?.query?.focus
  const value = String(raw || '').trim()
  return /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : ''
}

export function parseCanvasEpisodeId(routeLike) {
  const raw = Array.isArray(routeLike?.query?.episode) ? routeLike.query.episode[0] : routeLike?.query?.episode
  if (raw == null || raw === '') return null
  const rawValue = String(raw).trim()
  if (!/^[1-9]\d*$/.test(rawValue)) return null
  const value = Number(rawValue)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function parseCanvasRouteContext(routeLike) {
  return {
    projectId: String(routeLike?.params?.id || ''),
    focusNodeId: parseCanvasFocusNodeId(routeLike),
    episodeId: parseCanvasEpisodeId(routeLike),
  }
}
