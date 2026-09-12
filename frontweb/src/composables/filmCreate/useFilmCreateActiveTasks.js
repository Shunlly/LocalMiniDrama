import { computed } from 'vue'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'

export function useFilmCreateActiveTasks(deps = {}) {
  const {
    genStore,
    pipelineRunning,
    pipelineStopping,
    pipelineAbortRequested,
    pipelineCurrentStep,
    isStoryGenRunning,
    universalOmniPolishRunning,
    universalOmniPolishProgress,
    batchImageRunning,
    batchVideoRunning,
    batchVideoProgress,
  } = deps

  const allActiveTaskItems = computed(() => {
    const items = []
    const seen = new Set()
    function addItem(item) {
      const id = item.id || item.label
      if (!id || seen.has(id)) return
      seen.add(id)
      items.push(item)
    }
    for (const t of genStore.getAllRunningTasks()) {
      addItem({
        id: `gen:${t.key || t.taskId || t.label}`,
        label: t.label || '任务进行中...',
        kind: 'genStore',
        task: t,
      })
    }
    if (pipelineRunning.value) {
      const step = pipelineCurrentStep.value
      addItem({
        id: 'pipeline',
        label: pipelineStopping.value
          ? '正在停止全流程...'
          : pipelineAbortRequested.value
            ? '全流程停止未完成，点击重试'
            : (step ? step.replace(/^\[步骤 \d+\/\d+\] /, '') : '一键全流程运行中...'),
        kind: 'pipeline',
      })
    }
    if (isStoryGenRunning.value && !genStore.getAllRunningTasks().some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)) {
      addItem({ id: 'story-gen-local', label: '生成剧本...', kind: 'storyGenLocal' })
    }
    if (universalOmniPolishRunning.value) {
      const p = universalOmniPolishProgress.value
      addItem({
        id: 'universal-omni-polish',
        label: `润色全能分镜 ${p.current}/${p.total}${p.label ? ' ' + p.label : ''}`,
        kind: 'universalOmniPolish',
      })
    }
    if (batchImageRunning.value) {
      addItem({ id: 'batch-image', label: '批量生成分镜图...', kind: 'batchImage' })
    }
    if (batchVideoRunning.value) {
      const p = batchVideoProgress.value
      const suffix = p?.total ? ` ${p.current}/${p.total}` : ''
      addItem({ id: 'batch-video', label: `批量生成分镜视频${suffix}...`, kind: 'batchVideo' })
    }
    return items
  })

  const allActiveTaskLabels = computed(() => allActiveTaskItems.value.map((t) => t.label))

  return {
    allActiveTaskItems,
    allActiveTaskLabels,
  }
}
