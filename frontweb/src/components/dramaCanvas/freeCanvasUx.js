import { reactive } from 'vue'

export const FREE_CANVAS_NODE_LIMIT = 500
export const FREE_CANVAS_NODE_SOFT_LIMIT = 400
export const FREE_CANVAS_NODE_DENSITY_HINT_AT = 120
export const FREE_CANVAS_NODE_WIDTH = 280
export const FREE_CANVAS_NODE_HEIGHT = 208

const INSPECTOR_DELETE_CHROME_SELECTOR = [
  '.free-canvas-inspector-dock',
  '.free-canvas-inspector',
  '.canvas-inspector-dock',
  '.el-popper',
  '.el-select-dropdown',
  '.el-overlay',
  '.el-dialog',
  '.el-message-box',
  'video',
  'audio',
].join(', ')

const TYPING_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '.el-input',
  '.el-textarea',
  '.el-select',
].join(', ')

export const FREE_CANVAS_TYPING_TARGET_SELECTOR = TYPING_TARGET_SELECTOR

/** 自由画布工具条和快捷键共享的轻量界面状态 */
export const freeCanvasUxState = reactive({
  nodeCount: 0,
  selectionCount: 0,
  readonly: false,
  canvasMode: 'production',
  alignSelection: null,
})

export function setFreeCanvasUxState(partial = {}) {
  Object.assign(freeCanvasUxState, partial)
}

function toCount(value) {
  return Math.max(0, Number(value) || 0)
}

function matchesSelector(element, selector) {
  return Boolean(element?.closest?.(selector))
}

/** 检查器、下拉层或输入框获得焦点时，禁止把 Delete/Backspace 当成画布删除 */
export function isFreeCanvasDeleteShortcutBlocked({ target, activeElement } = {}) {
  return matchesSelector(target, INSPECTOR_DELETE_CHROME_SELECTOR)
    || matchesSelector(target, TYPING_TARGET_SELECTOR)
    || matchesSelector(activeElement, INSPECTOR_DELETE_CHROME_SELECTOR)
    || matchesSelector(activeElement, TYPING_TARGET_SELECTOR)
}

export function getFreeCanvasAlignDisabledReason({ selectionCount = 0, readonly = false } = {}) {
  if (readonly) return '当前自由画布为只读，无法对齐节点'
  if (toCount(selectionCount) < 2) return '请先框选至少 2 个节点再对齐'
  return ''
}

export function getFreeCanvasNodeCapacityHint(nodeCount) {
  const count = toCount(nodeCount)
  if (count >= FREE_CANVAS_NODE_LIMIT) return '自由画布已达到 500 个节点上限，请先整理后再添加'
  if (count >= FREE_CANVAS_NODE_DENSITY_HINT_AT) return `节点较多（${count}/500），当前只渲染可见区域`
  return ''
}

export function getFreeCanvasNodeCapacityWarning(nodeCount) {
  const count = toCount(nodeCount)
  if (count >= FREE_CANVAS_NODE_LIMIT) return '自由画布已达到 500 个节点上限，请先整理后再添加'
  if (count >= FREE_CANVAS_NODE_SOFT_LIMIT) {
    return `自由画布节点较多（${count}/500），继续添加可能影响操作流畅度`
  }
  return ''
}

export function alignFreeCanvasNodePositions(nodes, selectedIds, mode = 'left') {
  const list = Array.isArray(nodes) ? nodes : []
  const idSet = new Set((selectedIds || []).map((id) => String(id)))
  const selected = list.filter((node) => idSet.has(String(node?.id)))
  if (selected.length < 2) return list

  const boxes = selected.map((node) => {
    const x = Number(node?.position?.x)
    const y = Number(node?.position?.y)
    return {
      node,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      width: Number(node?.width) > 0 ? Number(node.width) : FREE_CANVAS_NODE_WIDTH,
      height: Number(node?.height) > 0 ? Number(node.height) : FREE_CANVAS_NODE_HEIGHT,
    }
  })
  const minX = Math.min(...boxes.map((box) => box.x))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const minY = Math.min(...boxes.map((box) => box.y))
  const centerX = (minX + maxX) / 2
  const nextById = new Map()

  if (mode === 'top') {
    for (const box of boxes) nextById.set(String(box.node.id), { x: box.x, y: minY })
  } else if (mode === 'center-x') {
    for (const box of boxes) nextById.set(String(box.node.id), { x: centerX - box.width / 2, y: box.y })
  } else {
    for (const box of boxes) nextById.set(String(box.node.id), { x: minX, y: box.y })
  }

  return list.map((node) => {
    const position = nextById.get(String(node?.id))
    return position ? { ...node, position: { ...position } } : node
  })
}
