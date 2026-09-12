/**
 * 画布页展示用视口、媒体查询、列表返回和项目身份辅助。
 * 只搬家展示计算，不改 persist / workflow 核心写入。
 */
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted } from 'vue'

import { canvasUserError } from '@/composables/useCanvasUserError'
import { parseFreeCanvas, resolveViewport } from '@/utils/canvasLayout'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import {
  ensureKnownStoryboardMedia as confirmKnownStoryboardMedia,
  getBillableMediaUnknownReason as describeBillableMediaUnknownReason,
  getStoryboardMediaQueryStatus as readStoryboardMediaQueryStatus,
} from '@/components/dramaCanvas/dramaCanvasBillableMedia.js'

export const MIN_READABLE_CANVAS_ZOOM = 0.9
export const FOCUSED_NODE_MIN_ZOOM = 0.9

export function useDramaCanvasDisplayState(ctx = {}) {
  const {
    route,
    drama,
    mediaStatusBySbId,
    canvasMode,
    freeCanvas,
    savedLayout,
    canvasFlowApi,
    currentViewport,
    canvasMainRef,
    canvasViewportReady,
    canvasProjectId,
    activeWorkflowRun,
  } = ctx

  const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.query.returnTo))

  const initialViewport = computed(() => {
    if (canvasMode.value === 'free') return { ...freeCanvas.value.viewport }
    const v = resolveViewport(savedLayout.value)
    if (savedLayout.value?.viewport && Number(v.zoom) >= MIN_READABLE_CANVAS_ZOOM) {
      return { x: v.x, y: v.y, zoom: v.zoom }
    }
    return { x: 0, y: 0, zoom: MIN_READABLE_CANVAS_ZOOM }
  })

  const hasSavedViewport = computed(() => (
    canvasMode.value === 'free'
      ? Boolean(parseFreeCanvas(drama.value?.metadata)?.viewport)
      : (
        Boolean(savedLayout.value?.viewport)
        && Number(resolveViewport(savedLayout.value).zoom) >= MIN_READABLE_CANVAS_ZOOM
      )
  ))

  function getStoryboardMediaQueryStatus(storyboardId) {
    return readStoryboardMediaQueryStatus(mediaStatusBySbId.value, storyboardId)
  }

  function getBillableMediaUnknownReason(storyboardIds = []) {
    return describeBillableMediaUnknownReason(drama.value, storyboardIds, mediaStatusBySbId.value)
  }

  function ensureKnownStoryboardMedia(storyboardIds = []) {
    return confirmKnownStoryboardMedia(drama.value, storyboardIds, mediaStatusBySbId.value)
  }

  async function focusCanvasNode(nodeId) {
    if (!nodeId) return
    await nextTick()
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })
    const flowApi = canvasFlowApi.value
    if (!flowApi?.fitView) return
    await flowApi.fitView({
      nodes: [nodeId],
      padding: 0.18,
      minZoom: FOCUSED_NODE_MIN_ZOOM,
      maxZoom: 1.1,
      duration: 250,
      includeHiddenNodes: false,
    })
    const viewport = flowApi.getViewport?.()
    if (viewport) currentViewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
    const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
      .find((element) => element.dataset.id === String(nodeId))
    nodeElement?.querySelector('.canvas-node-panel')?.focus({ preventScroll: true })
    document.querySelector('.canvas-inspector-dock .canvas-node-panel')?.focus({ preventScroll: true })
  }

  function screenToFlowPosition(clientX, clientY) {
    const el = canvasMainRef.value
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const vp = currentViewport.value
    return {
      x: (clientX - rect.left - vp.x) / vp.zoom,
      y: (clientY - rect.top - vp.y) / vp.zoom,
    }
  }

  function currentCanvasProjectId() {
    const routeProjectId = Number(canvasProjectId.value)
    const loadedProjectId = Number(drama.value?.id)
    return routeProjectId > 0 && routeProjectId === loadedProjectId ? routeProjectId : null
  }

  function isCanvasProjectCurrent(projectId) {
    return Number(projectId) > 0
      && Number(canvasProjectId.value) === Number(projectId)
      && Number(drama.value?.id) === Number(projectId)
  }

  function isActiveWorkflowRun(run) {
    return Boolean(
      run
      && activeWorkflowRun.value === run
      && !run.controller.signal.aborted
      && isCanvasProjectCurrent(run.projectId),
    )
  }

  function isWorkflowAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ERR_CANCELED'
  }

  function safeFreeCanvasError(error, fallback) {
    return canvasUserError(error, fallback || '操作失败，请重试')
  }

  function updateCanvasViewportReady() {
    const rect = canvasMainRef.value?.getBoundingClientRect?.()
    canvasViewportReady.value = Boolean(rect && rect.width > 0 && rect.height > 0)
  }

  let canvasResizeObserver = null
  let canvasReadyFrame = null

  if (getCurrentInstance()) {
    onMounted(() => {
      canvasReadyFrame = window.requestAnimationFrame(() => {
        updateCanvasViewportReady()
        if (typeof ResizeObserver === 'function' && canvasMainRef.value) {
          canvasResizeObserver = new ResizeObserver(updateCanvasViewportReady)
          canvasResizeObserver.observe(canvasMainRef.value)
        }
      })
    })

    onBeforeUnmount(() => {
      if (canvasReadyFrame != null) window.cancelAnimationFrame(canvasReadyFrame)
      canvasResizeObserver?.disconnect()
    })
  }

  return {
    projectListReturnTo,
    initialViewport,
    hasSavedViewport,
    getStoryboardMediaQueryStatus,
    getBillableMediaUnknownReason,
    ensureKnownStoryboardMedia,
    focusCanvasNode,
    screenToFlowPosition,
    currentCanvasProjectId,
    isCanvasProjectCurrent,
    isActiveWorkflowRun,
    isWorkflowAbortError,
    safeFreeCanvasError,
    updateCanvasViewportReady,
    MIN_READABLE_CANVAS_ZOOM,
    FOCUSED_NODE_MIN_ZOOM,
  }
}
