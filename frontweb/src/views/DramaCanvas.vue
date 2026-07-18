<template>
  <div class="drama-canvas-page" :class="{ 'inspector-open': focusedNodeId }">
    <header class="header">
      <div class="header-inner">
        <button type="button" class="logo" aria-label="返回项目列表" @click="goProjectList">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">画布模式</span>
        </button>
        <span class="breadcrumb-sep">›</span>
        <span class="page-title">{{ drama?.title || '加载中…' }}</span>

        <el-select
          :model-value="filterEpisodeId"
          @update:model-value="requestEpisodeFilterChange"
          class="episode-select"
          placeholder="全部集数"
          clearable
          size="small"
          style="width: 150px"
        >
          <el-option
            v-for="ep in (drama?.episodes || [])"
            :key="ep.id"
            :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
            :value="ep.id"
          />
        </el-select>

        <span v-if="layoutSaveState === 'saving'" class="layout-status saving">保存中…</span>
        <span v-else-if="layoutSaveState === 'saved'" class="layout-status saved">已保存</span>
        <span v-else-if="layoutSaveState === 'error'" class="layout-status error">保存失败</span>

      </div>
      <CanvasDesktopToolbar
        :selected-storyboard-count="selectedStoryboardIds.length"
        :workflow-groups="workflowGroups"
        :active-group-id="activeGroupId"
        :pipeline-steps="pipelineSteps"
        :workflow-running="workflowRunning"
        :workflow-progress="workflowProgress"
        :episode-generating="episodeGenerating"
        :episode-gen-progress="episodeGenProgress"
        :action-reasons="actionReasons"
        :action-config-services="actionConfigServices"
        :aligning-nodes="aligningNodes"
        :is-dark="isDark"
        @edit-script="focusScriptNode"
        @create="openCreateDialog"
        @align="onAlignNodes"
        @list-mode="goListMode"
        @toggle-theme="toggleTheme"
        @update:pipeline-steps="setPipelineSteps"
        @update:active-group-id="setActiveGroupId"
        @create-workflow="onCreateWorkflowGroup"
        @run-workflow="onRunActiveGroup"
        @delete-workflow="onDeleteActiveGroup"
        @generate-storyboards="aiGenerateStoryboards"
        @batch-images="batchGenerateImages"
        @batch-videos="batchGenerateVideos"
      />
      <div
        v-if="scopedMediaWarning"
        class="canvas-warning-bar"
        role="alert"
      >
        <span>{{ scopedMediaWarning }}</span>
        <div class="canvas-warning-actions">
          <el-button
            link
            size="small"
            :loading="mediaLoading"
            @click="retryUnknownStoryboardMedia"
          >
            重试媒体查询
          </el-button>
        </div>
      </div>
    </header>

    <main
      v-if="canvasLoadState === 'error'"
      ref="canvasLoadFailureRef"
      class="canvas-load-failure"
      tabindex="-1"
      role="alert"
      aria-live="assertive"
    >
      <div class="canvas-load-failure-card">
        <p class="canvas-load-eyebrow">项目加载失败</p>
        <h1 class="canvas-load-title">当前画布暂时无法打开</h1>
        <p class="canvas-load-message">{{ canvasLoadError }}</p>
        <p class="canvas-load-detail">
          {{ canvasLoadNotFound ? '项目可能已移入回收站或已删除。' : '请确认本地服务可用后，在当前页面直接重试。' }}
        </p>
        <div class="canvas-load-actions">
          <el-button type="primary" :loading="loading" @click="retryCanvasProjectLoad">重试加载</el-button>
          <el-button @click="goListMode">返回项目列表</el-button>
        </div>
      </div>
    </main>

    <div v-else v-loading="loading" class="canvas-shell">
      <aside v-if="drama" class="canvas-sidebar">
        <div class="sidebar-section sidebar-script">
          <div class="sec-label sec-label-row">
            <span>📜 剧本</span>
            <el-button link size="small" type="warning" @click="focusScriptNode">编辑</el-button>
          </div>
        </div>
        <div class="sidebar-title">
          素材库
          <el-button v-if="highlightAssetId" link size="small" @click="clearAssetHighlight">清除</el-button>
        </div>
        <div class="sidebar-section">
          <div class="sec-label sec-label-row">
            <span>角色 {{ (drama.characters || []).length }}</span>
            <el-button link size="small" type="primary" @click="openCreateDialog('character')">+</el-button>
          </div>
          <button
            type="button"
            v-for="c in (drama.characters || [])"
            :key="'c-' + c.id"
            class="sidebar-item"
            :class="{ active: highlightAssetId === 'char:' + c.id }"
            @click="selectSidebarAsset('char:' + c.id)"
          >
            {{ c.name || '未命名' }}
          </button>
        </div>
        <div class="sidebar-section">
          <div class="sec-label sec-label-row">
            <span>场景 {{ (drama.scenes || []).length }}</span>
            <el-button link size="small" type="primary" @click="openCreateDialog('scene')">+</el-button>
          </div>
          <button
            type="button"
            v-for="s in (drama.scenes || [])"
            :key="'s-' + s.id"
            class="sidebar-item"
            :class="{ active: highlightAssetId === 'scene:' + s.id }"
            @click="selectSidebarAsset('scene:' + s.id)"
          >
            {{ s.location || '未命名' }}
          </button>
        </div>
        <div class="sidebar-section">
          <div class="sec-label sec-label-row">
            <span>道具 {{ (drama.props || []).length }}</span>
            <el-button link size="small" type="primary" @click="openCreateDialog('prop')">+</el-button>
          </div>
          <button
            type="button"
            v-for="p in (drama.props || [])"
            :key="'p-' + p.id"
            class="sidebar-item"
            :class="{ active: highlightAssetId === 'prop:' + p.id }"
            @click="selectSidebarAsset('prop:' + p.id)"
          >
            {{ p.name || '未命名' }}
          </button>
        </div>

        <CanvasWorkflowSidebarList
          :workflow-groups="workflowGroups"
          :active-group-id="activeGroupId"
          :storyboard-details="workflowStoryboardDetails"
          :reorder-disabled="workflowOrderSaving || workflowRunning"
          :reorder-pending="workflowOrderSaving"
          @select-group="setActiveGroupId"
          @reorder-storyboards="reorderWorkflowStoryboards"
        />

      </aside>

      <div ref="canvasMainRef" class="canvas-main">
        <VueFlow
          v-if="nodes.length && canvasViewportReady"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :default-viewport="initialViewport"
          :min-zoom="0.25"
          :max-zoom="2"
          :nodes-connectable="false"
          :elements-selectable="true"
          :selection-key-code="true"
          :pan-on-drag="[1, 2]"
          :pan-on-scroll="true"
          :fit-view-on-init="false"
          :only-render-visible-elements="!focusedNodeId"
          class="vue-flow-canvas"
          @node-double-click="onNodeDoubleClick"
          @node-click="onNodeClick"
          @pane-click="onPaneClick"
          @pane-context-menu="onPaneContextMenu"
          @node-drag-stop="scheduleLayoutSave"
          @viewport-change="onViewportChange"
          @move-end="scheduleLayoutSave"
          @selection-change="onSelectionChange"
          @nodes-initialized="onCanvasNodesInitialized"
        >
          <CanvasFlowAligner />
          <Background pattern-color="#3f3f46" :gap="20" />
          <Controls :show-zoom="true" :show-fit-view="true" :show-interactive="true">
            <template #control-zoom-in>
              <button type="button" class="vue-flow__controls-button" aria-label="放大画布" title="放大画布" @click="zoomCanvasIn">
                <el-icon><ZoomIn /></el-icon>
              </button>
            </template>
            <template #control-zoom-out>
              <button type="button" class="vue-flow__controls-button" aria-label="缩小画布" title="缩小画布" @click="zoomCanvasOut">
                <el-icon><ZoomOut /></el-icon>
              </button>
            </template>
            <template #control-fit-view>
              <button type="button" class="vue-flow__controls-button" aria-label="适配可读视图" title="适配可读视图" @click="fitCanvasView">
                <el-icon><FullScreen /></el-icon>
              </button>
            </template>
            <template #control-interactive>
              <button
                type="button"
                class="vue-flow__controls-button"
                :aria-label="canvasInteractive ? '锁定画布' : '解锁画布'"
                :title="canvasInteractive ? '锁定画布' : '解锁画布'"
                :aria-pressed="!canvasInteractive"
                @click="toggleCanvasInteractive"
              >
                <el-icon><Unlock v-if="canvasInteractive" /><Lock v-else /></el-icon>
              </button>
            </template>
          </Controls>
          <MiniMap pannable zoomable />
        </VueFlow>
        <CanvasEmptyState
          v-if="!loading && canvasStartMode"
          :mode="canvasStartMode"
          :episodes="drama?.episodes || []"
          :selected-episode-id="filterEpisodeId"
          @create-episode="openCreateDialog('episode')"
          @confirm-episode="confirmEpisodeSelection"
          @go-list="goListMode"
        />
      </div>
    </div>

    <CanvasCreateDialog
      v-model="createDialogVisible"
      :type="createDialogType"
      :on-submit="onCreateSubmit"
    />
    <CanvasContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      @select="onContextMenuSelect"
      @close="closeContextMenu"
    />
  </div>
