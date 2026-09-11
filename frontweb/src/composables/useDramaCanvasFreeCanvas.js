import { nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'

import { setFreeCanvasUxState } from '@/components/dramaCanvas/freeCanvasUx'

import { aiAPI } from '@/api/ai'
import { assetsAPI } from '@/api/assets'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { videosAPI } from '@/api/videos'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import {
  applyFreeCanvasConfigGenerationResult,
  buildFreeCanvasConfigResultDraft,
  collectFreeCanvasConfigGenerationInput,
  isFreeCanvasMockCapability,
  resolveFreeCanvasConfigGenerationOutcome,
  restoreFreeCanvasConfigOperationAfterReload,
} from '@/utils/freeCanvasConfigState'
import { getGenerationServiceCapability } from '@/utils/filmCreateActionState'
import {
  buildFreeCreateGenerationPayload,
  createFreeCreateTaskOwner,
  parseFreeCreateTaskResult,
  pollFreeCreateTask,
  toFreeCreateUserError,
} from '@/utils/freeCreate'
import {
  buildFreeCanvasAssetReferencePatch,
  buildFreeCanvasStoryboardMediaItems,
  getFreeCanvasAssetSaveEligibility,
  normalizeFreeCanvasMediaPath,
  resolveFreeCanvasMediaPath,
} from '@/utils/freeCanvasMedia'
import {
  createFreeEdge,
  createFreeNode,
  findFreeNodeSpawnPosition,
  removeFreeSelection,
  screenRectToFreeCanvasBounds,
  synchronizeFreeCanvasSelection,
} from '@/utils/freeCanvasState'
import { useDramaCanvasFreeCanvasClipboard } from './useDramaCanvasFreeCanvasClipboard.js'
import { useDramaCanvasFreeCanvasMedia } from './useDramaCanvasFreeCanvasMedia.js'

/** 把自由画布异常转成可展示的简体中文 */
export function safeFreeCanvasError(error, fallback) {
  return canvasUserError(error, fallback || '操作失败，请重试')
}

/** 自由画布操作：创建/更新/删除/选择/键盘/粘贴/拖放/转换/保存为素材 */
export function useDramaCanvasFreeCanvas(deps) {
  const {
    canvasMode,
    setCanvasMode,
    freeCanvas,
    freeCanvasReadOnly,
    nodes,
    edges,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    editingFreeNodeId,
    canvasMainRef,
    currentViewport,
    freeCanvasConfigRuntimeById,
    openAiConfig,
    commitFreeCanvasState,
    refreshProductionReadiness,
    refreshFreeCanvasVideoCapability,
    projectAssets,
    projectAssetsById,
    storyboardsById,
    drama,
    dramaId,
    canvasInstanceActive,
    freeMediaPickerVisible,
    freeLibraryVisible,
    freeCanvasUploading,
    freeCanvasUploadStatus,
    filterEpisodeId,
    imagesBySbId,
    videosBySbId,
    mediaStatusBySbId,
    freeStoryboardMediaItems,
    loadProjectAssets,
    loadForDrama,
    persistCanvasState,
    loadCanvasProject,
    mergeActiveCanvasGraphs,
    cancelScheduledCanvasSave,
    normalizeFreeCanvasForProject,
    contextMenuVisible,
    closeContextMenu,
    closeFreeCanvasInspector,
    undoFreeCanvas,
    redoFreeCanvas,
    claimCanvasEntityFocus,
    ownsCanvasEntityFocus,
    waitForFreeCanvasInspectorFocus,
    screenToFlowPosition,
    freeInspectorBusy,
    freeInspectorAction,
  } = deps

  let ignoreEmptyFreeSelectionUntil = 0

  function shouldIgnoreEmptyFreeSelection() {
    return Date.now() < ignoreEmptyFreeSelectionUntil
  }

  function markIgnoreEmptyFreeSelection() {
    ignoreEmptyFreeSelectionUntil = Date.now() + 1500
  }

  function isFreeCanvasNodeId(nodeId) {
    return freeCanvas.value.nodes.some((node) => String(node.id) === String(nodeId))
  }

  function freeCanvasSafeBounds() {
    const rect = canvasMainRef.value?.getBoundingClientRect?.()
    if (!rect) return undefined
    return screenRectToFreeCanvasBounds(rect, currentViewport.value, {
      insets: {
        left: 64,
        top: 24,
        right: 180 + (selectedFreeNodeId.value ? 0 : 380),
        bottom: 96,
      },
    })
  }

  function defaultFreeNodePosition(position = null) {
    const bounds = freeCanvasSafeBounds()
    const supplied = position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null
    const preferred = supplied || (bounds
      ? {
        x: bounds.left + Math.max(0, bounds.right - bounds.left - 280) / 2,
        y: bounds.top + Math.max(0, bounds.bottom - bounds.top - 208) / 2,
      }
      : { x: 80, y: 80 })
    return findFreeNodeSpawnPosition(preferred, nodes.value, { bounds })
      || findFreeNodeSpawnPosition(preferred, nodes.value)
  }

  function freeNodeDefaults(type) {
    const labels = {
      text: '文本灵感',
      image: '图片参考',
      video: '视频参考',
      config: '生成配置',
      reference: '制作引用',
    }
    return {
      title: labels[type] || '自由节点',
      ...(type === 'text' || type === 'config' ? { content: '' } : {}),
      ...(type === 'config' ? { status: 'idle' } : {}),
    }
  }

  function freeCanvasConfigRuntime(node) {
    if (node?.type !== 'config') return undefined
    return freeCanvasConfigRuntimeById.value.get(String(node.id))
  }

  function configureFreeCanvasNode(nodeId) {
    if (!isFreeCanvasNodeId(nodeId)) return
    openAiConfig(freeCanvasConfigRuntimeById.value.get(String(nodeId))?.serviceType || 'video', nodeId)
  }

  // 配置节点按节点跟踪生成任务，取消走真实 task cancel，刷新后不得把未完成任务标成成功。
  const configTaskOwners = new Map()
  const configGenerationEpochByNode = new Map()

  function getConfigTaskOwner(nodeId) {
    const key = String(nodeId)
    if (!configTaskOwners.has(key)) {
      configTaskOwners.set(key, createFreeCreateTaskOwner((taskId, body) => (
        taskAPI.cancel(taskId, body, { suppressErrorToast: true })
      )))
    }
    return configTaskOwners.get(key)
  }

  function findFreeCanvasConfigNode(nodeId) {
    return freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId)) || null
  }

  function mergeConfigMetadata(node, metadata = {}) {
    const next = {
      ...(node?.metadata && typeof node.metadata === 'object' ? node.metadata : {}),
      ...metadata,
    }
    if (!next.operationId) delete next.operationId
    if (!next.lastError) delete next.lastError
    return next
  }

  function setFreeCanvasConfigOperationState(nodeId, status, metadata = {}) {
    if (!['idle', 'running', 'failed', 'cancelled'].includes(status)) return false
    const node = findFreeCanvasConfigNode(nodeId)
    if (node?.type !== 'config') return false
    const nextMetadata = mergeConfigMetadata(node, metadata)
    const nextNodes = freeCanvas.value.nodes.map((item) => (
      String(item.id) === String(nodeId)
        ? { ...item, status, metadata: nextMetadata }
        : item
    ))
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `config:${status}:${nodeId}`)
    return true
  }

  function collectConfigGenerationInput(nodeId) {
    return collectFreeCanvasConfigGenerationInput(nodeId, freeCanvas.value, {
      resolveMediaPath: (node) => resolveFreeCanvasMediaPath(node, projectAssetsById.value),
    })
  }

  async function confirmFreeCanvasConfigCapability(serviceType) {
    const label = serviceType === 'video' ? '视频' : '图片'
    try {
      const raw = await aiAPI.list(serviceType, { suppressErrorToast: true })
      const configs = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : [])
      const capability = getGenerationServiceCapability(configs, serviceType)
      if (isFreeCanvasMockCapability(capability)) {
        return `${capability.config?.name || '当前预演配置'}仅用于流程预演，不会产生正式${label}。`
      }
      if (!capability.ready) {
        const reason = capability.reason || `${label}生成未就绪`
        return /AI 配置/.test(reason) ? reason : `${reason}请前往 AI 配置完成配置。`
      }
      return ''
    } catch (error) {
      return safeFreeCanvasError(error, `无法确认${label}模型配置，请刷新后重试或前往 AI 配置检查。`)
    }
  }

  async function waitForConfigCancellation(owner, run) {
    if (run?.cancelPromise) {
      try { await run.cancelPromise } catch (_) {}
    }
    return !owner.isActive(run)
  }

  function failConfigGenerationItem(item, message) {
    item.status = 'failed'
    item.error = toFreeCreateUserError(message, '生成失败，请稍后重试')
  }

  async function pollConfigGenerationTask(owner, run, item, taskId) {
    const isVideo = item.type === 'video'
    return pollFreeCreateTask({
      taskId,
      item,
      run,
      maxMs: isVideo ? 30 * 60 * 1000 : 180000,
      intervalMs: isVideo ? 4000 : 3000,
      waitForPendingCancellation: () => waitForConfigCancellation(owner, run),
      fetchTask: (id) => taskAPI.get(id, { suppressErrorToast: true }),
      failResultItem: failConfigGenerationItem,
      async resolveCompletedItem(res, current) {
        const parsed = parseFreeCreateTaskResult(res.result)
        let localPath = normalizeFreeCanvasMediaPath(parsed.local_path || '')
        current.localPath = localPath
        current.url = parsed.image_url || parsed.video_url || (localPath ? `/static/${localPath}` : null)
        const vgId = parsed.video_generation_id
        if (current.type === 'video' && vgId) {
          try {
            const video = await videosAPI.get(vgId)
            localPath = normalizeFreeCanvasMediaPath(video?.local_path || localPath)
            current.localPath = localPath
            current.url = localPath ? `/static/${localPath}` : (video?.video_url || current.url)
          } catch (error) {
            return { retry: true, error: toFreeCreateUserError(error, '视频结果读取失败') }
          }
        }
      },
    })
  }

  function attachConfigGenerationResult(nodeId, outcome, serviceType) {
    const configNode = findFreeCanvasConfigNode(nodeId)
    if (!configNode) return false
    if (!outcome.createResult) {
      const nextState = applyFreeCanvasConfigGenerationResult(freeCanvas.value, { nodeId, outcome })
      commitFreeCanvasState(nextState, `config:${outcome.status}:${nodeId}`)
      void persistCanvasState({ freeOnly: true, reportError: false })
      return false
    }
    if (freeCanvas.value.nodes.length >= 500) {
      const blocked = {
        status: 'failed',
        createResult: false,
        lastError: '自由画布已达到 500 个节点上限，生成结果未能加入画布',
        localPath: '',
      }
      commitFreeCanvasState(
        applyFreeCanvasConfigGenerationResult(freeCanvas.value, { nodeId, outcome: blocked }),
        `config:failed:${nodeId}`,
      )
      void persistCanvasState({ freeOnly: true, reportError: false })
      ElMessage.error(blocked.lastError)
      return false
    }
    const draft = buildFreeCanvasConfigResultDraft({
      configNode,
      serviceType,
      localPath: outcome.localPath,
    })
    const spawn = findFreeNodeSpawnPosition(draft.position, freeCanvas.value.nodes) || draft.position
    const resultNode = createFreeNode(draft.type, {
      title: draft.title,
      storageKey: draft.storageKey,
      content: draft.content,
      position: spawn,
    })
    const resultEdge = createFreeEdge(String(nodeId), resultNode.id, { type: 'default' })
    commitFreeCanvasState(
      applyFreeCanvasConfigGenerationResult(freeCanvas.value, {
        nodeId,
        outcome,
        resultNode,
        resultEdge,
      }),
      `config:result:${nodeId}`,
    )
    void persistCanvasState({ freeOnly: true, reportError: false })
    return true
  }

  /** 调用现有图片/视频 API 生成，并在成功后把结果节点接到画布上。 */
  async function generateFreeCanvasConfig(nodeId, options = {}) {
    const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
    const resumeTaskId = String(options.resumeTaskId || '').trim()
    if (!resumeTaskId) {
      if (!runtime) return
      if (!(runtime.canGenerate || runtime.status === 'failed' || runtime.status === 'cancelled')) return
      if (['blocked', 'checking', 'error', 'mock'].includes(runtime.status)) {
        ElMessage.warning(runtime.reason || '当前不能生成，请先完成 AI 配置')
        return
      }
    }
    const input = collectConfigGenerationInput(nodeId)
    if (!resumeTaskId && input.blockedReason) {
      ElMessage.warning(input.blockedReason)
      return
    }
    if (!resumeTaskId) {
      const capabilityReason = await confirmFreeCanvasConfigCapability(input.serviceType)
      if (capabilityReason) {
        ElMessage.warning(capabilityReason)
        return
      }
    }
    const owner = getConfigTaskOwner(nodeId)
    if (owner.hasActive() && !resumeTaskId) {
      ElMessage.warning('该配置节点已有生成任务正在运行')
      return
    }
    const requestedProjectId = Number(dramaId.value)
    const serviceType = input.serviceType
    let run
    try {
      run = owner.begin({ nodeId, serviceType })
    } catch (error) {
      ElMessage.warning(safeFreeCanvasError(error, '已有生成任务正在运行'))
      return
    }
    configGenerationEpochByNode.set(String(nodeId), run.ownerId)
    const startedAt = new Date().toISOString()
    setFreeCanvasConfigOperationState(nodeId, 'running', {
      startedAt,
      updatedAt: startedAt,
      lastError: '',
    })
    void persistCanvasState({ freeOnly: true, reportError: false })
    const item = {
      type: serviceType === 'video' ? 'video' : 'image',
      url: null,
      localPath: '',
      status: 'processing',
      error: null,
    }
    try {
      if (resumeTaskId) {
        run.taskId = resumeTaskId
        setFreeCanvasConfigOperationState(nodeId, 'running', {
          operationId: resumeTaskId,
          updatedAt: new Date().toISOString(),
        })
        await pollConfigGenerationTask(owner, run, item, resumeTaskId)
      } else {
        const body = buildFreeCreateGenerationPayload({
          mode: item.type,
          prompt: input.prompt,
          aspectRatio: '16:9',
          duration: 5,
          referenceUploadStatus: input.referenceImagePath ? 'success' : 'idle',
          referenceUploadError: '',
          referenceImageLocalPath: input.referenceImagePath,
        })
        const dramaIdValue = Number(dramaId.value)
        if (Number.isFinite(dramaIdValue) && dramaIdValue > 0) body.drama_id = dramaIdValue
        const submit = item.type === 'video' ? videosAPI.create(body) : imagesAPI.create(body)
        const res = await owner.trackSubmission(run, submit)
        if (await waitForConfigCancellation(owner, run)) {
          item.status = 'cancelled'
        } else if (res?.task_id) {
          setFreeCanvasConfigOperationState(nodeId, 'running', {
            operationId: String(res.task_id),
            updatedAt: new Date().toISOString(),
          })
          void persistCanvasState({ freeOnly: true, reportError: false })
          await pollConfigGenerationTask(owner, run, item, res.task_id)
        } else {
          const localPath = normalizeFreeCanvasMediaPath(res?.local_path || '')
          const url = res?.image_url || res?.video_url || (localPath ? `/static/${localPath}` : '')
          if (localPath) {
            item.localPath = localPath
            item.url = url
            item.status = 'completed'
          } else {
            failConfigGenerationItem(item, item.type === 'video' ? '提交成功但未返回视频任务或结果' : '提交成功但未返回图片任务或结果')
          }
        }
      }
    } catch (error) {
      if (run.cancelRequested || run.cancelConfirmed) {
        item.status = 'cancelled'
      } else {
        failConfigGenerationItem(item, error)
      }
    } finally {
      owner.complete(run)
    }

    if (!canvasInstanceActive.value || requestedProjectId !== Number(dramaId.value)) return
    if (configGenerationEpochByNode.get(String(nodeId)) !== run.ownerId) return
    const current = findFreeCanvasConfigNode(nodeId)
    const outcome = resolveFreeCanvasConfigGenerationOutcome({
      cancelRequested: run.cancelRequested,
      cancelConfirmed: run.cancelConfirmed,
      nodeStatus: current?.status,
      itemStatus: item.status,
      resultPath: item.localPath,
      resultUrl: item.url,
      error: item.error,
    })
    const attached = attachConfigGenerationResult(nodeId, outcome, serviceType)
    if (configGenerationEpochByNode.get(String(nodeId)) === run.ownerId) {
      configGenerationEpochByNode.delete(String(nodeId))
    }
    if (outcome.status === 'cancelled') {
      if (!run.cancelRequested && !run.cancelConfirmed) ElMessage.warning('生成已取消')
      return
    }
    if (outcome.status === 'failed') {
      ElMessage.error(outcome.lastError || '生成失败，请稍后重试')
      return
    }
    if (attached) {
      ElMessage.success(serviceType === 'video' ? '已生成视频并添加到画布' : '已生成图片并添加到画布')
    }
  }

  async function cancelFreeCanvasConfig(nodeId) {
    const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
    if (!runtime?.canCancel) return
    const node = findFreeCanvasConfigNode(nodeId)
    const owner = configTaskOwners.get(String(nodeId))
    const activeRun = owner?.getActive?.()
    try {
      if (activeRun) {
        await owner.cancel('用户停止等待')
        setFreeCanvasConfigOperationState(nodeId, 'cancelled', {
          ...(activeRun.taskId ? { operationId: String(activeRun.taskId) } : {}),
          updatedAt: new Date().toISOString(),
        })
        ElMessage.warning('已停止等待；已提交任务可能继续执行并产生供应商计费')
      } else if (node?.metadata?.operationId) {
        await taskAPI.cancel(node.metadata.operationId, { reason: '用户停止等待' }, { suppressErrorToast: true })
        setFreeCanvasConfigOperationState(nodeId, 'cancelled', {
          operationId: node.metadata.operationId,
          updatedAt: new Date().toISOString(),
        })
        ElMessage.warning('已停止等待；已提交任务可能继续执行并产生供应商计费')
      } else {
        setFreeCanvasConfigOperationState(nodeId, 'cancelled', {
          updatedAt: new Date().toISOString(),
        })
        ElMessage.warning('已停止等待；已提交任务可能继续执行并产生供应商计费')
      }
    } catch (error) {
      ElMessage.error(safeFreeCanvasError(error, '取消生成失败，请稍后重试'))
    }
  }

  async function retryFreeCanvasConfig(nodeId) {
    const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
    if (!runtime) return
    if (runtime.canGenerate || runtime.status === 'failed' || runtime.status === 'cancelled') {
      await generateFreeCanvasConfig(nodeId)
      return
    }
    if (!runtime.canRetry) return
    await Promise.all([refreshProductionReadiness(), refreshFreeCanvasVideoCapability()])
  }

  async function resumeRunningFreeCanvasConfigTasks() {
    for (const node of freeCanvas.value.nodes) {
      if (node?.type !== 'config') continue
      const owner = getConfigTaskOwner(node.id)
      if (owner.hasActive()) continue
      const restored = restoreFreeCanvasConfigOperationAfterReload(node)
      if (restored.status === 'failed' && node.status === 'running' && !restored.resume) {
        setFreeCanvasConfigOperationState(node.id, 'failed', {
          lastError: restored.lastError,
          updatedAt: new Date().toISOString(),
        })
        continue
      }
      if (!restored.resume) continue
      void generateFreeCanvasConfig(node.id, { resumeTaskId: restored.operationId })
    }
  }


  async function createFreeCanvasNode(type, position = null, overrides = {}) {
    if (!['text', 'image', 'video', 'config', 'reference'].includes(type)) return null
    if (canvasMode.value !== 'free') await setCanvasMode('free')
    if (canvasMode.value !== 'free') return null
    if (freeCanvas.value.nodes.length >= 500) {
      ElMessage.warning('自由画布已达到 500 个节点上限，请先整理后再添加')
      return null
    }
    if (freeCanvas.value.nodes.length >= 400) {
      ElMessage.warning(`自由画布节点较多（${freeCanvas.value.nodes.length}/500），继续添加可能影响操作流畅度`)
    }

    const spawnPosition = defaultFreeNodePosition(position)
    if (!spawnPosition) {
      ElMessage.warning('当前可见区域没有足够的空位，请移动或缩放画布后重试')
      return null
    }
    const node = createFreeNode(type, {
      ...freeNodeDefaults(type),
      ...overrides,
      position: spawnPosition,
    })
    selectedFreeNodeId.value = node.id
    selectedFreeNodeIds.value = [node.id]
    selectedFreeEdgeIds.value = []
    ignoreEmptyFreeSelectionUntil = Date.now() + 1500
    commitFreeCanvasState({
      ...freeCanvas.value,
      nodes: [...freeCanvas.value.nodes, node],
    }, `create:${type}`)
    return node
  }

  function updateFreeCanvasNode(payload = {}) {
    const nodeId = payload.id
    if (!isFreeCanvasNodeId(nodeId)) return
    const allowed = ['title', 'content', 'storyboard_ref']
    const patch = Object.fromEntries(
      allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]),
    )
    const nextNodes = freeCanvas.value.nodes.map((node) => {
      if (String(node.id) !== String(nodeId)) return node
      const assetPatch = Object.prototype.hasOwnProperty.call(payload, 'asset_ref')
        ? buildFreeCanvasAssetReferencePatch(node, payload.asset_ref, projectAssetsById.value)
        : {}
      const nextNode = { ...node, ...patch, ...assetPatch }
      if ((node.type === 'image' || node.type === 'video') && !String(nextNode.content || '').trim()) {
        delete nextNode.content
      }
      return nextNode
    })
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `text:${nodeId}`)
  }

  function updateFreeNodeContent(payload = {}) {
    const nodeId = payload.id
    if (!isFreeCanvasNodeId(nodeId)) return
    const nextNodes = freeCanvas.value.nodes.map((node) => (
      String(node.id) === String(nodeId) ? { ...node, content: String(payload.content || '') } : node
    ))
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `text:${nodeId}`)
  }

  function activateFreeCanvasNode(nodeId, { focusInspector = true, ownership = null } = {}) {
    if (!isFreeCanvasNodeId(nodeId)) return
    const focusOwnership = ownership || (focusInspector ? claimCanvasEntityFocus(nodeId) : null)
    if (focusOwnership && !ownsCanvasEntityFocus(focusOwnership)) return
    const selection = synchronizeFreeCanvasSelection(nodes.value, nodeId)
    nodes.value = selection.nodes
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
    selectedFreeNodeIds.value = selection.nodeIds
    selectedFreeEdgeIds.value = selection.edgeIds
    selectedFreeNodeId.value = selection.focusedNodeId
    if (!focusInspector) return
    void waitForFreeCanvasInspectorFocus(focusOwnership)
  }

  function openFreeCanvasInspectorFor(nodeId) {
    activateFreeCanvasNode(nodeId)
  }

  function startFreeCanvasNodeEditing(nodeId) {
    const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId))
    if (canvasMode.value !== 'free' || freeCanvasReadOnly.value || node?.type !== 'text') return
    editingFreeNodeId.value = node.id
    void nextTick(() => {
      const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
        .find((element) => element.dataset.id === String(node.id))
      const textarea = nodeElement?.querySelector('.node-editor textarea')
      textarea?.focus({ preventScroll: true })
      textarea?.select?.()
    })
  }

  function finishFreeCanvasNodeEditing(exceptNodeId = null) {
    if (exceptNodeId != null && String(editingFreeNodeId.value) === String(exceptNodeId)) return
    editingFreeNodeId.value = null
  }

  async function focusFreeCanvasNodeTrigger(nodeId) {
    if (!nodeId) return
    await nextTick()
    const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
      .find((element) => element.dataset.id === String(nodeId))
    nodeElement?.querySelector('.free-canvas-node')?.focus({ preventScroll: true })
  }

  function removeFreeCanvasItems(nodeIds = [], edgeIds = []) {
    const withoutNodes = removeFreeSelection(freeCanvas.value, nodeIds)
    const removedEdges = new Set(edgeIds.map(String))
    const nextState = normalizeFreeCanvasForProject({
      ...withoutNodes,
      edges: withoutNodes.edges.filter((edge) => !removedEdges.has(String(edge.id))),
    })
    if (
      nextState.nodes.length === freeCanvas.value.nodes.length
      && nextState.edges.length === freeCanvas.value.edges.length
    ) return false
    commitFreeCanvasState(nextState, 'delete')
    return true
  }

  /** 删除前弹出中文确认，避免快捷键或误点直接丢掉节点 */
  async function confirmFreeCanvasDeletion({ nodeIds = [], edgeIds = [] } = {}) {
    const nodeCount = (nodeIds || []).length
    const edgeCount = (edgeIds || []).length
    if (!nodeCount && !edgeCount) return false
    let subject = '所选内容'
    if (nodeCount && !edgeCount) {
      subject = nodeCount === 1 ? '该节点' : ('所选 ' + nodeCount + ' 个节点')
    } else if (!nodeCount && edgeCount) {
      subject = edgeCount === 1 ? '该连线' : ('所选 ' + edgeCount + ' 条连线')
    } else {
      subject = '所选 ' + nodeCount + ' 个节点和 ' + edgeCount + ' 条连线'
    }
    try {
      await ElMessageBox.confirm(
        '确定删除' + subject + '？此操作不可恢复。',
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
      return true
    } catch {
      return false
    }
  }

  async function deleteFreeCanvasNode(nodeId) {
    if (!isFreeCanvasNodeId(nodeId)) return false
    if (!await confirmFreeCanvasDeletion({ nodeIds: [nodeId] })) return false
    return removeFreeCanvasItems([nodeId])
  }

  function readDomSelectedFreeNodeIds() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []
    return [...document.querySelectorAll('.vue-flow__node.selected [data-free-node-id], .free-canvas-node[data-free-node-id]')]
      .filter((element) => element.closest?.('.vue-flow__node.selected'))
      .map((element) => element.getAttribute('data-free-node-id'))
      .filter((id) => isFreeCanvasNodeId(id))
  }

  function currentVisualFreeCanvasSelection() {
    const nodeIds = nodes.value
      .filter((node) => node.selected && isFreeCanvasNodeId(node.id))
      .map((node) => node.id)
    const freeEdgeIds = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
    const edgeIds = edges.value
      .filter((edge) => edge.selected && freeEdgeIds.has(String(edge.id)))
      .map((edge) => edge.id)
    if (nodeIds.length || edgeIds.length) return { nodeIds, edgeIds }
    const existingNodes = new Set(freeCanvas.value.nodes.map((node) => String(node.id)))
    const existingEdges = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
    const internalNodeIds = selectedFreeNodeIds.value.filter((id) => existingNodes.has(String(id)))
    const internalEdgeIds = selectedFreeEdgeIds.value.filter((id) => existingEdges.has(String(id)))
    if (internalNodeIds.length || internalEdgeIds.length) {
      return { nodeIds: internalNodeIds, edgeIds: internalEdgeIds }
    }
    const domNodeIds = [...new Set(readDomSelectedFreeNodeIds())].filter((id) => existingNodes.has(String(id)))
    return {
      nodeIds: domNodeIds.map((id) => freeCanvas.value.nodes.find((node) => String(node.id) === String(id))?.id).filter(Boolean),
      edgeIds: [],
    }
  }

  function syncVisualFreeCanvasSelection() {
    const selection = currentVisualFreeCanvasSelection()
    selectedFreeNodeIds.value = selection.nodeIds
    selectedFreeEdgeIds.value = selection.edgeIds
    selectedFreeNodeId.value = selection.nodeIds.length === 1 ? selection.nodeIds[0] : null
    return selection
  }

  async function deleteFreeCanvasSelection() {
    const { nodeIds, edgeIds } = syncVisualFreeCanvasSelection()
    if (!await confirmFreeCanvasDeletion({ nodeIds, edgeIds })) return false
    const removed = removeFreeCanvasItems(nodeIds, edgeIds)
    if (removed) {
      cancelScheduledCanvasSave()
      void persistCanvasState({ freeOnly: true })
    }
    return removed
  }

  function retryFreeCanvasNode(nodeId) {
    if (!isFreeCanvasNodeId(nodeId)) return
    void loadProjectAssets(dramaId.value).then(() => {
      mergeActiveCanvasGraphs()
      ElMessage.success('节点引用已重新加载')
    })
  }

  function isValidFreeConnection(connection = {}) {
    return canvasMode.value === 'free'
      && connection.source !== connection.target
      && isFreeCanvasNodeId(connection.source)
      && isFreeCanvasNodeId(connection.target)
  }

  function onFreeCanvasConnect(connection) {
    if (!isValidFreeConnection(connection)) return
    const exists = freeCanvas.value.edges.some((edge) => (
      String(edge.source) === String(connection.source)
      && String(edge.target) === String(connection.target)
    ))
    if (exists) return
    if (freeCanvas.value.edges.length >= 1000) {
      ElMessage.warning('自由画布已达到 1000 条连线上限')
      return
    }
    const edge = createFreeEdge(String(connection.source), String(connection.target), {
      type: 'default',
    })
    commitFreeCanvasState({
      ...freeCanvas.value,
      edges: [...freeCanvas.value.edges, edge],
    }, 'connect')
  }


  const {
    resolveFreeCanvasNodeMediaUrl,
    openFreeCanvasMediaPicker,
    toggleFreeCanvasLibrary,
    createFreeEntityReference,
    createFreeNodeFromLibraryItem,
    onFreeCanvasMediaPicked,
    createFreeNodeFromAsset,
    uploadFreeCanvasFiles,
    onFreeCanvasDragOver,
    onFreeCanvasDrop,
  } = useDramaCanvasFreeCanvasMedia({
    canvasMode,
    dramaId,
    canvasInstanceActive,
    freeMediaPickerVisible,
    freeLibraryVisible,
    freeCanvasUploading,
    freeCanvasUploadStatus,
    projectAssets,
    projectAssetsById,
    freeStoryboardMediaItems,
    createFreeCanvasNode,
    screenToFlowPosition,
    safeFreeCanvasError,
  })

  const {
    resetFreeCanvasClipboard,
    isTypingTarget,
    isEditableKeyTarget,
    selectAllFreeCanvasNodes,
    copyFreeCanvasSelection,
    pasteFreeCanvasSelection,
    handleFreeCanvasKeydown,
    alignFreeCanvasSelection,
    convertFreeCanvasReference,
  } = useDramaCanvasFreeCanvasClipboard({
    canvasMode,
    freeCanvas,
    freeCanvasReadOnly,
    nodes,
    edges,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    drama,
    dramaId,
    storyboardsById,
    projectAssetsById,
    contextMenuVisible,
    closeContextMenu,
    closeFreeCanvasInspector,
    finishFreeCanvasNodeEditing,
    activateFreeCanvasNode,
    isFreeCanvasNodeId,
    currentVisualFreeCanvasSelection,
    syncVisualFreeCanvasSelection,
    deleteFreeCanvasSelection,
    undoFreeCanvas,
    redoFreeCanvas,
    commitFreeCanvasState,
    loadCanvasProject,
    freeInspectorBusy,
    freeInspectorAction,
    markIgnoreEmptyFreeSelection,
    safeFreeCanvasError,
  })

  watch(
    () => freeCanvas.value.nodes
      .filter((node) => node?.type === 'config' && node.status === 'running')
      .map((node) => `${node.id}:${node.metadata?.operationId || ''}`)
      .join('|'),
    () => { void resumeRunningFreeCanvasConfigTasks() },
    { immediate: true },
  )

  watch(
    () => [
      freeCanvas.value.nodes.length,
      selectedFreeNodeIds.value.length,
      Boolean(freeCanvasReadOnly.value),
      canvasMode.value,
    ],
    ([nodeCount, selectionCount, readonly, mode]) => {
      setFreeCanvasUxState({
        nodeCount,
        selectionCount,
        readonly,
        canvasMode: mode,
        alignSelection: alignFreeCanvasSelection,
      })
    },
    { immediate: true },
  )

  async function saveFreeCanvasNodeAsAsset(payload = {}) {
    if (freeInspectorBusy.value) return
    const requestedProjectId = Number(dramaId.value)
    let node = freeCanvas.value.nodes.find((item) => String(item.id) === String(payload.id))
    if (!node) return
    const currentEligibility = (candidate) => getFreeCanvasAssetSaveEligibility(candidate, {
      projectId: requestedProjectId,
      inventory: [
        ...buildFreeCanvasStoryboardMediaItems(drama.value, {
          imagesBySbId: imagesBySbId.value,
          videosBySbId: videosBySbId.value,
          mediaStatusBySbId: mediaStatusBySbId.value,
        }),
        ...projectAssets.value,
      ],
    })
    const initialEligibility = currentEligibility(node)
    if (!initialEligibility.eligible) {
      ElMessage.warning(initialEligibility.reason)
      return
    }

    freeInspectorBusy.value = true
    freeInspectorAction.value = 'save-asset'
    try {
      await Promise.all([
        loadProjectAssets(requestedProjectId),
        loadForDrama(drama.value, filterEpisodeId.value),
      ])
      if (!canvasInstanceActive.value || requestedProjectId !== Number(dramaId.value)) return
      node = freeCanvas.value.nodes.find((item) => String(item.id) === String(payload.id))
      if (!node) return
      const eligibility = currentEligibility(node)
      if (!eligibility.eligible) {
        ElMessage.warning(eligibility.reason)
        return
      }
      const mediaReference = eligibility.path
      const saved = await persistCanvasState({ freeOnly: true, reportError: false })
      if (!saved.ok) {
        ElMessage.error(safeFreeCanvasError(saved.error, '画布保存失败，暂时无法创建素材'))
        return
      }
      const asset = await assetsAPI.create({
        drama_id: Number(dramaId.value),
        name: node.title || (node.type === 'video' ? '自由画布视频' : '自由画布图片'),
        type: node.type,
        url: `/static/${mediaReference}`,
        local_path: mediaReference,
      })
      if (!asset?.id || Number(asset.drama_id) !== Number(dramaId.value)) {
        throw new Error('素材创建结果不属于当前项目')
      }
      projectAssets.value = [
        asset,
        ...projectAssets.value.filter((item) => Number(item.id) !== Number(asset.id)),
      ]
      const nextNodes = freeCanvas.value.nodes.map((item) => (
        String(item.id) === String(node.id)
          ? { ...item, asset_ref: asset.id, assetId: asset.id, storageKey: mediaReference }
          : item
      ))
      commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, 'save-asset')
      ElMessage.success('已保存到当前项目素材库')
    } catch (error) {
      if (isCanvasUserAbort(error)) return
      ElMessage.error(safeFreeCanvasError(error, '素材保存失败，请重试'))
    } finally {
      freeInspectorBusy.value = false
      freeInspectorAction.value = ''
    }
  }

  return {
    isFreeCanvasNodeId,
    shouldIgnoreEmptyFreeSelection,
    resetFreeCanvasClipboard,
    freeCanvasSafeBounds,
    defaultFreeNodePosition,
    freeNodeDefaults,
    freeCanvasConfigRuntime,
    configureFreeCanvasNode,
    setFreeCanvasConfigOperationState,
    cancelFreeCanvasConfig,
    retryFreeCanvasConfig,
    generateFreeCanvasConfig,
    createFreeCanvasNode,
    updateFreeCanvasNode,
    updateFreeNodeContent,
    activateFreeCanvasNode,
    openFreeCanvasInspectorFor,
    startFreeCanvasNodeEditing,
    finishFreeCanvasNodeEditing,
    focusFreeCanvasNodeTrigger,
    removeFreeCanvasItems,
    deleteFreeCanvasNode,
    readDomSelectedFreeNodeIds,
    currentVisualFreeCanvasSelection,
    syncVisualFreeCanvasSelection,
    deleteFreeCanvasSelection,
    retryFreeCanvasNode,
    isValidFreeConnection,
    onFreeCanvasConnect,
    resolveFreeCanvasNodeMediaUrl,
    openFreeCanvasMediaPicker,
    toggleFreeCanvasLibrary,
    createFreeEntityReference,
    createFreeNodeFromLibraryItem,
    onFreeCanvasMediaPicked,
    createFreeNodeFromAsset,
    uploadFreeCanvasFiles,
    onFreeCanvasDragOver,
    onFreeCanvasDrop,
    isTypingTarget,
    isEditableKeyTarget,
    selectAllFreeCanvasNodes,
    copyFreeCanvasSelection,
    pasteFreeCanvasSelection,
    handleFreeCanvasKeydown,
    alignFreeCanvasSelection,
    convertFreeCanvasReference,
    saveFreeCanvasNodeAsAsset,
  }
}
