const FREE_NODE_TYPES = new Set(['text', 'image', 'video', 'config', 'reference'])
const FREE_CANVAS_MODES = new Set(['production', 'free', 'hybrid'])
const FREE_CANVAS_BACKGROUNDS = new Set(['dots', 'lines', 'none'])
const MAX_NODES = 500
const MAX_EDGES = 1000
const MAX_TEXT_LENGTH = 50000
const DEFAULT_NODE_WIDTH = 280
const DEFAULT_NODE_HEIGHT = 208
const NODE_SPAWN_GAP = 24
const TEXT_LIMIT_FIELDS = ['content', 'text', 'label', 'title', 'name', 'description', 'prompt']
const CONFIG_NODE_STATUSES = new Set(['idle', 'running', 'failed', 'cancelled'])
const CONFIG_METADATA_FIELDS = Object.freeze({
  lastError: 1000,
  operationId: 256,
  startedAt: 64,
  updatedAt: 64,
})

const CANVAS_FIELDS = new Set(['projectId', 'dramaId', 'episodeId', 'title'])
const NODE_FIELDS = new Set([
  'content',
  'text',
  'label',
  'title',
  'name',
  'description',
  'prompt',
  'storageKey',
  'asset_ref',
  'storyboard_ref',
  'assetId',
  'storyboardId',
  'episodeId',
  'sceneId',
  'width',
  'height',
  'zIndex',
  'collapsed',
  'locked',
])
const EDGE_FIELDS = new Set(['type', 'label', 'animated'])
const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'headers',
  'requestheaders',
  'responseheaders',
  'providerresponse',
  'rawproviderresponse',
  'rawresponse',
  'response',
  'token',
  'secret',
  'password',
  'credential',
  'credentials',
  'cookie',
  'cookies',
])

let idCounter = 0

function nextId(type) {
  idCounter += 1
  return `free:${type}:${Date.now()}:${idCounter}`
}

function finiteNumber(value, fallback = 0) {
  try {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  } catch {
    return fallback
  }
}

function nodeType(type) {
  return FREE_NODE_TYPES.has(type) ? type : 'text'
}

function compatibilityIssue(input) {
  if (input == null) return null
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { code: 'INVALID_CANVAS', message: '自由画布数据格式无效，已保留原数据并切换为只读制作模式' }
  }
  if (input.version !== undefined && input.version !== 1) {
    return {
      code: 'UNSUPPORTED_VERSION',
      message: `当前应用暂不支持自由画布版本 ${String(input.version)}，已保留原数据并切换为只读制作模式`,
    }
  }
  if (Array.isArray(input.nodes) && input.nodes.length > MAX_NODES) {
    return {
      code: 'NODE_LIMIT_EXCEEDED',
      message: `自由画布节点不能超过 ${MAX_NODES} 个，请先整理后再保存`,
    }
  }
  if (Array.isArray(input.edges) && input.edges.length > MAX_EDGES) {
    return {
      code: 'EDGE_LIMIT_EXCEEDED',
      message: `自由画布连线不能超过 ${MAX_EDGES} 条，请先整理后再保存`,
    }
  }
  for (const node of Array.isArray(input.nodes) ? input.nodes : []) {
    if (node && typeof node === 'object' && node.type !== undefined && !FREE_NODE_TYPES.has(node.type)) {
      return {
        code: 'UNSUPPORTED_NODE_TYPE',
        message: `当前应用暂不支持自由节点类型 ${String(node.type)}，已保留原数据并切换为只读制作模式`,
      }
    }
    for (const field of TEXT_LIMIT_FIELDS) {
      if (typeof node?.[field] === 'string' && node[field].length > MAX_TEXT_LENGTH) {
        return {
          code: 'TEXT_LIMIT_EXCEEDED',
          message: `单个自由节点文本不能超过 ${MAX_TEXT_LENGTH.toLocaleString('en-US')} 个字符`,
        }
      }
    }
  }
  return null
}

function freeCanvasStateError(issue) {
  const error = new Error(issue.message)
  error.code = issue.code
  return error
}

export function inspectFreeCanvasCompatibility(input) {
  const issue = compatibilityIssue(input)
  return issue
    ? { compatible: false, ...issue }
    : { compatible: true, code: null, message: '' }
}

function assertFreeCanvasCompatible(input) {
  const issue = compatibilityIssue(input)
  if (issue) throw freeCanvasStateError(issue)
}

function normalizedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(normalizedKey(key))
}