</template>

<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FullScreen, Lock, Unlock, ZoomIn, ZoomOut } from '@element-plus/icons-vue'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import { dramaAPI } from '@/api/drama'
import { workflowRunsAPI } from '@/api/workflowRuns'
import { useTheme } from '@/composables/useTheme'
import { runWorkflowGroup } from '@/composables/useCanvasWorkflowRunner'
import { CANVAS_CONTEXT_KEY } from '@/composables/useCanvasContext'
import { useCanvasStoryboardMedia } from '@/composables/useCanvasStoryboardMedia'
import { useCanvasCrud } from '@/composables/useCanvasCrud'
import { useCanvasEpisodeGenerate } from '@/composables/useCanvasEpisodeGenerate'
import { useCanvasScript, scriptNodeId } from '@/composables/useCanvasScript'
import { createCanvasNodeStatusStore } from '@/composables/useCanvasNodeStatus'
import { useCanvasWorkflowOrder } from '@/composables/useCanvasWorkflowOrder'
import {
  applyCanvasHighlight,
  buildDramaCanvasGraph,
  computeAutoLayoutPositions,
  getStoryboardRefFromNode,
  stampEdgeBaseStyles,
} from '@/utils/dramaCanvasAdapter'
import {
  buildCanvasLayoutPayload,
  parseCanvasLayout,
  parseDramaMetadata,
  resolveViewport,
} from '@/utils/canvasLayout'
import {
  createWorkflowGroup,
  deleteWorkflowGroup,
  findStoryboardInDrama,
  normalizePipeline,
  parseWorkflowGroups,
  storyboardIdFromNodeId,
  getDramaGenerationOptions,
} from '@/utils/canvasWorkflow'
import {
  getCanvasActionDisabledReasons,
  getCanvasPipelineProductionGate,
  getCanvasProductionActionState,
  getCanvasProductionStepGate,
  getCanvasStartMode,
  normalizeCanvasProductionReadiness,
} from '@/utils/canvasActionState'
import { resolveCanvasEpisodeId } from '@/utils/canvasUiState'
import { buildAiConfigLocation } from '@/utils/sourceWorkflowLaunch'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'

import CanvasLabelNode from '@/components/dramaCanvas/CanvasLabelNode.vue'
import CanvasDramaHeaderNode from '@/components/dramaCanvas/CanvasDramaHeaderNode.vue'
import CanvasAssetNode from '@/components/dramaCanvas/CanvasAssetNode.vue'
import CanvasEpisodeNode from '@/components/dramaCanvas/CanvasEpisodeNode.vue'
import CanvasScriptNode from '@/components/dramaCanvas/CanvasScriptNode.vue'
import CanvasStoryboardNode from '@/components/dramaCanvas/CanvasStoryboardNode.vue'
import CanvasMediaNode from '@/components/dramaCanvas/CanvasMediaNode.vue'
import CanvasCreateDialog from '@/components/dramaCanvas/CanvasCreateDialog.vue'
import CanvasContextMenu from '@/components/dramaCanvas/CanvasContextMenu.vue'
import CanvasAddButtonNode from '@/components/dramaCanvas/CanvasAddButtonNode.vue'
import CanvasFlowAligner from '@/components/dramaCanvas/CanvasFlowAligner.vue'
import CanvasDesktopToolbar from '@/components/dramaCanvas/CanvasDesktopToolbar.vue'
import CanvasEmptyState from '@/components/dramaCanvas/CanvasEmptyState.vue'
import CanvasWorkflowSidebarList from '@/components/dramaCanvas/CanvasWorkflowSidebarList.vue'

const route = useRoute()
const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()
const {
  imagesBySbId,
  videosBySbId,
  mediaStatusBySbId,
  mediaLoading,
  loadForDrama,
  loadForStoryboards,
} = useCanvasStoryboardMedia()

const loading = ref(false)
const drama = ref(null)
const canvasLoadState = ref('loading')
const canvasLoadError = ref('')
const canvasLoadNotFound = ref(false)
const canvasLoadFailureRef = ref(null)
const nodes = ref([])
const edges = ref([])
const filterEpisodeId = ref(null)
const highlightAssetId = ref(null)
const layoutCache = ref(null)
const workflowGroups = ref([])
const activeGroupId = ref(null)
const selectedStoryboardIds = ref([])
const pipelineSteps = ref(['image', 'video', 'audio'])
const workflowRunning = ref(false)
const workflowProgress = ref('')
const layoutSaveState = ref('idle')
const layoutDirty = ref(false)
const currentViewport = ref({ x: 0, y: 0, zoom: 0.9 })
const focusedNodeId = ref(null)
const canvasMainRef = ref(null)
const canvasViewportReady = ref(false)
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuFlowPos = ref(null)
const paneClickSuppressed = ref(false)
let focusedNodeGuard = null
let focusedNodeDirtyCheck = null
const nodeStatus = createCanvasNodeStatusStore()
const aligningNodes = ref(false)
const canvasFlowApi = ref(null)
const canvasInteractive = ref(true)
const initialFitDone = ref(false)
const mediaValidity = reactive({})
const productionReadinessState = ref({ status: 'loading', data: null })

const PANEL_NODE_TYPES = new Set(['canvasStoryboard', 'canvasMedia', 'canvasAsset', 'canvasScript'])

let saveTimer = null
let savedHintTimer = null
let pollTimer = null
let paneClickSuppressTimer = null
let canvasResizeObserver = null
let canvasReadyFrame = null
let readinessRequestId = 0
let canvasLoadRequestId = 0

const nodeTypes = {
  canvasLabel: markRaw(CanvasLabelNode),
  canvasDramaHeader: markRaw(CanvasDramaHeaderNode),
  canvasAsset: markRaw(CanvasAssetNode),
  canvasEpisode: markRaw(CanvasEpisodeNode),
  canvasScript: markRaw(CanvasScriptNode),
  canvasStoryboard: markRaw(CanvasStoryboardNode),
  canvasMedia: markRaw(CanvasMediaNode),
  canvasAddButton: markRaw(CanvasAddButtonNode),
}

