import { toCanonicalOmniText } from '@/utils/universalSegmentOmniAt.js'

export const OMNI_AT_MENU_EMPTY_TEXT = '当前没有可用的参考图（请为场景 / 角色 / 道具选择带图素材）'
export const OMNI_AT_COPY_DISABLED_EMPTY = '当前没有可复制的提示词'

export function describeChipAriaLabel(display, canonical) {
  return `${display}（提交为 ${canonical}），点击可更换`
}

export function describeCopyDisabledReason(modelValue, slots = []) {
  const text = toCanonicalOmniText(modelValue == null ? '' : String(modelValue), slots).trim()
  if (!text) return OMNI_AT_COPY_DISABLED_EMPTY
  return ''
}

export function shouldOpenAtMenu(serialized, caretOffset, composing = false) {
  if (composing) return false
  if (caretOffset < 1 || serialized[caretOffset - 1] !== '@') return false
  const before = serialized.slice(0, caretOffset)
  if (/@图片\d+$/.test(before)) return false
  if (before.endsWith('@@')) return false
  return true
}

export function insertCanonicalTokenAtAt(serialized, atOffset, token) {
  const text = serialized == null ? '' : String(serialized)
  const at = Math.max(1, Number(atOffset) || 0)
  if (!token || text[at - 1] !== '@') return null
  return {
    next: text.slice(0, at - 1) + token + text.slice(at),
    caret: at - 1 + token.length,
  }
}

export function replaceSerializedRange(serialized, start, end, insertion = '') {
  const text = serialized == null ? '' : String(serialized)
  const from = Math.max(0, Math.min(Number(start) || 0, Number(end) || 0))
  const to = Math.max(0, Math.max(Number(start) || 0, Number(end) || 0))
  const inserted = insertion == null ? '' : String(insertion)
  return {
    next: text.slice(0, from) + inserted + text.slice(to),
    caret: from + inserted.length,
  }
}

export function nextMenuActiveIndex(current, delta, length) {
  const size = Number(length) || 0
  if (size <= 0) return 0
  const index = Number(current) || 0
  const step = Number(delta) || 0
  return (index + step + size) % size
}

export function computeMenuPosition(rect, viewport = {}) {
  const pad = 4
  const width = 280
  const maxHeight = 320
  const scrollY = Number(viewport.scrollY) || 0
  const scrollX = Number(viewport.scrollX) || 0
  const innerWidth = Number(viewport.innerWidth) || 0
  const innerHeight = Number(viewport.innerHeight) || 0
  let top = (rect?.bottom || 0) + pad + scrollY
  let left = (rect?.left || 0) + scrollX
  if (innerWidth && left + width > innerWidth - 8) left = Math.max(8, innerWidth - width - 8)
  if (innerHeight && top + maxHeight > innerHeight + scrollY - 8) {
    top = (rect?.top || 0) + scrollY - maxHeight - pad
  }
  return {
    top: `${top}px`,
    left: `${left}px`,
    minWidth: `${width}px`,
    maxHeight: `${maxHeight}px`,
  }
}