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
