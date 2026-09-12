export function parseRequestedFlowStep(query) {
  const raw = Array.isArray(query?.step) ? query.step[0] : query?.step
  return typeof raw === 'string' ? raw.trim() : ''
}

export function buildInspectedFlowStepQuery(query, liveStepId, stepId) {
  const nextStepId = stepId && stepId !== liveStepId ? String(stepId).trim() : ''
  const nextQuery = { ...query }
  if (nextStepId) nextQuery.step = nextStepId
  else delete nextQuery.step
  return {
    nextStepId,
    query: nextQuery,
    unchanged: parseRequestedFlowStep(query) === nextStepId,
  }
}