// Public state is built from allowlisted fields, then sanitized again for defense in depth.
function sanitizeJsonValue(value, seen = new WeakSet(), depth = 0) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return /^(?:blob:|data:)/i.test(value) ? undefined : value
  if (typeof value !== 'object' || depth >= 20 || seen.has(value)) return undefined

  seen.add(value)
  let result
  if (Array.isArray(value)) {
    result = value.map((entry) => sanitizeJsonValue(entry, seen, depth + 1)).filter((entry) => entry !== undefined)
  } else {
    result = {}
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue
      const sanitized = sanitizeJsonValue(entry, seen, depth + 1)
      if (sanitized !== undefined) result[key] = sanitized
    }
  }
  seen.delete(value)
  return result
}

function cloneJson(value) {
  return sanitizeJsonValue(value)
}

function copyAllowedFields(source, fields) {
  const result = {}
  for (const key of fields) {
    const value = sanitizeJsonValue(source[key])
    if (value !== undefined) result[key] = value
  }
  return result
}

function normalizePosition(position) {
  return {
    x: finiteNumber(position?.x),
    y: finiteNumber(position?.y),
  }
}

function positiveDimension(value, fallback) {
  const number = finiteNumber(value, fallback)
  return number > 0 ? number : fallback
}

function spawnCandidate(preferred, gridX, gridY, nodeWidth = DEFAULT_NODE_WIDTH, nodeHeight = DEFAULT_NODE_HEIGHT) {
  return {
    x: preferred.x + gridX * (nodeWidth + NODE_SPAWN_GAP),
    y: preferred.y + gridY * (nodeHeight + NODE_SPAWN_GAP),
  }
}

function overlapsSpawn(candidate, node, nodeWidth = DEFAULT_NODE_WIDTH, nodeHeight = DEFAULT_NODE_HEIGHT) {
  const position = normalizePosition(node?.position)
  const width = positiveDimension(
    node?.dimensions?.width ?? node?.measured?.width ?? node?.width,
    DEFAULT_NODE_WIDTH,
  )
  const height = positiveDimension(
    node?.dimensions?.height ?? node?.measured?.height ?? node?.height,
    DEFAULT_NODE_HEIGHT,
  )
  return candidate.x < position.x + width + NODE_SPAWN_GAP
    && candidate.x + nodeWidth + NODE_SPAWN_GAP > position.x
    && candidate.y < position.y + height + NODE_SPAWN_GAP
    && candidate.y + nodeHeight + NODE_SPAWN_GAP > position.y
}

function normalizeSpawnBounds(bounds, nodeWidth, nodeHeight) {
  if (!bounds || typeof bounds !== 'object') return null
  const left = finiteNumber(bounds.left)
  const top = finiteNumber(bounds.top)
  const right = finiteNumber(bounds.right, left + nodeWidth)
  const bottom = finiteNumber(bounds.bottom, top + nodeHeight)
  return {
    left,
    top,
    right: Math.max(right, left + nodeWidth),
    bottom: Math.max(bottom, top + nodeHeight),
  }
}

function clampSpawnCandidate(candidate, bounds, nodeWidth, nodeHeight) {
  if (!bounds) return candidate
  return {
    x: Math.min(Math.max(candidate.x, bounds.left), bounds.right - nodeWidth),
    y: Math.min(Math.max(candidate.y, bounds.top), bounds.bottom - nodeHeight),
  }
}

export function screenRectToFreeCanvasBounds(screenRect, viewport, options = {}) {
  const left = finiteNumber(screenRect?.left, Number.NaN)
  const top = finiteNumber(screenRect?.top, Number.NaN)
  const right = finiteNumber(
    screenRect?.right,
    left + finiteNumber(screenRect?.width, Number.NaN),
  )
  const bottom = finiteNumber(
    screenRect?.bottom,
    top + finiteNumber(screenRect?.height, Number.NaN),
  )
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null

  const zoom = positiveDimension(viewport?.zoom, 1)
  const viewportX = finiteNumber(viewport?.x)
  const viewportY = finiteNumber(viewport?.y)
  const inset = options?.insets || {}
  const leftInset = Math.max(0, finiteNumber(inset.left))
  const topInset = Math.max(0, finiteNumber(inset.top))
  const rightInset = Math.max(0, finiteNumber(inset.right))
  const bottomInset = Math.max(0, finiteNumber(inset.bottom))
  const nodeWidth = positiveDimension(options?.nodeSize?.width, DEFAULT_NODE_WIDTH)
  const nodeHeight = positiveDimension(options?.nodeSize?.height, DEFAULT_NODE_HEIGHT)
  const safeLeft = left + leftInset
  const safeTop = top + topInset
  const safeRight = right - rightInset
  const safeBottom = bottom - bottomInset
  if (
    safeRight - safeLeft < nodeWidth * zoom
    || safeBottom - safeTop < nodeHeight * zoom
  ) return null

  return {
    left: (safeLeft - left - viewportX) / zoom,
    top: (safeTop - top - viewportY) / zoom,
    right: (safeRight - left - viewportX) / zoom,
    bottom: (safeBottom - top - viewportY) / zoom,
  }
}

