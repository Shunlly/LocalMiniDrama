import { ref } from 'vue'

import { reorderWorkflowGroupStoryboards } from '../utils/canvasWorkflow.js'

export function useCanvasWorkflowOrder({
  workflowGroups,
  persist,
  onOrderApplied,
  onSaveFailed,
}) {
  const workflowOrderSaving = ref(false)

  async function reorderWorkflowStoryboards(change) {
    if (workflowOrderSaving.value) return false

    const previousGroups = workflowGroups.value
    const nextGroups = reorderWorkflowGroupStoryboards(
      previousGroups,
      change?.groupId,
      change?.fromIndex,
      change?.toIndex
    )
    if (nextGroups === previousGroups) return false

    workflowOrderSaving.value = true
    workflowGroups.value = nextGroups
    onOrderApplied?.()

    let failedResult
    try {
      const result = await persist(nextGroups)
      if (result === false || result?.ok === false) {
        failedResult = result
        throw result?.error || new Error('保存失败')
      }
      return true
    } catch (error) {
      workflowGroups.value = previousGroups
      onOrderApplied?.()
      onSaveFailed?.(error, failedResult)
      return false
    } finally {
      workflowOrderSaving.value = false
    }
  }

  return {
    workflowOrderSaving,
    reorderWorkflowStoryboards,
  }
}