const dramaId = computed(() => Number(route.params.id))
const isCanvasReady = computed(() => canvasLoadState.value === 'ready' && Boolean(drama.value))
const savedLayout = computed(() => layoutCache.value || parseCanvasLayout(drama.value?.metadata))
const workflowStoryboardDetails = computed(() => {
  const details = {}
  for (const [episodeIndex, episode] of (drama.value?.episodes || []).entries()) {
    const episodeTitle = episode.title || `第 ${episode.episode_number ?? episodeIndex + 1} 集`
    for (const [storyboardIndex, storyboard] of (episode.storyboards || []).entries()) {
      const title = [
        storyboard.title,
        storyboard.segment_title,
        storyboard.action,
        storyboard.description,
      ].find((value) => String(value || '').trim())
      details[String(storyboard.id)] = {
        title: String(title || '').trim(),
        episodeTitle,
        storyboardNumber: storyboard.storyboard_number ?? storyboardIndex + 1,
      }
    }
  }
  return details
})
const currentEpisode = computed(() => (
  (drama.value?.episodes || []).find((episode) => String(episode.id) === String(filterEpisodeId.value)) || null
))
const scopedStoryboards = computed(() => {
  if (!drama.value) return []
  const episodes = filterEpisodeId.value
    ? (drama.value.episodes || []).filter((episode) => episode.id === filterEpisodeId.value)
    : (drama.value.episodes || [])
  return episodes.flatMap((episode) => episode.storyboards || [])
})
const unknownMediaStoryboards = computed(() => (
  scopedStoryboards.value.filter((storyboard) => mediaStatusBySbId.value?.[storyboard.id]?.state === 'unknown')
))
const scopedMediaWarning = computed(() => {
  const count = unknownMediaStoryboards.value.length
  if (!count) return ''
  return count === 1
    ? '1 个分镜的媒体查询失败，已保留旧结果并标记为未知。为避免重复计费，重新生成图片或视频前请先重试媒体查询。'
    : `${count} 个分镜的媒体查询失败，已保留旧结果并标记为未知。为避免重复计费，重新生成图片或视频前请先重试媒体查询。`
})
const activeWorkflowGroup = computed(() => (
  workflowGroups.value.find((group) => group.id === activeGroupId.value) || null
))
const activeWorkflowSteps = computed(() => {
  if (!activeWorkflowGroup.value) return []
  const configured = Array.isArray(activeWorkflowGroup.value.pipeline)
    ? activeWorkflowGroup.value.pipeline
    : pipelineSteps.value
  return normalizePipeline(configured)
})
const productionActions = computed(() => getCanvasProductionActionState(productionReadinessState.value))
const createWorkflowProductionGate = computed(() => (
  getCanvasPipelineProductionGate(pipelineSteps.value, productionActions.value)
))
const runWorkflowProductionGate = computed(() => (
  getCanvasPipelineProductionGate(activeWorkflowSteps.value, productionActions.value)
))
const actionReasons = computed(() => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: selectedStoryboardIds.value.length,
    pipelineSteps: pipelineSteps.value,
    activeGroupId: activeGroupId.value,
    activeWorkflowSteps: activeWorkflowSteps.value,
    productionActions: productionActions.value,
    episodeCount: drama.value?.episodes?.length || 0,
    episodeId: filterEpisodeId.value,
    episodeHasScript: Boolean(String(currentEpisode.value?.script_content || '').trim()),
    storyboardCount: currentEpisode.value?.storyboards?.length || 0,
    workflowRunning: workflowRunning.value,
    episodeGenerating: episodeGenerating.value,
  })
  return {
    ...reasons,
    runWorkflow: reasons.runWorkflow || getBillableMediaUnknownReason(
      pipelineTouchesBillableMedia(activeWorkflowSteps.value)
        ? (activeWorkflowGroup.value?.storyboard_ids || [])
        : [],
    ),
    batchImages: reasons.batchImages || getBillableMediaUnknownReason(
      (currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id),
    ),
    batchVideos: reasons.batchVideos || getBillableMediaUnknownReason(
      (currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id),
    ),
  }
})
const actionConfigServices = computed(() => ({
  createWorkflow: actionReasons.value.createWorkflow === createWorkflowProductionGate.value.reason
    ? createWorkflowProductionGate.value.serviceType
    : '',
  runWorkflow: actionReasons.value.runWorkflow === runWorkflowProductionGate.value.reason
    ? runWorkflowProductionGate.value.serviceType
    : '',
  batchVideos: actionReasons.value.batchVideos === productionActions.value.video.reason
    ? productionActions.value.video.serviceType
    : '',
}))
const canvasStartMode = computed(() => getCanvasStartMode(drama.value, filterEpisodeId.value))

const MIN_READABLE_CANVAS_ZOOM = 0.9
const FOCUSED_NODE_MIN_ZOOM = 0.9
const initialViewport = computed(() => {
  const v = resolveViewport(savedLayout.value)
  if (savedLayout.value?.viewport && Number(v.zoom) >= MIN_READABLE_CANVAS_ZOOM) {
    return { x: v.x, y: v.y, zoom: v.zoom }
  }
  return { x: 0, y: 0, zoom: MIN_READABLE_CANVAS_ZOOM }
})

const hasSavedViewport = computed(() => (
  Boolean(savedLayout.value?.viewport)
  && Number(resolveViewport(savedLayout.value).zoom) >= MIN_READABLE_CANVAS_ZOOM
))

function coreCanvasRequestError(status) {
  const error = new Error('PROJECT_LOAD_FAILED')
  error.status = Number(status) || 0
  return error
}

