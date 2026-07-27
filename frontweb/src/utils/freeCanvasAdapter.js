import { normalizeFreeCanvas } from './freeCanvasState.js'

const MIN_NODE_WIDTH = 280
const MIN_NODE_HEIGHT = 180

function finitePositive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function clonePlain(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const result = Array.isArray(value) ? [] : {}
  seen.set(value, result)
  for (const [key, entry] of Object.entries(value)) {
    result[key] = clonePlain(entry, seen)
  }
  return result
}

function selectedNodeIds(context) {
  const ids = new Set()
  if (context?.selectedNodeId != null) ids.add(String(context.selectedNodeId))
  const selected = context?.selectedNodeIds
  if (selected && typeof selected[Symbol.iterator] === 'function') {
    for (const id of selected) ids.add(String(id))
  }
  return ids
}

function referenceCollection(context, kind) {
  const plural = kind === 'asset' ? 'assets' : 'storyboards'
  const byId = `${kind}ById`
  return context?.[byId]
    ?? context?.[`${plural}ById`]
    ?? context?.references?.[plural]
    ?? context?.[plural]
    ?? null
}

function findReference(collection, id) {
  if (!collection || id === null || id === undefined || id === '') return null
  if (collection instanceof Map) {
    return collection.get(id) ?? collection.get(String(id)) ?? null
  }
  if (Array.isArray(collection)) {
    return collection.find((item) => String(item?.id) === String(id)) ?? null
  }
  if (typeof collection === 'object') return collection[id] ?? collection[String(id)] ?? null
  return null
}

function referenceLabel(reference, fallback) {
  if (typeof reference === 'string' && reference.trim()) return reference.trim()
  if (!reference || typeof reference !== 'object') return fallback
  for (const key of ['label', 'title', 'name', 'displayName']) {
    if (typeof reference[key] === 'string' && reference[key].trim()) return reference[key].trim()
  }
  return fallback
}

function summarizeReference(id, kind, context) {
  if (id === null || id === undefined || id === '') return null
  const reference = findReference(referenceCollection(context, kind), id)
  const noun = kind === 'asset' ? '素材' : '分镜'
  return {
    id,
    label: referenceLabel(reference, `${noun} ${id}`),
  }
}

function freeNodeLabel(node) {
  for (const key of ['title', 'label', 'name']) {
    if (typeof node[key] === 'string' && node[key].trim()) return node[key].trim()
  }
  return ''
}

/**
 * Converts bounded persisted free-canvas data into serializable Vue Flow inputs.
 */
export function buildFreeCanvasGraph(freeCanvas, context = {}) {
  const normalized = normalizeFreeCanvas(freeCanvas)
  const selected = selectedNodeIds(context)
  const nodes = normalized.nodes.map((freeNode) => {
    const width = Math.max(MIN_NODE_WIDTH, finitePositive(freeNode.width, MIN_NODE_WIDTH))
    const height = Math.max(MIN_NODE_HEIGHT, finitePositive(freeNode.height, MIN_NODE_HEIGHT))
    const referenceSummary = {
      asset: summarizeReference(freeNode.asset_ref, 'asset', context),
      storyboard: summarizeReference(freeNode.storyboard_ref, 'storyboard', context),
    }
    return {
      id: freeNode.id,
      type: 'freeCanvas',
      position: { x: freeNode.position.x, y: freeNode.position.y },
      dimensions: { width, height },
      draggable: true,
      selectable: true,
      connectable: true,
      selected: selected.has(String(freeNode.id)),
      data: {
        freeNode: clonePlain(freeNode),
        label: freeNodeLabel(freeNode),
        referenceSummary,
      },
    }
  })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = normalized.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: typeof edge.type === 'string' && edge.type ? edge.type : 'default',
      ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
      animated: Boolean(edge.animated),
    }))

  return { nodes, edges }
}

function graphParts(graph) {
  return {
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
  }
}

/**
 * Returns an isolated graph for the active canvas mode without changing either source graph.
 */
export function mergeCanvasGraphs(productionGraph, freeGraph, mode = 'production') {
  const production = graphParts(productionGraph)
  const free = graphParts(freeGraph)
  const includesFree = mode === 'free' || mode === 'hybrid'
  const sourceNodes = includesFree ? [...production.nodes, ...free.nodes] : production.nodes
  const nodes = []
  const nodeIds = new Set()
  for (const node of sourceNodes) {
    if (!node?.id || nodeIds.has(node.id)) continue
    nodeIds.add(node.id)
    nodes.push(clonePlain(node))
  }

  const sourceEdges = includesFree ? [...production.edges, ...free.edges] : production.edges
  const edges = []
  const edgeIds = new Set()
  for (const edge of sourceEdges) {
    if (!edge?.id || edgeIds.has(edge.id)) continue
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    edgeIds.add(edge.id)
    edges.push(clonePlain(edge))
  }
  return { nodes, edges }
}
