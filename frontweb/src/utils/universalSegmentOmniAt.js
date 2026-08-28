/** 全能片段 @ 引用：编辑区展示名与提交用的 @图片N 互转 */

function positiveIndex(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

function trimName(value) {
  return value == null ? '' : String(value).trim()
}

export function canonicalAtToken(index) {
  const n = positiveIndex(index)
  return n ? `@图片${n}` : ''
}

export function omniSlotKindLabel(kind) {
  if (kind === 'scene') return '场景'
  if (kind === 'character') return '角色'
  if (kind === 'prop') return '道具'
  return '参考'
}

function slotByIndex(slots, index) {
  const n = positiveIndex(index)
  if (!n) return null
  return (Array.isArray(slots) ? slots : []).find((item) => Number(item?.index) === n) || null
}

export function makeDisplayAtToken(index, slots = []) {
  const n = positiveIndex(index)
  if (!n) return ''
  const list = Array.isArray(slots) ? slots : []
  const slot = slotByIndex(list, n)
  const name = trimName(slot?.name)
  if (!name) return canonicalAtToken(n)
  const sameName = list.filter((item) => trimName(item?.name) === name)
  if (sameName.length <= 1) return `@${name}`
  const prefix = omniSlotKindLabel(slot?.kind)
  const sameKindName = sameName.filter((item) => omniSlotKindLabel(item?.kind) === prefix)
  if (sameKindName.length <= 1) return `@${prefix}·${name}`
  return `@${prefix}·${name}·${n}`
}

export function toCanonicalOmniText(text, slots = []) {
  const raw = text == null ? '' : String(text).replace(/\u00a0/g, ' ')
  if (!raw) return ''
  const list = Array.isArray(slots) ? slots : []
  const displayTokens = []
  const seen = new Set()
  for (const slot of list) {
    const n = positiveIndex(slot?.index)
    if (!n) continue
    const display = makeDisplayAtToken(n, list)
    const canonical = canonicalAtToken(n)
    if (!display || display === canonical || seen.has(display)) continue
    seen.add(display)
    displayTokens.push({ token: display, index: n })
  }
  displayTokens.sort((a, b) => b.token.length - a.token.length || a.index - b.index)
  let out = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '@') {
      const imgMatch = raw.slice(i).match(/^@图片(\d+)/)
      if (imgMatch) {
        out += canonicalAtToken(imgMatch[1]) || imgMatch[0]
        i += imgMatch[0].length
        continue
      }
      const rest = raw.slice(i)
      const hit = displayTokens.find((item) => rest.startsWith(item.token))
      if (hit) {
        out += canonicalAtToken(hit.index)
        i += hit.token.length
        continue
      }
    }
    out += raw[i]
    i += 1
  }
  return out
}
