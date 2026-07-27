const FREE_NODE_TYPES = new Set(['text', 'image', 'video', 'config', 'reference'])
const MAX_NODES = 500
const MAX_EDGES = 1000
const MAX_TEXT_LENGTH = 50000

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
  if (typeof node.content === 'string') node.content = node.content.slice(0, MAX_TEXT_LENGTH)
  if (typeof node.text === 'string') node.text = node.text.slice(0, MAX_TEXT_LENGTH)
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
  const source = input && typeof input === 'object' ? input : {}
  const usedNodeIds = new Set()
  const usedEdgeIds = new Set()
  const nodes = Array.isArray(source.nodes)
    ? source.nodes.slice(0, MAX_NODES).map((node) => normalizeNode(node, usedNodeIds))
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(source.edges)
    ? source.edges
      .map((edge) => normalizeEdge(edge, usedEdgeIds, nodeIds))
      .filter(Boolean)
      .slice(0, MAX_EDGES)
    : []

  return sanitizeJsonValue({
    version: 1,
    mode: typeof source.mode === 'string' ? source.mode : 'production',
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
  const selected = new Set(Array.isArray(ids) ? ids : [])
  const nodes = normalized.nodes.filter((node) => !selected.has(node.id))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = normalized.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  return sanitizeJsonValue({ ...normalized, nodes, edges })
}

export function cloneFreeSelection(state, ids = [], offset = {}) {
  const normalized = normalizeFreeCanvas(state)
  const selected = new Set(Array.isArray(ids) ? ids : [])
  const capacity = Math.max(0, MAX_NODES - normalized.nodes.length)
  const selectedNodes = normalized.nodes.filter((node) => selected.has(node.id)).slice(0, capacity)
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
  const clonedEdges = normalized.edges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
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