function boundedAxisCandidates(minimum, maximum, size, preferred) {
  const values = new Map()
  const add = (value) => {
    if (!Number.isFinite(value) || value < minimum || value > maximum) return
    values.set(value.toFixed(8), value)
  }
  const step = size + NODE_SPAWN_GAP
  add(preferred)
  add(minimum)
  add(maximum)
  for (let offset = 0; offset <= maximum - minimum; offset += step) {
    add(minimum + offset)
    add(maximum - offset)
  }
  return [...values.values()]
}

export function findFreeNodeSpawnPosition(preferredPosition, existingNodes = [], options = {}) {
  const nodeWidth = positiveDimension(options?.nodeSize?.width, DEFAULT_NODE_WIDTH)
  const nodeHeight = positiveDimension(options?.nodeSize?.height, DEFAULT_NODE_HEIGHT)
  const bounds = normalizeSpawnBounds(options?.bounds, nodeWidth, nodeHeight)
  const preferred = clampSpawnCandidate(normalizePosition(preferredPosition), bounds, nodeWidth, nodeHeight)
  const nodes = Array.isArray(existingNodes) ? existingNodes : []
  const isInside = (candidate) => !bounds || (
    candidate.x >= bounds.left
    && candidate.y >= bounds.top
    && candidate.x + nodeWidth <= bounds.right
    && candidate.y + nodeHeight <= bounds.bottom
  )
  const isOpen = (candidate) => isInside(candidate)
    && nodes.every((node) => !overlapsSpawn(candidate, node, nodeWidth, nodeHeight))
  if (isOpen(preferred)) return preferred

  if (bounds) {
    const xValues = boundedAxisCandidates(bounds.left, bounds.right - nodeWidth, nodeWidth, preferred.x)
    const yValues = boundedAxisCandidates(bounds.top, bounds.bottom - nodeHeight, nodeHeight, preferred.y)
    const candidates = xValues.flatMap((x) => yValues.map((y) => ({ x, y })))
    candidates.sort((first, second) => {
      const firstDistance = (first.x - preferred.x) ** 2 + (first.y - preferred.y) ** 2
      const secondDistance = (second.x - preferred.x) ** 2 + (second.y - preferred.y) ** 2
      return firstDistance - secondDistance || first.y - second.y || first.x - second.x
    })
    return candidates.find(isOpen) || null
  }

  for (let ring = 1; ring <= MAX_NODES; ring += 1) {
    for (let y = 0; y <= ring; y += 1) {
      const candidate = spawnCandidate(preferred, ring, y, nodeWidth, nodeHeight)
      if (isOpen(candidate)) return candidate
    }
    for (let x = ring - 1; x >= -ring; x -= 1) {
      const candidate = spawnCandidate(preferred, x, ring, nodeWidth, nodeHeight)
      if (isOpen(candidate)) return candidate
    }
    for (let y = ring - 1; y >= -ring; y -= 1) {
      const candidate = spawnCandidate(preferred, -ring, y, nodeWidth, nodeHeight)
      if (isOpen(candidate)) return candidate
    }
    for (let x = -ring + 1; x <= ring; x += 1) {
      const candidate = spawnCandidate(preferred, x, -ring, nodeWidth, nodeHeight)
      if (isOpen(candidate)) return candidate
    }
  }

  return null
}

export function synchronizeFreeCanvasSelection(flowNodes = [], nodeId) {
  const source = Array.isArray(flowNodes) ? flowNodes : []
  const target = source.find((node) => (
    String(node?.id) === String(nodeId)
    && (node?.type === 'freeCanvas' || String(node?.id || '').startsWith('free:'))
  ))
  const focusedNodeId = target?.id ?? null
  return {
    focusedNodeId,
    nodeIds: focusedNodeId == null ? [] : [focusedNodeId],
    edgeIds: [],
    nodes: source.map((node) => ({
      ...node,
      selected: focusedNodeId != null && String(node?.id) === String(focusedNodeId),
    })),
  }
}

function normalizeViewport(viewport) {
  const zoom = finiteNumber(viewport?.zoom, 0.9)
  return {
    x: finiteNumber(viewport?.x),
    y: finiteNumber(viewport?.y),
    zoom: Math.min(2, Math.max(0.25, zoom)),
  }
}

