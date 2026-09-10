import { ElMessage, ElMessageBox } from 'element-plus'

import { runWorkflowGroup } from '@/composables/useCanvasWorkflowRunner'
import {
  createWorkflowGroup,
  deleteWorkflowGroup,
  findStoryboardInDrama,
  normalizePipeline,
} from '@/utils/canvasWorkflow'

/** 制作模式工作流分组的创建、删除与整组执行 */
export function useDramaCanvasWorkflow(deps) {
  const {
    canvasMode,
    selectedStoryboardIds,
    pipelineSteps,
    workflowGroups,
    activeGroupId,
    ensureProductionPipelineReady,
    persistCanvasState,
    rebuildGraph,
    currentCanvasProjectId,
    isCanvasProjectCurrent,
    workflowRunStarting,
    workflowRunning,
    workflowOutcomeUnknown,
    activeWorkflowSteps,
    pipelineTouchesBillableMedia,
    ensureKnownStoryboardMedia,
    drama,
    activeWorkflowRun,
    workflowProgress,
    loadCanvasProject,
    isActiveWorkflowRun,
    isWorkflowAbortError,
    getCanvasGenerationOptions,
    safeFreeCanvasError,
  } = deps

  let workflowRunSequence = 0

  async function onCreateWorkflowGroup() {
    if (canvasMode.value !== 'production') return
    const requestedProjectId = currentCanvasProjectId()
    if (!requestedProjectId) return
    if (!selectedStoryboardIds.value.length) {
      ElMessage.warning('请先框选或 Ctrl 点击选择分镜节点')
      return
    }
    if (!ensureProductionPipelineReady(pipelineSteps.value)) return
    try {
      const { value } = await ElMessageBox.prompt('工作流名称', '创建工作流', {
        confirmButtonText: '创建',
        cancelButtonText: '取消',
        inputValue: `工作流 ${workflowGroups.value.length + 1}`,
      })
      if (!isCanvasProjectCurrent(requestedProjectId)) return
      workflowGroups.value = createWorkflowGroup(workflowGroups.value, {
        title: value?.trim() || undefined,
        storyboardIds: selectedStoryboardIds.value,
        pipeline: normalizePipeline(pipelineSteps.value, { allowEmpty: true }),
      })
      activeGroupId.value = workflowGroups.value[workflowGroups.value.length - 1]?.id || null
      const saved = await persistCanvasState({ groupsOnly: true })
      if (!saved.ok || !isCanvasProjectCurrent(requestedProjectId)) return
      rebuildGraph()
      ElMessage.success('工作流已创建')
    } catch (_) {}
  }

  async function onDeleteActiveGroup() {
    if (canvasMode.value !== 'production') return
    if (!activeGroupId.value) return
    const requestedProjectId = currentCanvasProjectId()
    if (!requestedProjectId) return
    try {
      await ElMessageBox.confirm('确定删除该工作流？', '删除工作流', { type: 'warning' })
      if (!isCanvasProjectCurrent(requestedProjectId)) return
      workflowGroups.value = deleteWorkflowGroup(workflowGroups.value, activeGroupId.value)
      activeGroupId.value = workflowGroups.value[0]?.id || null
      const saved = await persistCanvasState({ groupsOnly: true })
      if (!saved.ok || !isCanvasProjectCurrent(requestedProjectId)) return
      rebuildGraph()
      ElMessage.success('已删除')
    } catch (_) {}
  }

  async function onRunActiveGroup() {
    if (canvasMode.value !== 'production') return
    if (workflowRunStarting.value || workflowRunning.value) {
      ElMessage.warning('工作流正在启动或执行，请等待当前任务完成')
      return
    }
    if (workflowOutcomeUnknown.value) {
      ElMessage.warning('请先刷新项目状态，确认上一次配音结果后再执行工作流')
      return
    }
    const requestedProjectId = currentCanvasProjectId()
    if (!requestedProjectId) return
    const group = workflowGroups.value.find((g) => g.id === activeGroupId.value)
    if (!group) {
      ElMessage.warning('请先选择工作流')
      return
    }
    const workflowSteps = activeWorkflowSteps.value
    if (!ensureProductionPipelineReady(workflowSteps)) return
    if (pipelineTouchesBillableMedia(workflowSteps) && !ensureKnownStoryboardMedia(group.storyboard_ids || [])) return
    workflowRunStarting.value = true
    try {
      await ElMessageBox.confirm(
        `将对 ${(group.storyboard_ids || []).length} 个分镜依次执行：${workflowSteps.join(' → ')}\n耗时可能较长，是否继续？`,
        '整组重跑',
        { type: 'warning', confirmButtonText: '开始执行' }
      )
    } catch {
      workflowRunStarting.value = false
      return
    }
    if (!isCanvasProjectCurrent(requestedProjectId)) {
      workflowRunStarting.value = false
      return
    }

    workflowRunning.value = true
    workflowRunStarting.value = false
    const run = {
      token: ++workflowRunSequence,
      projectId: requestedProjectId,
      controller: new AbortController(),
    }
    activeWorkflowRun.value = run
    workflowProgress.value = '准备执行…'
    try {
      const summary = await runWorkflowGroup(drama.value, {
        ...group,
        pipeline: workflowSteps,
      }, {
        signal: run.controller.signal,
        stopOnError: true,
        generationOptions: getCanvasGenerationOptions(),
        reloadStoryboard: async (storyboardId, requestOptions) => {
          if (!isActiveWorkflowRun(run)) return null
          await loadCanvasProject({ blocking: false, preserveOnError: true, requestOptions })
          if (!isActiveWorkflowRun(run)) return null
          return findStoryboardInDrama(drama.value, storyboardId)?.storyboard
        },
        onStepStart: ({ storyboardId, step }) => {
          if (!isActiveWorkflowRun(run)) return
          workflowProgress.value = `分镜 #${storyboardId}：${step === 'image' ? '生图' : step === 'video' ? '生视频' : '配音'}…`
        },
        onStoryboardError: ({ storyboardId, error }) => {
          if (!isActiveWorkflowRun(run)) return
          ElMessage.error(`分镜 #${storyboardId} 失败：${safeFreeCanvasError(error, '生成失败')}`)
        },
      })
      if (!isActiveWorkflowRun(run)) return
      await loadCanvasProject({
        blocking: false,
        preserveOnError: true,
        requestOptions: { signal: run.controller.signal, timeout: 15_000 },
      })
      if (!isActiveWorkflowRun(run)) return
      if (summary.failed.length) {
        ElMessage.warning(`完成 ${summary.ok.length} 镜，失败 ${summary.failed.length} 镜`)
      } else {
        ElMessage.success(`工作流执行完成，共 ${summary.ok.length} 镜`)
      }
    } catch (e) {
      if (e?.code === 'SUBMISSION_OUTCOME_UNKNOWN') workflowOutcomeUnknown.value = true
      if (isActiveWorkflowRun(run) && !isWorkflowAbortError(e)) {
        ElMessage.error(safeFreeCanvasError(e, '工作流执行失败'))
      }
    } finally {
      if (activeWorkflowRun.value === run) {
        activeWorkflowRun.value = null
        workflowRunning.value = false
        workflowProgress.value = ''
      }
    }
  }

  function cancelActiveWorkflow() {
    const run = activeWorkflowRun.value
    if (!workflowRunning.value || !run?.controller) return
    if (run.controller.signal.aborted) return
    workflowProgress.value = '正在取消…'
    run.controller.abort()
  }

  async function refreshUnknownWorkflowOutcome() {
    const loaded = await loadCanvasProject({ blocking: false, preserveOnError: true })
    if (!loaded) {
      ElMessage.warning('项目状态仍未刷新，请稍后重试')
      return
    }
    workflowOutcomeUnknown.value = false
    ElMessage.success('项目状态已刷新，可在确认媒体结果后决定是否重试')
  }

  return {
    onCreateWorkflowGroup,
    onDeleteActiveGroup,
    onRunActiveGroup,
    cancelActiveWorkflow,
    refreshUnknownWorkflowOutcome,
  }
}
