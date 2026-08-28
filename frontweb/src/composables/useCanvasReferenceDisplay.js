/** 画布分镜参考图来源展示（不改收集逻辑，只补可见空态与中文来源） */

export const CANVAS_REFERENCE_KIND_LABELS = {
  scene: '场景',
  character: '角色',
  prop: '道具',
  free: '自由',
}

const ENGLISH_REFERENCE_NAME_RE = /^(free reference|media library reference|reference \d+)$/i

function findById(list, id) {
  return (list || []).find((item) => Number(item?.id) === Number(id)) || null
}

function takeMatching(remaining, kind, entity, resolveUrl) {
  const url = resolveUrl(entity) || ''
  const names = [entity?.name, entity?.location].map((value) => String(value || '').trim()).filter(Boolean)
  const index = remaining.findIndex((slot) => {
    if (slot?.kind !== kind) return false
    if (url && slot.url === url) return true
    const slotName = String(slot?.name || '').trim()
    return Boolean(slotName) && names.includes(slotName)
  })
  if (index < 0) return null
  return remaining.splice(index, 1)[0]
}

export function canvasReferenceKindLabel(kind) {
  return CANVAS_REFERENCE_KIND_LABELS[kind] || '参考'
}

export function canvasReferenceDisplayName(slot) {
  const name = String(slot?.name || '').trim()
  if (name && !ENGLISH_REFERENCE_NAME_RE.test(name)) return name
  if (slot?.kind === 'free') {
    const number = slot.freeIndex != null ? slot.freeIndex + 1 : slot.index
    return number ? `自由参考图 ${number}` : '自由参考图'
  }
  if (slot?.kind === 'scene') return '未命名场景'
  if (slot?.kind === 'character') return '未命名角色'
  if (slot?.kind === 'prop') return '未命名道具'
  return canvasReferenceKindLabel(slot?.kind)
}

export function canvasReferenceSourceLabel(slot) {
  const kind = canvasReferenceKindLabel(slot?.kind)
  const name = canvasReferenceDisplayName(slot)
  if (!slot?.url) return `${kind}「${name}」暂无参考图`
  return `${kind}参考图：${name}`
}

export function buildCanvasReferenceDisplaySlots({
  filledSlots = [],
  sceneId = null,
  characterIds = [],
  propIds = [],
  scenes = [],
  characters = [],
  propsList = [],
  resolveUrl = () => '',
} = {}) {
  const remaining = (Array.isArray(filledSlots) ? filledSlots : []).map((slot) => ({ ...slot }))
  const display = []

  function pushBound(kind, entity, fallbackName) {
    const filledSlot = takeMatching(remaining, kind, entity, resolveUrl)
    if (filledSlot) {
      display.push({ ...filledSlot, pending: false })
      return
    }
    display.push({
      kind,
      name: fallbackName,
      url: resolveUrl(entity) || '',
      pending: true,
    })
  }

  if (sceneId != null && sceneId !== '') {
    const entity = findById(scenes, sceneId)
    pushBound('scene', entity, entity?.location || entity?.name || '未命名场景')
  }

  for (const id of characterIds || []) {
    const entity = findById(characters, id)
    pushBound('character', entity, entity?.name || '未命名角色')
  }

  for (const id of propIds || []) {
    const entity = findById(propsList, id)
    pushBound('prop', entity, entity?.name || '未命名道具')
  }

  let freeIndex = 0
  const leftovers = []
  for (const slot of remaining) {
    if (slot.kind === 'free') {
      display.push({ ...slot, freeIndex: freeIndex++, pending: false })
    } else {
      leftovers.push({ ...slot, pending: false })
    }
  }
  display.push(...leftovers)

  return display.map((slot, index) => ({ ...slot, index: index + 1 }))
}