async function requestCanvasProject(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let response
  try {
    response = await fetchImpl(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (_) {
    throw coreCanvasRequestError(0)
  } finally {
    clearTimeout(timeout)
  }

  let payload = null
  try {
    payload = response.status === 204 ? null : await response.json()
  } catch (_) {
    throw coreCanvasRequestError(response.status)
  }
  if (!response.ok || payload?.success === false) throw coreCanvasRequestError(response.status)
  return payload?.data !== undefined ? payload.data : payload
}

const coreCanvasDramaAPI = {
  get(id) {
    return requestCanvasProject(`/dramas/${encodeURIComponent(id)}`)
  },
}

function friendlyCanvasProjectLoadError(error) {
  const status = Number(error?.status || error?.response?.status)
  if (status === 404) return '该项目不存在，或已移入回收站。'
  if (status >= 500) return '本地服务暂时不可用，请稍后重试。'
  return '无法连接本地服务，请确认服务已经启动后重试。'
}

function getStoryboardMediaQueryStatus(storyboardId) {
  return mediaStatusBySbId.value?.[storyboardId] || { state: 'idle', error: '', retryable: false, preservedData: false }
}

function findUnknownMediaStoryboards(storyboardIds = []) {
  const ids = new Set((Array.isArray(storyboardIds) ? storyboardIds : []).map((storyboardId) => Number(storyboardId)))
  if (!ids.size || !drama.value) return []
  return (drama.value.episodes || [])
    .flatMap((episode) => episode.storyboards || [])
    .filter((storyboard) => ids.has(Number(storyboard.id)) && getStoryboardMediaQueryStatus(storyboard.id).state === 'unknown')
}

function getBillableMediaUnknownReason(storyboardIds = []) {
  const unknownBoards = findUnknownMediaStoryboards(storyboardIds)
  if (!unknownBoards.length) return ''
  return unknownBoards.length === 1
    ? '1 个分镜的媒体状态仍然未知。为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。'
    : `${unknownBoards.length} 个分镜的媒体状态仍然未知。为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。`
}

function pipelineTouchesBillableMedia(steps = []) {
  return (Array.isArray(steps) ? steps : []).some((step) => step === 'image' || step === 'video')
}

function ensureKnownStoryboardMedia(storyboardIds = []) {
  const reason = getBillableMediaUnknownReason(storyboardIds)
  if (!reason) return true
  ElMessage.warning(reason)
  return false
}

async function loadCanvasProject({ blocking = !isCanvasReady.value, preserveOnError = !blocking } = {}) {
  const requestedDramaId = dramaId.value
  if (!Number.isFinite(requestedDramaId) || requestedDramaId <= 0) return false
  const requestId = ++canvasLoadRequestId
  loading.value = true
  if (blocking) canvasLoadState.value = 'loading'
  canvasLoadError.value = ''
  canvasLoadNotFound.value = false
  try {
    drama.value = await coreCanvasDramaAPI.get(requestedDramaId)
    if (requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
    layoutCache.value = parseCanvasLayout(drama.value.metadata)
    syncWorkflowFromDrama()
    const vp = resolveViewport(layoutCache.value)
    currentViewport.value = vp
    if (route.query.episode) filterEpisodeId.value = Number(route.query.episode)
    await loadForDrama(drama.value, filterEpisodeId.value)
    if (requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
    rebuildGraph()
    canvasLoadState.value = 'ready'
    canvasLoadNotFound.value = false
    return true
  } catch (error) {
    if (requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
    if (!preserveOnError) {
      drama.value = null
      nodes.value = []
      edges.value = []
      layoutCache.value = null
    }
    canvasLoadNotFound.value = Number(error?.status || error?.response?.status) === 404
    canvasLoadError.value = friendlyCanvasProjectLoadError(error)
    if (!preserveOnError) {
      canvasLoadState.value = 'error'
      await nextTick()
      canvasLoadFailureRef.value?.focus()
    }
    return false
  } finally {
    if (requestId === canvasLoadRequestId) loading.value = false
  }
}

async function retryCanvasProjectLoad() {
  await loadCanvasProject({ blocking: true, preserveOnError: false })
}

async function fitCanvasView() {
  const flowApi = canvasFlowApi.value
  if (!flowApi?.fitView) return
  await flowApi.fitView({
    padding: 0.12,
    minZoom: MIN_READABLE_CANVAS_ZOOM,
    maxZoom: 1,
    duration: 250,
    includeHiddenNodes: false,
  })
  const viewport = flowApi.getViewport?.()
  if (viewport) currentViewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
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

async function focusCanvasNodeTrigger(nodeId) {
  if (!nodeId) return
  await nextTick()
  const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
    .find((element) => element.dataset.id === String(nodeId))
  nodeElement
    ?.querySelector('.canvas-sb-node, .canvas-asset-node, .canvas-media-node, .canvas-script-node, [role="button"]')
    ?.focus({ preventScroll: true })
}

function restoreFocusedNodeSelection() {
  const currentId = focusedNodeId.value ? String(focusedNodeId.value) : ''
  nodes.value = nodes.value.map((node) => ({
    ...node,
    selected: Boolean(currentId && String(node.id) === currentId),
  }))
  const storyboardId = storyboardIdFromNodeId(currentId)
  selectedStoryboardIds.value = storyboardId ? [storyboardId] : []
}

function hasFocusedNodePendingWork() {
  try {
    if (typeof focusedNodeDirtyCheck === 'function') return Boolean(focusedNodeDirtyCheck())
    return Boolean(focusedNodeDirtyCheck?.value)
  } catch (_) {
    return true
  }
}

async function confirmFocusedNodeLeave() {
  if (!focusedNodeId.value || !focusedNodeGuard) return true
  const canLeave = await focusedNodeGuard()
  if (!canLeave) restoreFocusedNodeSelection()
  return canLeave
}

function handleCanvasBeforeUnload(event) {
  if (!hasFocusedNodePendingWork()) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => confirmFocusedNodeLeave())
onBeforeRouteUpdate(async (to) => {
  if (String(to.params.id) !== String(route.params.id)) return confirmFocusedNodeLeave()
  return true
})

async function setFocusedCanvasNode(nodeId, { force = false, restoreFocus = false } = {}) {
  const currentId = focusedNodeId.value || null
  const nextId = nodeId || null
  const isChanging = String(currentId || '') !== String(nextId || '')
  if (!isChanging) {
    if (nextId) await focusCanvasNode(nextId)
    return true
  }
  if (currentId && !force && focusedNodeGuard) {
    const canLeave = await focusedNodeGuard()
    if (!canLeave) {
      restoreFocusedNodeSelection()
      document.querySelector('.canvas-inspector-dock .canvas-node-panel')?.focus({ preventScroll: true })
      return false
    }
  }
  focusedNodeId.value = nextId
  if (nextId) await focusCanvasNode(nextId)
  else if (restoreFocus && currentId) await focusCanvasNodeTrigger(currentId)
  return true
}

function registerFocusGuard(guard, isDirty = null) {
  focusedNodeGuard = typeof guard === 'function' ? guard : null
  focusedNodeDirtyCheck = isDirty
  return () => {
    if (focusedNodeGuard === guard) {
      focusedNodeGuard = null
      focusedNodeDirtyCheck = null
    }
  }
}

async function requestEpisodeFilterChange(value) {
  const episodeId = value == null || value === '' ? null : Number(value)
  if (String(filterEpisodeId.value ?? '') === String(episodeId ?? '')) return true
  const changed = await setFocusedCanvasNode(null, { restoreFocus: false })
  if (!changed) {
    restoreFocusedNodeSelection()
    return false
  }
  filterEpisodeId.value = episodeId
  return true
}

function routeFocusNodeId() {
  const raw = Array.isArray(route.query.focus) ? route.query.focus[0] : route.query.focus
  const value = String(raw || '').trim()
  return /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : ''
}

function zoomCanvasIn() {
  canvasFlowApi.value?.zoomIn?.({ duration: 150 })
}

function zoomCanvasOut() {
  canvasFlowApi.value?.zoomOut?.({ duration: 150 })
}

function toggleCanvasInteractive() {
  canvasInteractive.value = !canvasInteractive.value
  canvasFlowApi.value?.setInteractive?.(canvasInteractive.value)
}

async function onCanvasNodesInitialized() {
  const requestedFocus = routeFocusNodeId()
  if (requestedFocus && nodes.value.some((node) => node.id === requestedFocus)) {
    initialFitDone.value = true
    await setFocusedCanvasNode(requestedFocus)
    return
  }
  if (hasSavedViewport.value || initialFitDone.value) return
  initialFitDone.value = true
  await nextTick()
  await fitCanvasView()
}

function syncWorkflowFromDrama() {
  workflowGroups.value = parseWorkflowGroups(drama.value?.metadata)
  if (activeGroupId.value && !workflowGroups.value.some((g) => g.id === activeGroupId.value)) {
    activeGroupId.value = null
  }
}

function rebuildGraph() {
  if (!drama.value) {
    nodes.value = []
    edges.value = []
    return
  }
  const graph = buildDramaCanvasGraph(drama.value, {
    episodeId: filterEpisodeId.value,
    savedLayout: savedLayout.value,
    workflowGroups: workflowGroups.value,
    imagesBySbId: imagesBySbId.value,
    videosBySbId: videosBySbId.value,
  })
  let nextNodes = graph.nodes.map((node) => {
    if (node.type !== 'canvasStoryboard') return node
    const storyboardId = node.data?.storyboard?.id
    return {
      ...node,
      data: {
        ...node.data,
        mediaQueryStatus: storyboardId != null ? getStoryboardMediaQueryStatus(storyboardId) : null,
      },
    }
  })
  let nextEdges = stampEdgeBaseStyles(graph.edges)
  if (highlightAssetId.value) {
    const highlighted = applyCanvasHighlight(nextNodes, nextEdges, highlightAssetId.value, drama.value)
    nextNodes = highlighted.nodes
    nextEdges = highlighted.edges
  }
  nodes.value = nextNodes
  edges.value = nextEdges
}

function applyHighlight() {
  if (!nodes.value.length) return
  const highlighted = applyCanvasHighlight(
    nodes.value.map((n) => ({ ...n, class: undefined, data: { ...n.data, highlighted: false, dimmed: false } })),
    edges.value,
    highlightAssetId.value,
    drama.value
  )
  nodes.value = highlighted.nodes
  edges.value = highlighted.edges
}

function selectSidebarAsset(assetNodeId) {
  highlightAssetId.value = highlightAssetId.value === assetNodeId ? null : assetNodeId
  applyHighlight()
}

function setHighlightAsset(assetNodeId) {
  highlightAssetId.value = assetNodeId
  applyHighlight()
}

async function refreshDrama(preserveFocus = true) {
  const keepId = preserveFocus ? focusedNodeId.value : null
  const loaded = await loadCanvasProject({ blocking: false, preserveOnError: true })
  if (!loaded) return false
  if (keepId) focusedNodeId.value = keepId
  return true
}

async function refreshCanvas(preserveFocus = true) {
  await refreshDrama(preserveFocus)
}

async function retryStoryboardMedia(storyboardId) {
  const found = findStoryboardInDrama(drama.value, storyboardId)
  const storyboard = found?.storyboard
  if (!storyboard) return false
  const result = await loadForStoryboards([storyboard], { prune: false })
  rebuildGraph()
  return result.failedCount === 0
}

async function retryUnknownStoryboardMedia() {
  if (!unknownMediaStoryboards.value.length) return
  await loadForStoryboards(unknownMediaStoryboards.value, { prune: false })
  rebuildGraph()
}

function suppressPaneClick(ms = 350) {
  paneClickSuppressed.value = true
  if (paneClickSuppressTimer) clearTimeout(paneClickSuppressTimer)
  paneClickSuppressTimer = setTimeout(() => {
    paneClickSuppressed.value = false
    paneClickSuppressTimer = null
  }, ms)
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

function onPaneContextMenu(payload) {
  const event = payload?.event || payload
  if (event?.preventDefault) event.preventDefault()
  const flowPos = payload?.flowPosition || screenToFlowPosition(event.clientX, event.clientY)
  contextMenuFlowPos.value = flowPos
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

function closeContextMenu() {
  contextMenuVisible.value = false
  contextMenuFlowPos.value = null
}

function onContextMenuSelect(type) {
  pendingFlowPosition.value = contextMenuFlowPos.value
  openCreateDialog(type, contextMenuFlowPos.value)
  closeContextMenu()
}

async function onCreateSubmit(form) {
  try {
    await submitCreate(form)
  } catch (e) {
    ElMessage.error(e?.message || '创建失败')
  }
}

function getCanvasGenerationOptions() {
  return {
    ...getDramaGenerationOptions(drama.value),
    imagesBySbId: imagesBySbId.value,
  }
}

function openAiConfig(serviceType) {
  const returnQuery = { ...route.query }
  if (filterEpisodeId.value != null) returnQuery.episode = String(filterEpisodeId.value)
  else delete returnQuery.episode
  if (focusedNodeId.value) returnQuery.focus = focusedNodeId.value
  else delete returnQuery.focus
  const returnTo = router.resolve({
    name: 'film-canvas',
    params: { id: String(dramaId.value) },
    query: returnQuery,
  }).fullPath
  router.push(buildAiConfigLocation({
    dramaId: dramaId.value,
    serviceType,
    returnTo,
  }))
}

function ensureProductionStepReady(step) {
  const gate = getCanvasProductionStepGate(step, productionActions.value)
  if (gate.ready) return true
  ElMessage.warning(gate.reason)
  return false
}

function ensureProductionPipelineReady(steps) {
  const gate = getCanvasPipelineProductionGate(steps, productionActions.value)
  if (gate.ready) return true
  ElMessage.warning(gate.reason)
  return false
}

async function refreshProductionReadiness() {
  const requestedDramaId = dramaId.value
  const requestId = ++readinessRequestId
  productionReadinessState.value = { status: 'loading', data: null }
  try {
    const response = await workflowRunsAPI.getNovel2AnimeReadiness({
      drama_id: requestedDramaId,
      qa_mode: 'production',
    })
    const normalized = normalizeCanvasProductionReadiness(response)
    if (requestId !== readinessRequestId || requestedDramaId !== dramaId.value) return
    productionReadinessState.value = { status: 'loaded', data: normalized }
  } catch (error) {
    if (requestId !== readinessRequestId || requestedDramaId !== dramaId.value) return
    productionReadinessState.value = {
      status: 'error',
      data: null,
      error: error?.message || '正式制作能力加载失败',
    }
  }
}

const scriptActionsHolder = {}

provide('localMiniDrama.canvas.openAiConfig', openAiConfig)
provide(CANVAS_CONTEXT_KEY, {
  focusedNodeId,
  drama,
  imagesBySbId,
  videosBySbId,
  mediaStatusBySbId,
  mediaValidity,
  productionActions,
  getGenerationOptions: getCanvasGenerationOptions,
  ensureProductionStepReady,
  getStoryboardMediaQueryStatus,
  retryStoryboardMedia,
  openAiConfig,
  setFocusedNode: setFocusedCanvasNode,
  registerFocusGuard,
  clearFocusedNode: (options) => setFocusedCanvasNode(null, options),
  setHighlightAsset,
  refresh: refreshCanvas,
  refreshDrama,
  suppressPaneClick,
  nodeStatus,
  openCreateDialog: (...args) => openCreateDialog(...args),
  scriptActions: scriptActionsHolder,
  registerCanvasFlowApi: (api) => {
    canvasFlowApi.value = api
  },
})

function clearAssetHighlight() {
  highlightAssetId.value = null
  applyHighlight()
}

function setPipelineSteps(value) {
  pipelineSteps.value = Array.isArray(value) ? value : []
}

function setActiveGroupId(value) {
  activeGroupId.value = value || null
}

async function confirmEpisodeSelection(value) {
  const episodeId = resolveCanvasEpisodeId(drama.value?.episodes, value)
  if (episodeId === null) {
    ElMessage.warning('该剧集已不可用，请重新选择')
    return
  }
  await requestEpisodeFilterChange(episodeId)
}

function onSelectionChange({ nodes: selectedNodes }) {
  selectedStoryboardIds.value = (selectedNodes || [])
    .filter((n) => n.type === 'canvasStoryboard' && n.data?.storyboard?.id)
    .map((n) => n.data.storyboard.id)
}

function onViewportChange(viewport) {
  currentViewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
}

function scheduleLayoutSave() {
  layoutDirty.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistCanvasState({ layoutOnly: true })
  }, 700)
}

async function persistCanvasState({ layoutOnly = false, groupsOnly = false, reportError = true } = {}) {
  if (!dramaId.value) {
    return { ok: false, error: new Error('项目尚未加载') }
  }

  let layoutPayload = null
  if (!groupsOnly) {
    layoutPayload = buildCanvasLayoutPayload(nodes.value, currentViewport.value, layoutCache.value)
    if (layoutOnly && layoutPayload) layoutCache.value = layoutPayload
  }
  const groupsPayload = groupsOnly || !layoutOnly ? workflowGroups.value : undefined

  layoutSaveState.value = 'saving'
  try {
    const updated = await dramaAPI.saveCanvasLayout(dramaId.value, layoutPayload, groupsPayload)
    const meta = parseDramaMetadata(updated.metadata)
    if (meta.canvas_layout) layoutCache.value = meta.canvas_layout
    if (meta.workflow_groups) workflowGroups.value = meta.workflow_groups
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
    layoutSaveState.value = 'saved'
    if (!groupsOnly) layoutDirty.value = false
    if (savedHintTimer) clearTimeout(savedHintTimer)
    savedHintTimer = setTimeout(() => {
      if (layoutSaveState.value === 'saved') layoutSaveState.value = 'idle'
    }, 2000)
    return { ok: true, updated }
  } catch (e) {
    layoutSaveState.value = 'error'
    if (reportError) ElMessage.error(e?.message || '保存失败')
    return { ok: false, error: e }
  }
}

const {
  workflowOrderSaving,
  reorderWorkflowStoryboards,
} = useCanvasWorkflowOrder({
  workflowGroups,
  persist: () => persistCanvasState({ groupsOnly: true, reportError: false }),
  onSaveFailed: (error) => {
    ElMessage.error(`分镜排序保存失败，已恢复原顺序：${error?.message || '保存失败'}`)
  },
  setMediaValidity: (nodeId, state) => {
    if (nodeId) mediaValidity[nodeId] = state
  },
  clearMediaValidity: (nodeId) => {
    if (nodeId) delete mediaValidity[nodeId]
  },
})

const {
  createDialogVisible,
  createDialogType,
  pendingFlowPosition,
  openCreateDialog,
  submitCreate,
} = useCanvasCrud({
  drama,
  filterEpisodeId,
  layoutCache,
  focusedNodeId,
  setFocusedNode: setFocusedCanvasNode,
  setEpisodeFilter: requestEpisodeFilterChange,
  refreshCanvas,
  persistCanvasState,
})

const {
  episodeGenerating,
  episodeGenProgress,
  aiGenerateStoryboards: runAiGenerateStoryboards,
  batchGenerateImages: runBatchGenerateImages,
  batchGenerateVideos: runBatchGenerateVideos,
} = useCanvasEpisodeGenerate({
  drama,
  filterEpisodeId,
  imagesBySbId,
  videosBySbId,
  refreshCanvas,
  nodeStatus,
})

async function aiGenerateStoryboards() {
  await runAiGenerateStoryboards()
}

async function batchGenerateImages() {
  if (!ensureKnownStoryboardMedia((currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id))) return
  await runBatchGenerateImages()
}

async function batchGenerateVideos() {
  if (!ensureProductionStepReady('video')) return
  if (!ensureKnownStoryboardMedia((currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id))) return
  await runBatchGenerateVideos()
}

Object.assign(
  scriptActionsHolder,
  useCanvasScript({
    drama,
    dramaId,
    refreshCanvas: refreshDrama,
    nodeStatus,
  })
)

async function focusScriptNode() {
  let epId = filterEpisodeId.value
  if (!epId) {
    const eps = drama.value?.episodes || []
    if (eps.length === 1) epId = eps[0].id
  }
  if (!epId) {
    ElMessage.warning('请先选择或新建集数')
    return
  }
  if (!filterEpisodeId.value && !await requestEpisodeFilterChange(epId)) return
  await setFocusedCanvasNode(scriptNodeId(epId))
}

async function onAlignNodes() {
  if (!drama.value || !nodes.value.length || aligningNodes.value) return
  if (!await setFocusedCanvasNode(null)) return
  aligningNodes.value = true
  try {
    const { positions } = computeAutoLayoutPositions(drama.value, {
      episodeId: filterEpisodeId.value,
      workflowGroups: workflowGroups.value,
      imagesBySbId: imagesBySbId.value,
      videosBySbId: videosBySbId.value,
    })
    nodes.value = nodes.value.map((n) => {
      const pos = positions[n.id]
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    })
    layoutCache.value = {
      version: 1,
      nodes: { ...positions },
      viewport: layoutCache.value?.viewport,
    }
    await nextTick()
    const flowApi = canvasFlowApi.value
    if (flowApi?.fitView) {
      await flowApi.fitView({
        padding: 0.14,
        minZoom: MIN_READABLE_CANVAS_ZOOM,
        maxZoom: 1,
        duration: 380,
        includeHiddenNodes: false,
      })
      await new Promise((r) => setTimeout(r, 400))
      const vp = flowApi.getViewport?.()
      if (vp) {
        currentViewport.value = { x: vp.x, y: vp.y, zoom: vp.zoom }
      }
    }
    await persistCanvasState({ layoutOnly: true })
    ElMessage.success('节点已按规则对齐并适配当前视图')
  } catch (e) {
    ElMessage.error(e?.message || '对齐失败')
  } finally {
    aligningNodes.value = false
  }
}

async function loadDrama(silent = false) {
  if (!dramaId.value) return
  if (!silent) loading.value = true
  try {
    drama.value = await dramaAPI.get(dramaId.value)
    layoutCache.value = parseCanvasLayout(drama.value.metadata)
    syncWorkflowFromDrama()
    const vp = resolveViewport(layoutCache.value)
    currentViewport.value = vp
    if (route.query.episode) filterEpisodeId.value = Number(route.query.episode)
    await loadForDrama(drama.value, filterEpisodeId.value)
    rebuildGraph()
  } catch (e) {
    if (!silent) ElMessage.error(e?.message || '加载项目失败')
  } finally {
    if (!silent) loading.value = false
  }
}

async function onCreateWorkflowGroup() {
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
    workflowGroups.value = createWorkflowGroup(workflowGroups.value, {
      title: value?.trim() || undefined,
      storyboardIds: selectedStoryboardIds.value,
      pipeline: normalizePipeline(pipelineSteps.value, { allowEmpty: true }),
    })
    activeGroupId.value = workflowGroups.value[workflowGroups.value.length - 1]?.id || null
    await persistCanvasState({ groupsOnly: true })
    rebuildGraph()
    ElMessage.success('工作流已创建')
  } catch (_) {}
}

async function onDeleteActiveGroup() {
  if (!activeGroupId.value) return
  try {
    await ElMessageBox.confirm('确定删除该工作流？', '删除工作流', { type: 'warning' })
    workflowGroups.value = deleteWorkflowGroup(workflowGroups.value, activeGroupId.value)
    activeGroupId.value = workflowGroups.value[0]?.id || null
    await persistCanvasState({ groupsOnly: true })
    rebuildGraph()
    ElMessage.success('已删除')
  } catch (_) {}
}

async function onRunActiveGroup() {
  const group = workflowGroups.value.find((g) => g.id === activeGroupId.value)
  if (!group) {
    ElMessage.warning('请先选择工作流')
    return
  }
  const workflowSteps = activeWorkflowSteps.value
  if (!ensureProductionPipelineReady(workflowSteps)) return
  if (pipelineTouchesBillableMedia(workflowSteps) && !ensureKnownStoryboardMedia(group.storyboard_ids || [])) return
  try {
    await ElMessageBox.confirm(
      `将对 ${(group.storyboard_ids || []).length} 个分镜依次执行：${workflowSteps.join(' → ')}\n耗时可能较长，是否继续？`,
      '整组重跑',
      { type: 'warning', confirmButtonText: '开始执行' }
    )
  } catch {
    return
  }

  workflowRunning.value = true
  workflowProgress.value = '准备执行…'
  try {
    const summary = await runWorkflowGroup(drama.value, {
      ...group,
      pipeline: workflowSteps,
    }, {
      stopOnError: true,
      generationOptions: getCanvasGenerationOptions(),
      reloadStoryboard: async (storyboardId) => {
        await loadCanvasProject({ blocking: false, preserveOnError: true })
        return findStoryboardInDrama(drama.value, storyboardId)?.storyboard
      },
      onStepStart: ({ storyboardId, step }) => {
        workflowProgress.value = `分镜 #${storyboardId}：${step === 'image' ? '生图' : step === 'video' ? '生视频' : '配音'}…`
      },
      onStoryboardError: ({ storyboardId, error }) => {
        ElMessage.error(`分镜 #${storyboardId} 失败：${error?.message || error}`)
      },
    })
    await loadCanvasProject({ blocking: false, preserveOnError: true })
    if (summary.failed.length) {
      ElMessage.warning(`完成 ${summary.ok.length} 镜，失败 ${summary.failed.length} 镜`)
    } else {
      ElMessage.success(`工作流执行完成，共 ${summary.ok.length} 镜`)
    }
  } catch (e) {
    ElMessage.error(e?.message || '工作流执行失败')
  } finally {
    workflowRunning.value = false
    workflowProgress.value = ''
  }
}

function hasProcessingStoryboards() {
  for (const ep of drama.value?.episodes || []) {
    for (const sb of ep.storyboards || []) {
      if (sb.status === 'processing') return true
    }
  }
  return false
}

function startStatusPoll() {
  stopStatusPoll()
  if (!hasProcessingStoryboards()) return
  pollTimer = setInterval(() => {
    if (hasProcessingStoryboards()) loadCanvasProject({ blocking: false, preserveOnError: true })
    else stopStatusPoll()
  }, 8000)
}

function stopStatusPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.query.returnTo))

function goProjectList() {
  router.push(projectListReturnTo.value || '/')
}

function goListMode() {
  const query = filterEpisodeId.value ? { episode: String(filterEpisodeId.value) } : {}
  if (projectListReturnTo.value) query.returnTo = projectListReturnTo.value
  router.push({ path: `/film/${dramaId.value}`, query })
}

function navigateToStoryboard(episodeId, storyboardId) {
  const query = episodeId ? { episode: String(episodeId) } : {}
  if (projectListReturnTo.value) query.returnTo = projectListReturnTo.value
  router.push({
    path: `/film/${dramaId.value}`,
    query,
    hash: storyboardId ? `#sb-${storyboardId}` : undefined,
  })
}

function onNodeDoubleClick({ node }) {
  if (node.type === 'canvasStoryboard') {
    navigateToStoryboard(node.data.episodeId || node.data.storyboard?.episode_id, node.data.storyboard?.id)
    return
  }
  const ref = getStoryboardRefFromNode(node)
  if (ref?.storyboardId) navigateToStoryboard(ref.episodeId, ref.storyboardId)
}

async function onPaneClick(event) {
  if (paneClickSuppressed.value) return
  const target = event?.event?.target || event?.target
  if (target?.closest?.('.canvas-node-panel') || target?.closest?.('.canvas-inspector-dock') || target?.closest?.('.el-popper') || target?.closest?.('.canvas-context-menu')) {
    return
  }
  await setFocusedCanvasNode(null, { restoreFocus: true })
  closeContextMenu()
}

async function onNodeClick({ node, event }) {
  if (node.type === 'canvasAddButton') {
    event?.stopPropagation?.()
    openCreateDialog(node.data?.assetType || 'storyboard')
    return
  }

  if (PANEL_NODE_TYPES.has(node.type)) {
    const changed = await setFocusedCanvasNode(node.id)
    if (!changed) {
      restoreFocusedNodeSelection()
      return
    }
  }

  if (node.type === 'canvasAsset') {
    const prefix = node.data.kind === 'character' ? 'char' : node.data.kind === 'scene' ? 'scene' : 'prop'
    selectSidebarAsset(`${prefix}:${node.data.entity.id}`)
    return
  }
  const sbId = storyboardIdFromNodeId(node.id)
  if (sbId) activeGroupId.value = workflowGroups.value.find((g) => (g.storyboard_ids || []).includes(sbId))?.id || activeGroupId.value
}

watch(filterEpisodeId, async (val) => {
  if (drama.value) await loadForDrama(drama.value, val)
  rebuildGraph()
  const query = { ...route.query }
  if (val != null) query.episode = String(val)
  else delete query.episode
  router.replace({ query }).catch(() => {})
})

watch(() => route.params.id, () => {
  highlightAssetId.value = null
  layoutCache.value = null
  activeGroupId.value = null
  selectedStoryboardIds.value = []
  void setFocusedCanvasNode(null, { force: true })
  initialFitDone.value = false
  canvasInteractive.value = true
  for (const key of Object.keys(mediaValidity)) delete mediaValidity[key]
  productionReadinessState.value = { status: 'loading', data: null }
  refreshProductionReadiness()
  loadCanvasProject({ blocking: true, preserveOnError: false })
}, { immediate: true })

watch(drama, () => startStatusPoll())

function updateCanvasViewportReady() {
  const rect = canvasMainRef.value?.getBoundingClientRect?.()
  canvasViewportReady.value = Boolean(rect && rect.width > 0 && rect.height > 0)
}

onMounted(() => {
  window.addEventListener('beforeunload', handleCanvasBeforeUnload)
  canvasReadyFrame = window.requestAnimationFrame(() => {
    updateCanvasViewportReady()
    if (typeof ResizeObserver === 'function' && canvasMainRef.value) {
      canvasResizeObserver = new ResizeObserver(updateCanvasViewportReady)
      canvasResizeObserver.observe(canvasMainRef.value)
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleCanvasBeforeUnload)
  readinessRequestId++
  if (saveTimer) clearTimeout(saveTimer)
  if (savedHintTimer) clearTimeout(savedHintTimer)
  if (paneClickSuppressTimer) clearTimeout(paneClickSuppressTimer)
  if (canvasReadyFrame != null) window.cancelAnimationFrame(canvasReadyFrame)
  canvasResizeObserver?.disconnect()
  stopStatusPoll()
  if (layoutDirty.value) persistCanvasState({ layoutOnly: true })
})
</script>

<style scoped>
.drama-canvas-page {
  --canvas-project-surface: linear-gradient(135deg, rgba(49, 46, 129, 0.55), rgba(24, 24, 27, 0.92));
  --canvas-episode-surface: rgba(76, 29, 149, 0.35);
  --canvas-script-surface: rgba(120, 53, 15, 0.35);
  --canvas-card-surface: var(--bg-card, #18181b);
  --canvas-node-surface: rgba(24, 24, 27, 0.95);
  --canvas-add-surface: rgba(24, 24, 27, 0.65);
  --canvas-add-character-surface: var(--canvas-add-surface);
  --canvas-add-scene-surface: var(--canvas-add-surface);
  --canvas-add-prop-surface: var(--canvas-add-surface);
  --canvas-add-storyboard-surface: var(--canvas-add-surface);
  --canvas-media-text-surface: var(--canvas-node-surface);
  --canvas-media-universal-surface: var(--canvas-node-surface);
  --canvas-media-image-surface: var(--canvas-node-surface);
  --canvas-media-video-surface: var(--canvas-node-surface);
  --canvas-media-audio-surface: var(--canvas-node-surface);
  --canvas-panel-surface: rgba(15, 15, 18, 0.97);
  --canvas-media-well: #09090b;
  --canvas-video-well: #000000;
  --canvas-chip-surface: rgba(255, 255, 255, 0.08);
  --canvas-chip-surface-soft: rgba(255, 255, 255, 0.06);
  --canvas-loading-surface: rgba(9, 9, 11, 0.82);
  --canvas-spinner-track: rgba(255, 255, 255, 0.12);
  --canvas-overlay-surface: rgba(9, 9, 11, 0.72);
  --canvas-overlay-text: #e4e4e7;
  --canvas-project-title: #f4f4f5;
  --canvas-text-primary: #e4e4e7;
  --canvas-text-secondary: #d4d4d8;
  --canvas-text-muted: #a1a1aa;
  --canvas-text-subtle: #71717a;
  --canvas-text-faint: #52525b;
  --canvas-episode-text: #e9d5ff;
  --canvas-indigo-text: #a5b4fc;
  --canvas-indigo-strong: #818cf8;
  --canvas-violet-text: #c4b5fd;
  --canvas-amber-text: #fcd34d;
  --canvas-amber-strong: #fbbf24;
  --canvas-emerald-text: #6ee7b7;
  --canvas-blue-text: #93c5fd;
  --canvas-pink-text: #f472b6;
  --canvas-success-text: #34d399;
  --canvas-info-text: #60a5fa;
  --canvas-danger-text: #f87171;
  --canvas-indigo-border: rgba(129, 140, 248, 0.45);
  --canvas-violet-border: rgba(167, 139, 250, 0.5);
  --canvas-amber-border: rgba(251, 191, 36, 0.45);
  --canvas-emerald-border: rgba(52, 211, 153, 0.45);
  --canvas-blue-border: rgba(96, 165, 250, 0.45);
  --canvas-pink-border: rgba(244, 114, 182, 0.45);
  --canvas-raised-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  --canvas-node-focus-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  --canvas-project-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  --canvas-divider: rgba(63, 63, 70, 0.6);
  --canvas-divider-strong: rgba(63, 63, 70, 0.8);
  --canvas-focus-ring: #818cf8;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-page, #0f0f12);
  color: var(--text-primary, #e4e4e7);
  overflow: hidden;
}

.header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color, #27272a);
  background: var(--bg-card, #18181b);
}

.header-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px 6px;
  flex-wrap: wrap;
}

.canvas-warning-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 20px 12px;
  border-top: 1px solid rgba(251, 191, 36, 0.18);
  color: var(--canvas-amber-text, #fcd34d);
  font-size: 12px;
  background: rgba(251, 191, 36, 0.06);
}

.canvas-warning-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.workflow-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 10px;
  flex-wrap: wrap;
}

.wf-hint {
  font-size: 12px;
  color: var(--text-subtle, #71717a);
}

.wf-steps {
  display: flex;
  gap: 4px;
}

.workflow-progress {
  padding: 0 20px 8px;
  font-size: 12px;
  color: var(--canvas-info-text);
}

.workflow-progress.episode-gen {
  color: var(--canvas-success-text);
}

.generate-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 10px;
  flex-wrap: wrap;
  border-top: 1px solid rgba(63, 63, 70, 0.35);
  margin-top: 2px;
  padding-top: 8px;
}

.gen-label {
  font-size: 12px;
  font-weight: 600;
  color: #a1a1aa;
  margin-right: 4px;
}

.gen-hint {
  font-size: 11px;
  color: #52525b;
  flex: 1;
  min-width: 200px;
}

.logo {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.logo-main {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-bright, #fafafa);
}

.logo-sub {
  font-size: 11px;
  color: var(--canvas-indigo-strong);
}

.breadcrumb-sep { color: var(--text-faint, #52525b); }

.page-title {
  font-size: 14px;
  color: var(--text-muted, #a1a1aa);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-status { font-size: 12px; }
.layout-status.saving { color: var(--canvas-info-text); }
.layout-status.saved { color: var(--canvas-success-text); }
.layout-status.error { color: var(--canvas-danger-text); }

.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.canvas-shell {
  flex: 1;
  display: flex;
  min-height: 0;
}

.canvas-load-failure {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

.canvas-load-failure-card {
  width: min(520px, 100%);
  padding: 24px;
  border-radius: 8px;
  border: 1px solid var(--canvas-danger-text, #f87171);
  background: var(--canvas-card-surface, #18181b);
  box-shadow: var(--canvas-raised-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
}

.canvas-load-eyebrow {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--canvas-danger-text, #f87171);
}

.canvas-load-title {
  margin: 0 0 10px;
  font-size: 22px;
  line-height: 1.2;
  color: var(--text-bright, #fafafa);
}

.canvas-load-message,
.canvas-load-detail {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--canvas-text-secondary, #d4d4d8);
}

.canvas-load-detail {
  margin-top: 8px;
  color: var(--canvas-text-muted, #a1a1aa);
}

.canvas-load-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.canvas-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, #27272a);
  background: var(--bg-card, #18181b);
  padding: 14px 12px;
  overflow-y: auto;
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--text-bright, #fafafa);
}

.sidebar-section { margin-bottom: 14px; }
.sidebar-script {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #27272a);
}

.sec-label {
  font-size: 11px;
  color: var(--text-subtle, #71717a);
  margin-bottom: 6px;
}

.sec-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-item {
  width: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text-primary, #e4e4e7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}
.sidebar-item:hover { background: rgba(129, 140, 248, 0.12); }
.sidebar-item:focus-visible { outline: 2px solid var(--canvas-indigo-strong); outline-offset: 1px; }
.sidebar-item.active { background: rgba(52, 211, 153, 0.16); color: var(--canvas-emerald-text); }

.workflow-item { white-space: normal; }
.wf-item-title { font-weight: 600; }
.wf-item-meta { font-size: 10px; color: var(--text-faint, #52525b); margin-top: 2px; }
.sidebar-empty { font-size: 11px; color: var(--text-faint, #52525b); padding: 4px 0; }


.canvas-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  position: relative;
  transition: margin-right 0.2s ease;
}
.drama-canvas-page.inspector-open .canvas-main {
  margin-right: 480px;
}
.logo:focus-visible { outline: 2px solid var(--canvas-indigo-strong); outline-offset: 4px; }

.vue-flow-canvas {
  width: 100%;
  height: 100%;
  background: #0c0c0f;
}

:deep(.vue-flow__minimap) {
  background: rgba(24, 24, 27, 0.92);
  border: 1px solid #3f3f46;
}

:deep(.vue-flow__controls) {
  box-shadow: none;
  border: 1px solid #3f3f46;
}

:deep(.vue-flow__controls button) {
  background: #18181b;
  border-color: #3f3f46;
  color: var(--canvas-text-primary);
}
:deep(.vue-flow__controls button:focus-visible) {
  position: relative;
  z-index: 1;
  outline: 3px solid var(--canvas-focus-ring);
  outline-offset: 2px;
}

:deep(.vue-flow__node.selected) {
  box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.8);
}

@media (max-width: 1100px) {
  .drama-canvas-page.inspector-open .canvas-main {
    margin-right: 0;
  }
}
</style>

<style>
html.light .drama-canvas-page {
  --canvas-project-surface: linear-gradient(135deg, #eef2ff 0%, #ffffff 72%);
  --canvas-episode-surface: #f5f3ff;
  --canvas-script-surface: #fffbeb;
  --canvas-card-surface: #ffffff;
  --canvas-node-surface: #ffffff;
  --canvas-add-surface: rgba(255, 255, 255, 0.96);
  --canvas-add-character-surface: #f0fdf4;
  --canvas-add-scene-surface: #eff6ff;
  --canvas-add-prop-surface: #fffbeb;
  --canvas-add-storyboard-surface: #f5f3ff;
  --canvas-media-text-surface: #ffffff;
  --canvas-media-universal-surface: #faf5ff;
  --canvas-media-image-surface: #eef2ff;
  --canvas-media-video-surface: #fdf2f8;
  --canvas-media-audio-surface: #fffbeb;
  --canvas-panel-surface: rgba(255, 255, 255, 0.98);
  --canvas-media-well: #f3f4f6;
  --canvas-video-well: #e5e7eb;
  --canvas-chip-surface: rgba(15, 23, 42, 0.08);
  --canvas-chip-surface-soft: rgba(15, 23, 42, 0.06);
  --canvas-loading-surface: rgba(17, 24, 39, 0.82);
  --canvas-spinner-track: rgba(15, 23, 42, 0.16);
  --canvas-project-title: #312e81;
  --canvas-text-primary: #27272a;
  --canvas-text-secondary: #374151;
  --canvas-text-muted: #4b5563;
  --canvas-text-subtle: #6b7280;
  --canvas-text-faint: #6b7280;
  --canvas-episode-text: #4c1d95;
  --canvas-indigo-text: #4338ca;
  --canvas-indigo-strong: #4f46e5;
  --canvas-violet-text: #6d28d9;
  --canvas-amber-text: #92400e;
  --canvas-amber-strong: #b45309;
  --canvas-emerald-text: #047857;
  --canvas-blue-text: #1d4ed8;
  --canvas-pink-text: #be185d;
  --canvas-success-text: #047857;
  --canvas-info-text: #1d4ed8;
  --canvas-danger-text: #b91c1c;
  --canvas-indigo-border: rgba(67, 56, 202, 0.48);
  --canvas-violet-border: rgba(109, 40, 217, 0.5);
  --canvas-amber-border: rgba(180, 83, 9, 0.5);
  --canvas-emerald-border: rgba(4, 120, 87, 0.5);
  --canvas-blue-border: rgba(29, 78, 216, 0.48);
  --canvas-pink-border: rgba(190, 24, 93, 0.45);
  --canvas-raised-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  --canvas-node-focus-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  --canvas-project-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  --canvas-divider: #e4e4e7;
  --canvas-divider-strong: #d4d4d8;
  --canvas-focus-ring: #6d28d9;
  background: var(--bg-page);
}
html.light .vue-flow-canvas { background: #eef2ff; }
html.light .drama-canvas-page .sidebar-item.active {
  background: rgba(4, 120, 87, 0.12);
  color: var(--canvas-emerald-text);
}
html.light .drama-canvas-page .wf-item-meta,
html.light .drama-canvas-page .sidebar-workflow-empty p {
  color: var(--canvas-text-subtle);
}
html.light .drama-canvas-page .vue-flow__minimap {
  background: rgba(255, 255, 255, 0.94);
  border-color: #c7d2fe;
}
html.light .drama-canvas-page .vue-flow__minimap-mask {
  fill: rgba(79, 70, 229, 0.08);
}
html.light .drama-canvas-page .vue-flow__minimap-node {
  fill: #c7d2fe;
  stroke: #6366f1;
}
html.light .drama-canvas-page .vue-flow__controls {
  border-color: #c7d2fe;
}
html.light .drama-canvas-page .vue-flow__controls button {
  background: #ffffff;
  border-color: #d4d4d8;
  color: #27272a;
}
html.light .drama-canvas-page .vue-flow__controls button:hover {
  background: #f5f3ff;
  color: #6d28d9;
}
</style>
