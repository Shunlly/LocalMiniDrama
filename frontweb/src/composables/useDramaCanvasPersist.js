import { ref } from 'vue'
import { ElMessage } from 'element-plus'

import { dramaAPI } from '@/api/drama'
import {
  buildCanvasLayoutPayload,
  parseDramaMetadata,
} from '@/utils/canvasLayout'
import { createCanvasSaveCoordinator } from '@/utils/canvasSaveCoordinator'
import { serializeFreeCanvas } from '@/utils/freeCanvasState'
import { runWithOwnedRequestErrorToast } from '@/utils/request.js'

/** 画布布局、工作流分组和自由画布的保存队列、失败合并与重试 */
export function useDramaCanvasPersist(deps) {
  const {
    canvasProjectId,
    canvasInstanceActive,
    dramaId,
    drama,
    nodes,
    currentViewport,
    productionViewport,
    freeCanvas,
    freeCanvasReadOnly,
    canvasMode,
    layoutCache,
    workflowGroups,
    normalizeFreeCanvasForProject,
    mergeActiveCanvasGraphs,
    freeCanvasUiMode,
    safeFreeCanvasError,
  } = deps

  const layoutSaveState = ref('idle')
  const layoutSaveError = ref('')
  const failedCanvasSaveOperation = ref(null)
  const layoutDirty = ref(false)
  let saveTimer = null
  let savedHintTimer = null
  let canvasMutationRevision = 0
  let canvasSaveOperationId = 0
  let canvasSaveChain = Promise.resolve()
  const canvasSaveCoordinator = createCanvasSaveCoordinator()

  function scheduleLayoutSave() {
    layoutDirty.value = true
    canvasMutationRevision += 1
    cancelScheduledCanvasSave()
    const scheduledProjectId = canvasProjectId.value
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (Number(scheduledProjectId) !== Number(canvasProjectId.value)) return
      persistCanvasState({ layoutOnly: true })
    }, 700)
  }

  function cancelScheduledCanvasSave() {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
  }

  function beginCanvasSaveSettlement(projectId) {
    return canvasSaveCoordinator.begin(Number(projectId))
  }

  function hasPendingCanvasSaves(projectId) {
    return canvasSaveCoordinator.hasPending(Number(projectId))
  }

  async function waitForCanvasSaveSettlement(projectId) {
    while (hasPendingCanvasSaves(projectId)) {
      await canvasSaveCoordinator.waitForSettlement(Number(projectId))
    }
  }

  function mergeFailedCanvasSaveOperations(previous, incoming) {
    if (!previous || Number(previous.targetDramaId) !== Number(incoming.targetDramaId)) {
      return incoming
    }
    const writesLayout = Boolean(previous.writesLayout || incoming.writesLayout)
    const writesGroups = Boolean(previous.writesGroups || incoming.writesGroups)
    const writesFreeCanvas = Boolean(previous.writesFreeCanvas || incoming.writesFreeCanvas)
    return Object.freeze({
      targetDramaId: incoming.targetDramaId,
      saveRevision: Math.max(Number(previous.saveRevision) || 0, Number(incoming.saveRevision) || 0),
      operationId: incoming.operationId,
      layoutOnly: writesLayout && !writesGroups,
      groupsOnly: writesGroups && !writesLayout && !writesFreeCanvas,
      freeOnly: writesFreeCanvas && !writesLayout && !writesGroups,
      writesLayout,
      writesGroups,
      writesFreeCanvas,
      layoutOperationId: incoming.writesLayout
        ? incoming.layoutOperationId
        : previous.layoutOperationId,
      groupsOperationId: incoming.writesGroups
        ? incoming.groupsOperationId
        : previous.groupsOperationId,
      freeCanvasOperationId: incoming.writesFreeCanvas
        ? incoming.freeCanvasOperationId
        : previous.freeCanvasOperationId,
      layoutError: incoming.writesLayout ? incoming.layoutError : previous.layoutError,
      groupsError: incoming.writesGroups ? incoming.groupsError : previous.groupsError,
      freeCanvasError: incoming.writesFreeCanvas
        ? incoming.freeCanvasError
        : previous.freeCanvasError,
      layoutPayload: incoming.writesLayout ? incoming.layoutPayload : previous.layoutPayload,
      groupsPayload: incoming.writesGroups ? incoming.groupsPayload : previous.groupsPayload,
      freeCanvasPayload: incoming.writesFreeCanvas
        ? incoming.freeCanvasPayload
        : previous.freeCanvasPayload,
    })
  }

  function canvasSaveOperationError(operation) {
    if (!operation) return ''
    const candidates = [
      operation.writesLayout && operation.layoutError
        ? { id: operation.layoutOperationId, message: operation.layoutError }
        : null,
      operation.writesGroups && operation.groupsError
        ? { id: operation.groupsOperationId, message: operation.groupsError }
        : null,
      operation.writesFreeCanvas && operation.freeCanvasError
        ? { id: operation.freeCanvasOperationId, message: operation.freeCanvasError }
        : null,
    ].filter(Boolean)
    candidates.sort((left, right) => (Number(right.id) || 0) - (Number(left.id) || 0))
    return candidates[0]?.message || ''
  }

  function subtractSuccessfulCanvasSaveOperation(failed, successful) {
    if (
      !failed
      || Number(failed.targetDramaId) !== Number(successful.targetDramaId)
      || Number(successful.saveRevision) < Number(failed.saveRevision)
    ) {
      return failed
    }
    const writesLayout = Boolean(failed.writesLayout && !successful.writesLayout)
    const writesGroups = Boolean(failed.writesGroups && !successful.writesGroups)
    const writesFreeCanvas = Boolean(failed.writesFreeCanvas && !successful.writesFreeCanvas)
    if (!writesLayout && !writesGroups && !writesFreeCanvas) return null
    return Object.freeze({
      ...failed,
      layoutOnly: writesLayout && !writesGroups,
      groupsOnly: writesGroups && !writesLayout && !writesFreeCanvas,
      freeOnly: writesFreeCanvas && !writesLayout && !writesGroups,
      writesLayout,
      writesGroups,
      writesFreeCanvas,
      layoutOperationId: writesLayout ? failed.layoutOperationId : undefined,
      groupsOperationId: writesGroups ? failed.groupsOperationId : undefined,
      freeCanvasOperationId: writesFreeCanvas ? failed.freeCanvasOperationId : undefined,
      layoutError: writesLayout ? failed.layoutError : undefined,
      groupsError: writesGroups ? failed.groupsError : undefined,
      freeCanvasError: writesFreeCanvas ? failed.freeCanvasError : undefined,
      layoutPayload: writesLayout ? failed.layoutPayload : undefined,
      groupsPayload: writesGroups ? failed.groupsPayload : undefined,
      freeCanvasPayload: writesFreeCanvas ? failed.freeCanvasPayload : undefined,
    })
  }

  function abandonCanvasSaveOperation(operation) {
    const failed = failedCanvasSaveOperation.value
    if (!failed || Number(failed.targetDramaId) !== Number(operation?.targetDramaId)) return
    const writesLayout = Boolean(
      failed.writesLayout
      && (!operation.writesLayout || failed.layoutOperationId !== operation.layoutOperationId),
    )
    const writesGroups = Boolean(
      failed.writesGroups
      && (!operation.writesGroups || failed.groupsOperationId !== operation.groupsOperationId),
    )
    const writesFreeCanvas = Boolean(
      failed.writesFreeCanvas
      && (!operation.writesFreeCanvas || failed.freeCanvasOperationId !== operation.freeCanvasOperationId),
    )
    if (!writesLayout && !writesGroups && !writesFreeCanvas) {
      failedCanvasSaveOperation.value = null
      layoutSaveState.value = 'idle'
      layoutSaveError.value = ''
      return
    }
    failedCanvasSaveOperation.value = Object.freeze({
      ...failed,
      layoutOnly: writesLayout && !writesGroups,
      groupsOnly: writesGroups && !writesLayout && !writesFreeCanvas,
      freeOnly: writesFreeCanvas && !writesLayout && !writesGroups,
      writesLayout,
      writesGroups,
      writesFreeCanvas,
      layoutOperationId: writesLayout ? failed.layoutOperationId : undefined,
      groupsOperationId: writesGroups ? failed.groupsOperationId : undefined,
      freeCanvasOperationId: writesFreeCanvas ? failed.freeCanvasOperationId : undefined,
      layoutError: writesLayout ? failed.layoutError : undefined,
      groupsError: writesGroups ? failed.groupsError : undefined,
      freeCanvasError: writesFreeCanvas ? failed.freeCanvasError : undefined,
      layoutPayload: writesLayout ? failed.layoutPayload : undefined,
      groupsPayload: writesGroups ? failed.groupsPayload : undefined,
      freeCanvasPayload: writesFreeCanvas ? failed.freeCanvasPayload : undefined,
    })
    const remainingError = canvasSaveOperationError(failedCanvasSaveOperation.value)
    if (remainingError) layoutSaveError.value = remainingError
  }

  async function persistCanvasState({
    layoutOnly = false,
    groupsOnly = false,
    freeOnly = false,
    reportError = true,
    allowDuringTeardown = false,
    retryOperation = null,
  } = {}) {
    const retainedOperation = retryOperation && typeof retryOperation === 'object'
      ? retryOperation
      : null
    const targetDramaId = retainedOperation?.targetDramaId ?? canvasProjectId.value
    const requestAccepted = canvasInstanceActive.value || allowDuringTeardown
    if (
      !requestAccepted
      || !targetDramaId
      || Number(targetDramaId) !== Number(canvasProjectId.value)
      || Number(targetDramaId) !== Number(drama.value?.id)
    ) {
      return { ok: false, cancelled: true }
    }
    if (!dramaId.value) {
      return { ok: false, error: new Error('项目尚未加载') }
    }

    const effectiveLayoutOnly = retainedOperation?.layoutOnly ?? layoutOnly
    const effectiveGroupsOnly = retainedOperation?.groupsOnly ?? groupsOnly
    const effectiveFreeOnly = retainedOperation?.freeOnly ?? freeOnly
    const saveRevision = retainedOperation?.saveRevision ?? canvasMutationRevision
    const snapshot = (value) => (
      value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    )
    let layoutPayload = null
    let groupsPayload
    let freeCanvasPayload
    let saveOperation = retainedOperation
    if (!saveOperation) {
      const operationId = ++canvasSaveOperationId
      if (!effectiveGroupsOnly && !effectiveFreeOnly) {
        layoutPayload = buildCanvasLayoutPayload(nodes.value, productionViewport.value, layoutCache.value)
        if (effectiveLayoutOnly && layoutPayload) layoutCache.value = layoutPayload
      }
      groupsPayload = effectiveGroupsOnly || (!effectiveLayoutOnly && !effectiveFreeOnly)
        ? workflowGroups.value
        : undefined
      freeCanvasPayload = effectiveGroupsOnly || freeCanvasReadOnly.value
        ? undefined
        : serializeFreeCanvas({
          ...freeCanvas.value,
          mode: canvasMode.value,
          ...(canvasMode.value === 'free' ? { viewport: currentViewport.value } : {}),
        })
      saveOperation = Object.freeze({
        targetDramaId,
        saveRevision,
        operationId,
        layoutOnly: effectiveLayoutOnly,
        groupsOnly: effectiveGroupsOnly,
        freeOnly: effectiveFreeOnly,
        writesLayout: !effectiveGroupsOnly && !effectiveFreeOnly,
        writesGroups: effectiveGroupsOnly || (!effectiveLayoutOnly && !effectiveFreeOnly),
        writesFreeCanvas: !effectiveGroupsOnly && !freeCanvasReadOnly.value,
        layoutOperationId: !effectiveGroupsOnly && !effectiveFreeOnly ? operationId : undefined,
        groupsOperationId: effectiveGroupsOnly || (!effectiveLayoutOnly && !effectiveFreeOnly)
          ? operationId
          : undefined,
        freeCanvasOperationId: !effectiveGroupsOnly && !freeCanvasReadOnly.value
          ? operationId
          : undefined,
        layoutPayload: snapshot(layoutPayload),
        groupsPayload: snapshot(groupsPayload),
        freeCanvasPayload: snapshot(freeCanvasPayload),
      })
    }
    layoutPayload = saveOperation.layoutPayload
    groupsPayload = saveOperation.groupsPayload
    freeCanvasPayload = saveOperation.freeCanvasPayload

    layoutSaveState.value = 'saving'
    const completeSaveSettlement = beginCanvasSaveSettlement(targetDramaId)
    try {
      const runSave = () => {
        if (retainedOperation && failedCanvasSaveOperation.value !== saveOperation) return null
        return runWithOwnedRequestErrorToast(
          () => dramaAPI.saveCanvasLayout(targetDramaId, layoutPayload, groupsPayload, freeCanvasPayload),
        )
      }
      const queuedSave = canvasSaveChain.then(runSave, runSave)
      canvasSaveChain = queuedSave.catch(() => null)
      const updated = await queuedSave
      if (!updated) {
        if (failedCanvasSaveOperation.value) layoutSaveState.value = 'error'
        else if (layoutSaveState.value === 'saving') layoutSaveState.value = 'idle'
        return { ok: false, cancelled: true }
      }
      if (
        Number(targetDramaId) !== Number(canvasProjectId.value)
        || Number(targetDramaId) !== Number(drama.value?.id)
      ) {
        return { ok: false, cancelled: true }
      }
      if (!canvasInstanceActive.value) {
        return allowDuringTeardown
          ? { ok: true, updated, teardown: true }
          : { ok: false, cancelled: true }
      }
      const meta = parseDramaMetadata(updated.metadata)
      if (meta.canvas_layout) layoutCache.value = meta.canvas_layout
      if (meta.workflow_groups) workflowGroups.value = meta.workflow_groups
      if (
        !freeCanvasReadOnly.value
        && meta.free_canvas
        && freeCanvasPayload
        && JSON.stringify(serializeFreeCanvas(freeCanvas.value)) === JSON.stringify(freeCanvasPayload)
      ) {
        freeCanvas.value = normalizeFreeCanvasForProject(meta.free_canvas)
        canvasMode.value = freeCanvasUiMode(freeCanvas.value.mode)
        mergeActiveCanvasGraphs()
      }
      // 仅合并 metadata / 时间戳，勿用精简对象覆盖 episodes、characters 等完整数据
      if (drama.value && updated) {
        drama.value = {
          ...drama.value,
          metadata: updated.metadata,
          updated_at: updated.updated_at,
          title: updated.title ?? drama.value.title,
          style: updated.style ?? drama.value.style,
          genre: updated.genre ?? drama.value.genre,
          description: updated.description ?? drama.value.description,
        }
        if (Array.isArray(updated.episodes) && updated.episodes.length) {
          drama.value.episodes = updated.episodes
        }
        if (Array.isArray(updated.characters)) {
          drama.value.characters = updated.characters
        }
        if (Array.isArray(updated.scenes)) {
          drama.value.scenes = updated.scenes
        }
        if (Array.isArray(updated.props)) {
          drama.value.props = updated.props
        }
      } else if (updated) {
        drama.value = updated
      }
      const isMatchingRetry = Boolean(
        retainedOperation && failedCanvasSaveOperation.value === saveOperation,
      )
      const failedOperation = failedCanvasSaveOperation.value
      const remainingFailure = subtractSuccessfulCanvasSaveOperation(
        failedOperation,
        saveOperation,
      )
      const supersededFailure = Boolean(failedOperation && !remainingFailure)
      if (remainingFailure !== failedOperation) {
        failedCanvasSaveOperation.value = remainingFailure
        const remainingError = canvasSaveOperationError(remainingFailure)
        if (remainingError || !remainingFailure) layoutSaveError.value = remainingError
      }
      const isLatestSave = effectiveGroupsOnly || saveRevision === canvasMutationRevision
      if ((isLatestSave && !failedCanvasSaveOperation.value) || isMatchingRetry || supersededFailure) {
        layoutSaveState.value = 'saved'
        if (!effectiveGroupsOnly && isLatestSave) {
          layoutDirty.value = false
        }
        if (isMatchingRetry || !failedCanvasSaveOperation.value) {
          layoutSaveError.value = ''
        }
        if (isMatchingRetry) failedCanvasSaveOperation.value = null
        if (savedHintTimer) clearTimeout(savedHintTimer)
        savedHintTimer = setTimeout(() => {
          if (layoutSaveState.value === 'saved') layoutSaveState.value = 'idle'
        }, 4000)
      } else if (failedCanvasSaveOperation.value) {
        layoutSaveState.value = 'error'
      }
      return { ok: true, updated }
    } catch (e) {
      if (
        !canvasInstanceActive.value
        || Number(targetDramaId) !== Number(canvasProjectId.value)
        || Number(targetDramaId) !== Number(drama.value?.id)
      ) {
        return { ok: false, cancelled: true }
      }
      const isLatestSave = retainedOperation
        ? failedCanvasSaveOperation.value === saveOperation
        : effectiveGroupsOnly || saveRevision === canvasMutationRevision
      if (isLatestSave) {
        const saveError = safeFreeCanvasError(e, '保存失败，请重试')
        const failedSaveOperation = Object.freeze({
          ...saveOperation,
          layoutError: saveOperation.writesLayout ? saveError : saveOperation.layoutError,
          groupsError: saveOperation.writesGroups ? saveError : saveOperation.groupsError,
          freeCanvasError: saveOperation.writesFreeCanvas ? saveError : saveOperation.freeCanvasError,
        })
        failedCanvasSaveOperation.value = mergeFailedCanvasSaveOperations(
          failedCanvasSaveOperation.value,
          failedSaveOperation,
        )
        layoutSaveState.value = 'error'
        layoutSaveError.value = canvasSaveOperationError(failedCanvasSaveOperation.value)
        if (reportError) ElMessage.error(saveError)
      } else if (failedCanvasSaveOperation.value) {
        layoutSaveState.value = 'error'
      }
      return { ok: false, error: e, operation: saveOperation }
    } finally {
      completeSaveSettlement()
    }
  }

  function retryCanvasSave() {
    const operation = failedCanvasSaveOperation.value
    if (!operation) return Promise.resolve({ ok: false, cancelled: true })
    return persistCanvasState({ retryOperation: operation, reportError: true })
  }

  function disposeCanvasPersist() {
    cancelScheduledCanvasSave()
    if (savedHintTimer) {
      clearTimeout(savedHintTimer)
      savedHintTimer = null
    }
  }

  return {
    layoutSaveState,
    layoutSaveError,
    failedCanvasSaveOperation,
    layoutDirty,
    canvasSaveCoordinator,
    scheduleLayoutSave,
    cancelScheduledCanvasSave,
    beginCanvasSaveSettlement,
    hasPendingCanvasSaves,
    waitForCanvasSaveSettlement,
    persistCanvasState,
    retryCanvasSave,
    abandonCanvasSaveOperation,
    disposeCanvasPersist,
  }
}
