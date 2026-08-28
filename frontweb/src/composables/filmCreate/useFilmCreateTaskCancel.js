import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export function useFilmCreateTaskCancel(deps = {}) {
  const {
    ElMessage,
    genStore,
    cancelPipelineRun,
    storyGenerating,
    scriptGenerating,
    universalOmniPolishAbort,
    batchImageStopping,
    batchVideoStopping,
  } = deps
  async function cancelActiveTask(item) {
    if (!item) return
    try {
      if (item.kind === 'genStore' && item.task) {
        await genStore.cancelTask(item.task)
        ElMessage.success('任务已取消')
        return
      }
      if (item.kind === 'pipeline') {
        await cancelPipelineRun()
        return
      }
      if (item.kind === 'storyGenLocal') {
        storyGenerating.value = false
        scriptGenerating.value = false
        const storyTask = genStore.getAllRunningTasks().find((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)
        if (storyTask) await genStore.cancelTask(storyTask)
        ElMessage.success('已取消剧本生成')
        return
      }
      if (item.kind === 'universalOmniPolish') {
        universalOmniPolishAbort.value = true
        ElMessage.success('正在停止润色...')
        return
      }
      if (item.kind === 'batchImage') {
        batchImageStopping.value = true
        ElMessage.info('正在停止批量生图...')
        return
      }
      if (item.kind === 'batchVideo') {
        batchVideoStopping.value = true
        ElMessage.info('正在停止批量生视频...')
        return
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '取消失败'))
    }
  }
  return {
    cancelActiveTask,
  }
}
