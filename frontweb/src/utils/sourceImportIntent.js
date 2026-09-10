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
  const focusInput = () => sourceUrlInput.value?.focus?.()
  focusInput()
  if (windowRef?.setTimeout && Number(refocusDelay) > 0) {
    windowRef.setTimeout(focusInput, Number(refocusDelay))
  }
}
