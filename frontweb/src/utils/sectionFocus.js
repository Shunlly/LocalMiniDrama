export function scrollAndFocusSection(id, {
  documentRef = document,
  windowRef = window,
  focus = true,
  focusDelay = 0,
} = {}) {
  const target = documentRef.getElementById(id)
  if (!target) return false
  const stickyHeader = documentRef.querySelector('.drama-detail > .header')
  const headerHeight = Math.ceil(stickyHeader?.getBoundingClientRect?.().height || 0)
  const top = Math.max(0, windowRef.scrollY + target.getBoundingClientRect().top - headerHeight - 16)
  windowRef.scrollTo({ top, behavior: 'smooth' })
  if (focus) windowRef.setTimeout(() => target.focus?.({ preventScroll: true }), focusDelay)
  return true
}

/** 滚动到区块后，把焦点落到区块内的具体输入控件 */
export function focusSectionField(id, selector, {
  documentRef = document,
  windowRef = window,
  delay = 0,
} = {}) {
  const run = () => {
    const section = documentRef.getElementById(id)
    if (!section?.querySelector) return false
    const field = section.querySelector(selector)
    if (!field) return false
    const native = typeof field.matches === 'function' && field.matches('input,textarea,select')
      ? field
      : field.querySelector?.('input,textarea,select')
    const target = native || field
    if (typeof target.focus !== 'function') return false
    target.focus({ preventScroll: true })
    return true
  }
  if (delay > 0 && typeof windowRef?.setTimeout === 'function') {
    windowRef.setTimeout(run, delay)
    return true
  }
  return run()
}
