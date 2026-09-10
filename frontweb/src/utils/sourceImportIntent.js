export function focusSourceUrlInput(sourceUrlInput) {
  const target = sourceUrlInput?.value
  if (!target) return false
  if (typeof target.focus === 'function') target.focus()
  const root = target.$el || target
  const native = root?.querySelector?.('input,textarea')
  if (native && typeof native.focus === 'function') native.focus()
  return true
}

export async function revealSourceImportIntent({
  historyExpanded,
  selectedStepId,
  sourceUrlInput,
  nextTickFn,
  windowRef = typeof window === 'undefined' ? null : window,
  refocusDelay = 300,
} = {}) {
  historyExpanded.value = true
  selectedStepId.value = 'intake'
  await nextTickFn()
  await nextTickFn()
  const focusInput = () => focusSourceUrlInput(sourceUrlInput)
  focusInput()
  if (windowRef?.setTimeout && Number(refocusDelay) > 0) {
    windowRef.setTimeout(focusInput, Number(refocusDelay))
  }
}