function normalizeNode(input, usedIds, forcedType) {
  const source = input && typeof input === 'object' ? input : {}
  const type = nodeType(forcedType === undefined ? source.type : forcedType)
  const id = typeof source.id === 'string' && source.id && !usedIds.has(source.id)
    ? source.id
    : nextId(type)
  usedIds.add(id)

  const node = {
    id,
    type,
    position: normalizePosition(source.position),
    ...copyAllowedFields(source, NODE_FIELDS),
  }
  if (type === 'config' && CONFIG_NODE_STATUSES.has(source.status)) {
    node.status = source.status
  }
  if (type === 'config' && source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)) {
    const metadata = {}
    for (const [field, maxLength] of Object.entries(CONFIG_METADATA_FIELDS)) {
      if (typeof source.metadata[field] === 'string') {
        metadata[field] = source.metadata[field].slice(0, maxLength)
      }
    }
    if (Object.keys(metadata).length) node.metadata = metadata
  }
  return sanitizeJsonValue(node)
}

function normalizeEdge(input, usedIds, nodeIds) {
  const source = input && typeof input === 'object' ? input : {}
  if (typeof source.source !== 'string' || typeof source.target !== 'string') return null
  if (!nodeIds.has(source.source) || !nodeIds.has(source.target)) return null

  const id = typeof source.id === 'string' && source.id && !usedIds.has(source.id)
    ? source.id
    : nextId('edge')
  usedIds.add(id)
  return sanitizeJsonValue({
    id,
    source: source.source,
    target: source.target,
    ...copyAllowedFields(source, EDGE_FIELDS),
  })
}

export function createEmptyFreeCanvas(overrides = {}) {
  return normalizeFreeCanvas(overrides)
}

export function normalizeFreeCanvas(input) {
  assertFreeCanvasCompatible(input)
  const source = input && typeof input === 'object' ? input : {}
  const usedNodeIds = new Set()
  const usedEdgeIds = new Set()
  const nodes = Array.isArray(source.nodes)
    ? source.nodes.map((node) => normalizeNode(node, usedNodeIds))
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(source.edges)
    ? source.edges
      .map((edge) => normalizeEdge(edge, usedEdgeIds, nodeIds))
      .filter(Boolean)
    : []

  const mode = FREE_CANVAS_MODES.has(source.mode) ? source.mode : 'production'
  const background = FREE_CANVAS_BACKGROUNDS.has(source.background) ? source.background : 'dots'
  return sanitizeJsonValue({
    version: 1,
    mode,
    background,
    viewport: normalizeViewport(source.viewport),
    ...copyAllowedFields(source, CANVAS_FIELDS),
    nodes,
    edges,
  })
}

export function serializeFreeCanvas(input) {
  return sanitizeJsonValue(normalizeFreeCanvas(input))
}

export function createFreeNode(type, overrides = {}) {
  return normalizeNode(overrides, new Set(), type)
}

export function createFreeEdge(source, target, overrides = {}) {
  const input = overrides && typeof overrides === 'object' ? overrides : {}
  const id = typeof input.id === 'string' && input.id ? input.id : nextId('edge')
  return sanitizeJsonValue({
    id,
    source: typeof source === 'string' ? source : '',
    target: typeof target === 'string' ? target : '',
    ...copyAllowedFields(input, EDGE_FIELDS),
  })
}

export function removeFreeSelection(state, ids = []) {
  const normalized = normalizeFreeCanvas(state)
  const selected = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)))
  const nodes = normalized.nodes.filter((node) => !selected.has(String(node.id)))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = normalized.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  return sanitizeJsonValue({ ...normalized, nodes, edges })
}

export function cloneFreeSelection(state, ids = [], offset = {}) {
  const normalized = normalizeFreeCanvas(state)
  const selected = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)))
  const capacity = Math.max(0, MAX_NODES - normalized.nodes.length)
  const selectedNodes = normalized.nodes.filter((node) => selected.has(String(node.id)))
  const selectedEdges = normalized.edges.filter((edge) => (
    selected.has(String(edge.source)) && selected.has(String(edge.target))
  ))
  if (
    selectedNodes.length > capacity
    || normalized.edges.length + selectedEdges.length > MAX_EDGES
  ) {
    return normalized
  }
  const idMap = new Map()
  const offsetX = finiteNumber(offset?.x, 24)
  const offsetY = finiteNumber(offset?.y, 24)
  const clones = selectedNodes.map((node) => {
    const clone = cloneJson(node)
    clone.id = nextId(node.type)
    clone.position = {
      x: finiteNumber(node.position?.x) + offsetX,
      y: finiteNumber(node.position?.y) + offsetY,
    }
    idMap.set(node.id, clone.id)
    return clone
  })
  const clonedEdges = selectedEdges
    .map((edge) => ({
      ...cloneJson(edge),
      id: nextId('edge'),
      source: idMap.get(edge.source),
      target: idMap.get(edge.target),
    }))
  return normalizeFreeCanvas({
    ...normalized,
    nodes: [...normalized.nodes, ...clones],
    edges: [...normalized.edges, ...clonedEdges],
  })
}
