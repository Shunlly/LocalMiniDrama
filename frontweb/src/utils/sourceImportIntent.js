export async function revealSourceImportIntent({
  historyExpanded,
  selectedStepId,
  sourceUrlInput,
  nextTickFn,
}) {
  historyExpanded.value = true
  selectedStepId.value = 'intake'
  await nextTickFn()
  sourceUrlInput.value?.focus?.()
}
