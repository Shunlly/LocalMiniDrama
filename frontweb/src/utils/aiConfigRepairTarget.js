const REPAIR_TARGETS = Object.freeze({
  missing_credentials: Object.freeze({ field: 'credentials', section: null }),
  missing_model: Object.freeze({ field: 'model', section: null }),
  missing_workflow: Object.freeze({ field: 'workflow', section: 'endpoint' }),
})

export function getAiConfigRepairTarget(issue) {
  return REPAIR_TARGETS[issue] ? { ...REPAIR_TARGETS[issue] } : null
}

export async function applyAiConfigRepairTarget(issue, {
  advancedSections,
  fieldRefs = {},
  nextTickFn,
} = {}) {
  const target = getAiConfigRepairTarget(issue)
  if (!target) return null
  if (target.section && advancedSections) {
    const current = Array.isArray(advancedSections.value) ? advancedSections.value : []
    if (!current.includes(target.section)) advancedSections.value = [...current, target.section]
  }
  await nextTickFn?.()
  fieldRefs[target.field]?.value?.focus?.()
  return target
}
