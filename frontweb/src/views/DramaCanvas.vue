<template>
  <div
    class="drama-canvas-page"
    :class="{
      'inspector-open': focusedNodeId,
      'free-inspector-open': selectedFreeNodeId,
      'free-mode': canvasMode === 'free',
    }"
  >
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
          aria-label="筛选画布集数"
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
        <span
          v-if="layoutSaveError"
          class="layout-save-error"
          role="alert"
          :title="layoutSaveError"
        >{{ layoutSaveError }}</span>
        <el-button
          v-if="layoutSaveState === 'error'"
          link
          size="small"
          type="warning"
          aria-label="重试保存画布"
          @click="retryCanvasSave"
        >
          重试保存
        </el-button>

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
        :canvas-mode="canvasMode"
        @edit-script="focusScriptNode"
        @create="openCreateDialog"
        @align="onAlignNodes"
        @list-mode="goListMode"
        @toggle-theme="toggleTheme"
        @set-mode="setCanvasMode"
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
        v-if="freeCanvasReadOnly"
        class="canvas-warning-bar free-canvas-version-warning"
        role="alert"
      >
        <span>{{ freeCanvasCompatibilityMessage }}</span>
        <div class="canvas-warning-actions">
          <el-button link size="small" @click="goListMode">返回项目列表</el-button>
        </div>
      </div>
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
      <FreeCanvasAssetSidebar
        v-if="drama && canvasMode === 'free' && freeLibraryVisible"
        :characters="drama.characters || []"
        :scenes="drama.scenes || []"
        :props-list="drama.props || []"
        :storyboard-media="freeStoryboardMediaItems"
        :assets="projectAssets"
        :project-id="dramaId"
        :uploading="freeCanvasUploading"
        :upload-status="freeCanvasUploadStatus"
        @add-entity="createFreeEntityReference"
        @add-media="createFreeNodeFromLibraryItem"
        @upload-files="uploadFreeCanvasFiles"
        @open-picker="openFreeCanvasMediaPicker"
        @close="freeLibraryVisible = false"
      />
      <aside v-if="drama && canvasMode === 'production'" class="canvas-sidebar">
        <div v-if="canvasMode === 'production'" class="sidebar-section sidebar-script">
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
            <el-button v-if="canvasMode === 'production'" link size="small" type="primary" aria-label="新建角色" @click="openCreateDialog('character')">+</el-button>
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
            <el-button v-if="canvasMode === 'production'" link size="small" type="primary" aria-label="新建场景" @click="openCreateDialog('scene')">+</el-button>
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
            <el-button v-if="canvasMode === 'production'" link size="small" type="primary" aria-label="新建道具" @click="openCreateDialog('prop')">+</el-button>
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
          v-if="canvasMode === 'production'"
          :workflow-groups="workflowGroups"
          :active-group-id="activeGroupId"
          :storyboard-details="workflowStoryboardDetails"
          :reorder-disabled="workflowOrderSaving || workflowRunning"
          :reorder-pending="workflowOrderSaving"
          @select-group="setActiveGroupId"
          @reorder-storyboards="reorderWorkflowStoryboards"
        />

      </aside>

      <div ref="canvasMainRef" class="canvas-main" @dragover="onFreeCanvasDragOver" @drop="onFreeCanvasDrop">
        <VueFlow
          v-if="canvasViewportReady && (nodes.length || canvasMode === 'free')"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :default-viewport="initialViewport"
          :min-zoom="0.25"
          :max-zoom="2"
          :nodes-connectable="canvasMode === 'free'"
          :is-valid-connection="isValidFreeConnection"
          :delete-key-code="null"
          :elements-selectable="true"
          :selection-key-code="true"
          :pan-on-drag="[1, 2]"
          :pan-on-scroll="true"
          :fit-view-on-init="false"
          :only-render-visible-elements="!focusedNodeId && !selectedFreeNodeId"
          class="vue-flow-canvas"
          @node-double-click="onNodeDoubleClick"
          @node-click="onNodeClick"
          @pane-click="onPaneClick"
          @pane-context-menu="onPaneContextMenu"
          @node-drag-stop="onCanvasNodeDragStop"
          @selection-drag-stop="onCanvasNodeDragStop"
          @connect="onFreeCanvasConnect"
          @viewport-change="onViewportChange"
          @move-end="onCanvasMoveEnd"
          @selection-change="onSelectionChange"
          @nodes-initialized="onCanvasNodesInitialized"
        >
          <CanvasFlowAligner />
          <Background
            v-if="canvasBackgroundMode !== 'none'"
            :variant="canvasBackgroundMode"
            pattern-color="#3f3f46"
            :gap="20"
          />
          <template #node-freeCanvas="slotProps">
            <FreeCanvasNode
              :node="slotProps.data.freeNode"
              :free-mode="canvasMode === 'free'"
              :readonly="canvasMode !== 'free'"
              :editing="String(editingFreeNodeId) === String(slotProps.data.freeNode.id)"
              :media-url="resolveFreeCanvasNodeMediaUrl(slotProps.data.freeNode)"
              :config-runtime="freeCanvasConfigRuntime(slotProps.data.freeNode)"
              @update-content="updateFreeNodeContent"
              @request-convert="openFreeCanvasInspectorFor"
              @request-delete="deleteFreeCanvasNode"
              @request-retry="retryFreeCanvasNode"
              @request-configure="configureFreeCanvasNode"
              @request-cancel-config="cancelFreeCanvasConfig"
              @request-retry-config="retryFreeCanvasConfig"
              @request-finish-edit="finishFreeCanvasNodeEditing"
            />
          </template>
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
          v-if="canvasMode === 'production' && !loading && canvasStartMode"
          :mode="canvasStartMode"
          :episodes="drama?.episodes || []"
          :selected-episode-id="filterEpisodeId"
          @create-episode="openCreateDialog('episode')"
          @confirm-episode="confirmEpisodeSelection"
          @go-list="goListMode"
        />
        <section
          v-if="canvasMode === 'free' && !loading && !freeCanvas.nodes.length"
          class="free-canvas-empty-state"
          aria-labelledby="free-canvas-empty-title"
        >
          <h2 id="free-canvas-empty-title">开始自由创作</h2>
          <div class="free-canvas-empty-actions">
            <el-button type="primary" @click="createFreeCanvasNode('text')">
              <el-icon><Document /></el-icon>
              新建文本
            </el-button>
            <el-button @click="createFreeCanvasNode('config')">
              <el-icon><Setting /></el-icon>
              新建配置
            </el-button>
            <el-button @click="openFreeCanvasMediaPicker">
              <el-icon><FolderOpened /></el-icon>
              导入媒体
            </el-button>
          </div>
        </section>
        <FreeCanvasToolbar
          v-if="canvasMode === 'free'"
          class="free-canvas-bottom-toolbar"
          :mode="canvasMode"
          :show-mode-switch="false"
          :can-undo="canUndoFreeCanvas"
          :can-redo="canRedoFreeCanvas"
          :background-mode="freeCanvas.background"
          :library-visible="freeLibraryVisible"
          :selection-count="selectedFreeNodeIds.length"
          @create-node="createFreeCanvasNode"
          @undo="undoFreeCanvas"
          @redo="redoFreeCanvas"
          @fit-view="fitCanvasView"
          @set-background="setFreeCanvasBackground"
          @toggle-library="toggleFreeCanvasLibrary"
          @copy-selection="copyFreeCanvasSelection"
          @delete-selection="deleteFreeCanvasSelection"
        />
      </div>
      <div v-if="workflowOutcomeUnknown" class="canvas-warning-bar" role="alert">
        <span>上一次配音请求结果待确认，后台合成和供应商计费可能仍在继续。刷新项目状态后才能再次执行整组工作流。</span>
        <div class="canvas-warning-actions">
          <el-button link size="small" :loading="loading" @click="refreshUnknownWorkflowOutcome">刷新项目状态</el-button>
        </div>
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
      :free-mode="canvasMode === 'free'"
      @select="onContextMenuSelect"
      @free-node="onContextMenuFreeNode"
      @close="closeContextMenu"
    />
    <GlobalMediaPickerDialog
      v-model="freeMediaPickerVisible"
      title="添加自由画布素材"
      accept="all"
      :context="freeMediaPickerContext"
      @select="createFreeNodeFromAsset"
      @open-library="goMediaLibrary"
    />
    <FreeCanvasInspector
      v-if="selectedFreeNode"
      :key="`${dramaId}:${selectedFreeNode.id}`"
      class="free-canvas-inspector-dock"
      :data-free-inspector-node-id="String(selectedFreeNode.id)"
      :node="selectedFreeNode"
      :readonly="canvasMode !== 'free' || freeCanvasReadOnly"
      :busy="freeInspectorBusy"
      :converting="freeInspectorAction === 'convert'"
      :saving-asset="freeInspectorAction === 'save-asset'"
      :save-asset-eligibility="selectedFreeAssetEligibility"
      :asset-options="freeAssetOptions"
      :storyboard-options="freeStoryboardOptions"
      :conversion-targets="freeConversionTargets"
      :config-runtime="selectedFreeConfigRuntime"
      @update-node="updateFreeCanvasNode"
      @convert-reference="convertFreeCanvasReference"
      @save-asset="saveFreeCanvasNodeAsAsset"
      @configure="configureFreeCanvasNode"
      @cancel-config="cancelFreeCanvasConfig"
      @retry-config="retryFreeCanvasConfig"
      @close="closeFreeCanvasInspector"
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
import { Document, FolderOpened, FullScreen, Lock, Setting, Unlock, ZoomIn, ZoomOut } from '@element-plus/icons-vue'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import { dramaAPI } from '@/api/drama'
import { assetsAPI } from '@/api/assets'
import { characterAPI } from '@/api/characters'
import { propAPI } from '@/api/props'
import { sceneAPI } from '@/api/scenes'
import { storyboardsAPI } from '@/api/storyboards'
import { workflowRunsAPI } from '@/api/workflowRuns'
import { aiAPI } from '@/api/ai'
import { uploadAPI } from '@/api/upload'
import { useTheme } from '@/composables/useTheme'
import { runWorkflowGroup } from '@/composables/useCanvasWorkflowRunner'
import { CANVAS_CONTEXT_KEY } from '@/composables/useCanvasContext'
import { useCanvasStoryboardMedia } from '@/composables/useCanvasStoryboardMedia'
import { useCanvasCrud } from '@/composables/useCanvasCrud'
import { useCanvasEpisodeGenerate } from '@/composables/useCanvasEpisodeGenerate'
import { useCanvasScript, scriptNodeId } from '@/composables/useCanvasScript'
import { createCanvasNodeStatusStore } from '@/composables/useCanvasNodeStatus'
import { createCanvasNodeGenerationCoordinator } from '@/utils/canvasNodeGenerationCoordinator'
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
  parseFreeCanvas,
  resolveViewport,
} from '@/utils/canvasLayout'
import { buildFreeCanvasGraph, mergeCanvasGraphs } from '@/utils/freeCanvasAdapter'
import { buildFreeCanvasConfigRuntime } from '@/utils/freeCanvasConfigState'
import {
  FREE_CANVAS_MEDIA_DRAG_TYPE,
  buildFreeCanvasAssetReferencePatch,
  freeCanvasMediaUrl,
  buildFreeCanvasStoryboardMediaItems,
  getFreeCanvasAssetSaveEligibility,
  normalizeFreeCanvasMediaPath,
  parseFreeCanvasMediaDragPayload,
  resolveFreeCanvasMediaPath,
} from '@/utils/freeCanvasMedia'
import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
} from '@/utils/mediaUploadValidation'
import { createCanvasHistory } from '@/utils/canvasHistory'
import { createCanvasSaveCoordinator } from '@/utils/canvasSaveCoordinator'
import {
  cloneFreeSelection,
  createEmptyFreeCanvas,
  createFreeEdge,
  createFreeNode,
  findFreeNodeSpawnPosition,
  inspectFreeCanvasCompatibility,
  normalizeFreeCanvas,
  removeFreeSelection,
  screenRectToFreeCanvasBounds,
  serializeFreeCanvas,
  synchronizeFreeCanvasSelection,
} from '@/utils/freeCanvasState'
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
import { runWithOwnedRequestErrorToast } from '@/utils/request.js'
import { buildAiConfigLocation } from '@/utils/sourceWorkflowLaunch'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import { getVideoGenerationCapability } from '@/utils/filmCreateActionState'

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
import FreeCanvasInspector from '@/components/dramaCanvas/FreeCanvasInspector.vue'
import FreeCanvasAssetSidebar from '@/components/dramaCanvas/FreeCanvasAssetSidebar.vue'
import FreeCanvasNode from '@/components/dramaCanvas/FreeCanvasNode.vue'
import FreeCanvasToolbar from '@/components/dramaCanvas/FreeCanvasToolbar.vue'
import GlobalMediaPickerDialog from '@/components/GlobalMediaPickerDialog.vue'

const route = useRoute()
const router = useRouter()
const canvasProjectId = computed(() => Number(route.params.id))
const canvasInstanceActive = ref(true)
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
const productionGraph = ref({ nodes: [], edges: [] })
const freeCanvas = ref(createEmptyFreeCanvas())
const freeCanvasReadOnly = ref(false)
const freeCanvasCompatibilityMessage = ref('')
const canvasMode = ref('production')
const selectedFreeNodeId = ref(null)
const selectedFreeNodeIds = ref([])
const selectedFreeEdgeIds = ref([])
const editingFreeNodeId = ref(null)
const freeInspectorBusy = ref(false)
const freeInspectorAction = ref('')
const projectAssets = ref([])
const freeMediaPickerVisible = ref(false)
const freeLibraryVisible = ref(true)
const freeCanvasUploading = ref(false)
const freeCanvasUploadStatus = ref('')
const filterEpisodeId = ref(null)
const highlightAssetId = ref(null)
const layoutCache = ref(null)
const workflowGroups = ref([])
const activeGroupId = ref(null)
const selectedStoryboardIds = ref([])
const pipelineSteps = ref(['image', 'video', 'audio'])
const workflowRunStarting = ref(false)
const workflowRunning = ref(false)
const workflowProgress = ref('')
const activeWorkflowRun = ref(null)
const workflowOutcomeUnknown = ref(false)
const layoutSaveState = ref('idle')
const layoutSaveError = ref('')
const failedCanvasSaveOperation = ref(null)
const layoutDirty = ref(false)
const currentViewport = ref({ x: 0, y: 0, zoom: 0.9 })
const productionViewport = ref({ x: 0, y: 0, zoom: 0.9 })
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
const nodeGenerationCoordinator = createCanvasNodeGenerationCoordinator()
const aligningNodes = ref(false)
const canvasFlowApi = ref(null)
const canvasInteractive = ref(true)
const initialFitDone = ref(false)
const mediaValidity = reactive({})
const productionReadinessState = ref({ status: 'loading', data: null })
const freeCanvasVideoCapability = ref(getVideoGenerationCapability([], { loading: true }))

const PANEL_NODE_TYPES = new Set(['canvasStoryboard', 'canvasMedia', 'canvasAsset', 'canvasScript'])

let saveTimer = null
let savedHintTimer = null
let pollTimer = null
let paneClickSuppressTimer = null
let canvasResizeObserver = null
let canvasReadyFrame = null
let readinessRequestId = 0
let freeCanvasCapabilityRequestId = 0
let canvasLoadRequestId = 0
let canvasEntityFocusRevision = 0
let canvasRouteSynchronization = Promise.resolve(true)
let workflowRunSequence = 0
let freeCanvasHistory = createCanvasHistory(freeCanvas.value)
let freeClipboard = null
let freePasteCount = 0
let canvasMutationRevision = 0
let canvasSaveOperationId = 0
let canvasSaveChain = Promise.resolve()
const canvasSaveCoordinator = createCanvasSaveCoordinator()
const freeHistoryRevision = ref(0)

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

const dramaId = computed(() => canvasProjectId.value)
const isCanvasReady = computed(() => canvasLoadState.value === 'ready' && Boolean(drama.value))
const savedLayout = computed(() => layoutCache.value || parseCanvasLayout(drama.value?.metadata))
const projectAssetsById = computed(() => new Map(
  projectAssets.value.map((asset) => [String(asset.id), asset]),
))
const storyboardsById = computed(() => new Map(
  (drama.value?.episodes || [])
    .flatMap((episode) => episode.storyboards || [])
    .map((storyboard) => [String(storyboard.id), storyboard]),
))
const freeGraph = computed(() => buildFreeCanvasGraph(freeCanvas.value, {
  assetsById: projectAssetsById.value,
  storyboardsById: storyboardsById.value,
  selectedNodeIds: selectedFreeNodeIds.value,
}))
const selectedFreeNode = computed(() => (
  freeCanvas.value.nodes.find((node) => String(node.id) === String(selectedFreeNodeId.value)) || null
))
const canvasBackgroundMode = computed(() => (
  canvasMode.value === 'free' ? freeCanvas.value.background : 'dots'
))
const freeStoryboardMediaItems = computed(() => buildFreeCanvasStoryboardMediaItems(drama.value, {
  imagesBySbId: imagesBySbId.value,
  videosBySbId: videosBySbId.value,
  mediaStatusBySbId: mediaStatusBySbId.value,
}))
const selectedFreeAssetEligibility = computed(() => getFreeCanvasAssetSaveEligibility(
  selectedFreeNode.value,
  {
    projectId: dramaId.value,
    inventory: [...freeStoryboardMediaItems.value, ...projectAssets.value],
  },
))
const canUndoFreeCanvas = computed(() => {
  freeHistoryRevision.value
  return canvasMode.value === 'free' && !freeCanvasReadOnly.value && freeCanvasHistory.canUndo()
})
const canRedoFreeCanvas = computed(() => {
  freeHistoryRevision.value
  return canvasMode.value === 'free' && !freeCanvasReadOnly.value && freeCanvasHistory.canRedo()
})
const freeAssetOptions = computed(() => projectAssets.value.map((asset) => ({
  id: asset.id,
  label: asset.name || `素材 ${asset.id}`,
})))
const freeStoryboardOptions = computed(() => (
  (drama.value?.episodes || []).flatMap((episode) => (
    (episode.storyboards || []).map((storyboard, index) => ({
      id: storyboard.id,
      label: `${episode.title || `第 ${episode.episode_number || '?'} 集`} · ${storyboard.title || `分镜 ${storyboard.storyboard_number || index + 1}`}`,
    }))
  ))
))
const freeConversionTargets = computed(() => [
  ...(drama.value?.characters || []).map((character) => ({
    value: `character:${character.id}`,
    label: `角色 · ${character.name || character.id}`,
  })),
  ...(drama.value?.scenes || []).map((scene) => ({
    value: `scene:${scene.id}`,
    label: `场景 · ${scene.location || scene.id}`,
  })),
  ...(drama.value?.props || []).map((prop) => ({
    value: `prop:${prop.id}`,
    label: `道具 · ${prop.name || prop.id}`,
  })),
  ...freeStoryboardOptions.value.map((storyboard) => ({
    value: `storyboard:${storyboard.id}`,
    label: `分镜 · ${storyboard.label}`,
  })),
])
const freeMediaPickerContext = computed(() => ({
  projectTitle: drama.value?.title || '当前项目',
  episodeLabel: currentEpisode.value?.title || '',
  usageLabel: '添加到自由画布',
}))
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
const freeCanvasConfigRuntimeById = computed(() => new Map(
  freeCanvas.value.nodes
    .filter((node) => node.type === 'config')
    .map((node) => [String(node.id), buildFreeCanvasConfigRuntime(node.id, freeCanvas.value, {
      gate: productionActions.value.video,
      capability: freeCanvasVideoCapability.value,
    })]),
))
const selectedFreeConfigRuntime = computed(() => (
  selectedFreeNode.value?.type === 'config'
    ? freeCanvasConfigRuntimeById.value.get(String(selectedFreeNode.value.id))
    : undefined
))
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
const FREE_INSPECTOR_FOCUS_TIMEOUT_MS = 800
const FREE_INSPECTOR_FOCUS_POLL_MS = 10
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

function coreCanvasRequestError(status) {
  const error = new Error('PROJECT_LOAD_FAILED')
  error.status = Number(status) || 0
  return error
}

function canvasAbortError(reason) {
  if (reason?.name === 'AbortError') return reason
  if (typeof DOMException === 'function') return new DOMException('任务已取消', 'AbortError')
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

function isCanvasAbortError(error, signal) {
  return error?.name === 'AbortError' || signal?.aborted
}

async function requestCanvasProject(path, {
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
  signal,
  timeout = 15000,
} = {}) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const timeoutId = setTimeout(() => controller.abort(), Math.min(15000, Math.max(1, timeout)))
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
  } catch (error) {
    if (signal?.aborted) throw canvasAbortError(signal.reason || error)
    throw coreCanvasRequestError(0)
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onAbort)
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
  get(id, options) {
    return requestCanvasProject(`/dramas/${encodeURIComponent(id)}`, options || {})
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

async function loadCanvasProject({
  blocking = !isCanvasReady.value,
  preserveOnError = !blocking,
  preserveFreeState = !blocking,
  requestOptions = {},
} = {}) {
  const requestedDramaId = dramaId.value
  if (!canvasInstanceActive.value || !Number.isFinite(requestedDramaId) || requestedDramaId <= 0) return false
  const requestId = ++canvasLoadRequestId
  loading.value = true
  if (blocking) canvasLoadState.value = 'loading'
  canvasLoadError.value = ''
  canvasLoadNotFound.value = false
  try {
    const loadedDrama = await coreCanvasDramaAPI.get(requestedDramaId, requestOptions)
    if (!canvasInstanceActive.value || requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
    drama.value = loadedDrama
    layoutCache.value = parseCanvasLayout(drama.value.metadata)
    syncWorkflowFromDrama()
    const vp = resolveViewport(layoutCache.value)
    productionViewport.value = vp
    if (!preserveFreeState) hydrateFreeCanvasState(drama.value.metadata)
    currentViewport.value = canvasMode.value === 'free' ? { ...freeCanvas.value.viewport } : vp
    filterEpisodeId.value = routeEpisodeId()
    await Promise.all([
      loadForDrama(drama.value, filterEpisodeId.value, requestOptions),
      loadProjectAssets(requestedDramaId, requestOptions),
    ])
    if (!canvasInstanceActive.value || requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
    rebuildGraph()
    canvasLoadState.value = 'ready'
    canvasLoadNotFound.value = false
    return true
  } catch (error) {
    if (isCanvasAbortError(error, requestOptions.signal)) throw error
    if (!canvasInstanceActive.value || requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
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
    if (canvasInstanceActive.value && requestId === canvasLoadRequestId) loading.value = false
  }
}

async function retryCanvasProjectLoad() {
  const ownership = claimRouteEntityFocus()
  const loaded = await loadCanvasProject({ blocking: true, preserveOnError: false })
  if (loaded) await synchronizeRouteFocusedEntity(ownership)
}

async function fitCanvasView() {
  const flowApi = canvasFlowApi.value
  if (!flowApi?.fitView) return
  await flowApi.fitView({
    padding: 0.12,
    minZoom: canvasMode.value === 'free' ? 0.25 : MIN_READABLE_CANVAS_ZOOM,
    maxZoom: canvasMode.value === 'free' ? 1.2 : 1,
    duration: 250,
    includeHiddenNodes: false,
  })
  const viewport = flowApi.getViewport?.()
  if (viewport) {
    onViewportChange(viewport)
    onCanvasMoveEnd()
  }
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
  if (
    !hasFocusedNodePendingWork()
    && !layoutDirty.value
    && !failedCanvasSaveOperation.value
    && !hasPendingCanvasSaves(canvasProjectId.value)
    && !freeCanvasUploading.value
    && !workflowRunning.value
    && !nodeGenerationCoordinator.hasActive()
  ) return
  event.preventDefault()
  event.returnValue = ''
}

async function ensureNodeGenerationFinished() {
  if (!nodeGenerationCoordinator.hasActive()) return true
  try {
    await ElMessageBox.confirm(
      '离开会停止当前页面继续等待和显示进度，但已提交的后台任务及供应商计费可能继续。是否仍要离开？',
      '单节点生成仍在执行',
      { type: 'warning', confirmButtonText: '停止等待并离开', cancelButtonText: '继续等待' },
    )
  } catch (_) {
    return false
  }
  nodeGenerationCoordinator.stopWaiting('页面已离开，后台任务和供应商计费可能继续')
  return true
}

function ensureFreeCanvasUploadFinished() {
  if (!freeCanvasUploading.value) return true
  ElMessage.warning('素材正在上传，请等待完成后再离开')
  return false
}

async function ensureWorkflowFinished() {
  if (!workflowRunning.value) return true
  try {
    await ElMessageBox.confirm(
      '离开会停止当前页面继续等待和显示进度，但已提交的后台任务及供应商计费可能继续。是否仍要离开？',
      '工作流仍在执行',
      { type: 'warning', confirmButtonText: '停止等待并离开', cancelButtonText: '继续等待' },
    )
  } catch (_) {
    return false
  }
  activeWorkflowRun.value?.controller?.abort()
  activeWorkflowRun.value = null
  workflowRunning.value = false
  workflowProgress.value = ''
  return true
}

async function flushCanvasSaveBeforeLeave(targetProjectId = canvasProjectId.value) {
  if (
    !layoutDirty.value
    && !failedCanvasSaveOperation.value
    && !hasPendingCanvasSaves(targetProjectId)
  ) return true
  cancelScheduledCanvasSave()
  await waitForCanvasSaveSettlement(targetProjectId)
  if (!layoutDirty.value && !failedCanvasSaveOperation.value) return true
  let result = failedCanvasSaveOperation.value
    ? await retryCanvasSave()
    : { ok: true }
  if (result.ok && layoutDirty.value) {
    result = await persistCanvasState({ layoutOnly: true, reportError: false })
  }
  if (result.ok) return true
  if (result.cancelled && !layoutDirty.value && !failedCanvasSaveOperation.value) return true
  try {
    await ElMessageBox.confirm(
      '最近的画布修改还没有保存成功，继续离开会丢失这些修改。',
      '保存失败',
      { type: 'warning', confirmButtonText: '仍要离开', cancelButtonText: '留在页面' },
    )
    layoutDirty.value = false
    failedCanvasSaveOperation.value = null
    layoutSaveState.value = 'idle'
    layoutSaveError.value = ''
    return true
  } catch (_) {
    return false
  }
}

function runCanvasNavigationBarrier() {
  const projectId = canvasProjectId.value
  return canvasSaveCoordinator.runNavigationBarrier(
    Number(projectId),
    async () => {
      if (!await ensureNodeGenerationFinished()) return false
      if (!await ensureWorkflowFinished()) return false
      if (!ensureFreeCanvasUploadFinished()) return false
      if (!await confirmFocusedNodeLeave()) return false
      return flushCanvasSaveBeforeLeave(projectId)
    },
  )
}

onBeforeRouteLeave(() => runCanvasNavigationBarrier())
async function guardCanvasRouteUpdate(to) {
  const currentContext = canvasRouteContext(route)
  const nextContext = canvasRouteContext(to)
  if (currentContext.projectId !== nextContext.projectId) {
    return runCanvasNavigationBarrier()
  }
  if (
    currentContext.focusNodeId !== nextContext.focusNodeId
    || currentContext.episodeId !== nextContext.episodeId
  ) {
    return runCanvasNavigationBarrier()
  }
  return true
}

onBeforeRouteUpdate(guardCanvasRouteUpdate)

async function setFocusedCanvasNode(nodeId, { force = false, restoreFocus = false } = {}) {
  const currentId = focusedNodeId.value || null
  const nextId = nodeId || null
  const isChanging = String(currentId || '') !== String(nextId || '')
  if (!isChanging) {
    if (nextId) await focusCanvasNode(nextId)
    return true
  }
  if (currentId && !force && !await ensureNodeGenerationFinished()) {
    restoreFocusedNodeSelection()
    return false
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
  const numericEpisodeId = Number(value)
  const episodeId = value == null || value === ''
    ? null
    : (Number.isSafeInteger(numericEpisodeId) && numericEpisodeId > 0 ? numericEpisodeId : null)
  const routeHasEpisodeQuery = Object.prototype.hasOwnProperty.call(route.query || {}, 'episode')
  const routeEpisodeMatches = episodeId == null
    ? !routeHasEpisodeQuery
    : routeEpisodeId() === episodeId
  if (
    String(filterEpisodeId.value ?? '') === String(episodeId ?? '')
    && routeEpisodeMatches
  ) return await canvasRouteSynchronization
  const query = { ...route.query }
  if (episodeId != null) query.episode = String(episodeId)
  else delete query.episode
  delete query.focus
  try {
    const navigationFailure = await router.replace({ query })
    if (navigationFailure) return false
    return await canvasRouteSynchronization
  } catch (_) {
    return false
  }
}

function routeFocusNodeId(routeLike = route) {
  const raw = Array.isArray(routeLike?.query?.focus) ? routeLike.query.focus[0] : routeLike?.query?.focus
  const value = String(raw || '').trim()
  return /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : ''
}

function routeEpisodeId(routeLike = route) {
  const raw = Array.isArray(routeLike?.query?.episode) ? routeLike.query.episode[0] : routeLike?.query?.episode
  if (raw == null || raw === '') return null
  const rawValue = String(raw).trim()
  if (!/^[1-9]\d*$/.test(rawValue)) return null
  const value = Number(rawValue)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function canvasRouteContext(routeLike = route) {
  return {
    projectId: String(routeLike?.params?.id || ''),
    focusNodeId: routeFocusNodeId(routeLike),
    episodeId: routeEpisodeId(routeLike),
  }
}

function claimCanvasEntityFocus(nodeId, { routeOwned = false } = {}) {
  return {
    revision: ++canvasEntityFocusRevision,
    projectId: Number(canvasProjectId.value),
    nodeId: String(nodeId || ''),
    episodeId: routeEpisodeId(),
    routeOwned,
  }
}

function claimRouteEntityFocus() {
  return claimCanvasEntityFocus(routeFocusNodeId(), { routeOwned: true })
}

function ownsCanvasEntityFocus(ownership, { requireSelection = false } = {}) {
  if (
    !ownership
    || ownership.revision !== canvasEntityFocusRevision
    || !canvasInstanceActive.value
    || ownership.projectId !== Number(canvasProjectId.value)
    || ownership.projectId !== Number(drama.value?.id)
  ) return false
  if (ownership.routeOwned && ownership.nodeId !== routeFocusNodeId()) return false
  if (ownership.routeOwned && ownership.episodeId !== routeEpisodeId()) return false
  return !requireSelection || String(selectedFreeNodeId.value || '') === ownership.nodeId
}

async function waitForFreeCanvasInspectorFocus(ownership, timeoutMs = FREE_INSPECTOR_FOCUS_TIMEOUT_MS) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (ownsCanvasEntityFocus(ownership, { requireSelection: true })) {
    await nextTick()
    if (!ownsCanvasEntityFocus(ownership, { requireSelection: true })) return false
    const inspector = document.querySelector('.free-canvas-inspector-dock')
    const inspectorNodeId = String(inspector?.dataset?.freeNodeId || '')
    const focusTarget = inspectorNodeId === ownership.nodeId
      ? inspector.querySelector('input:not([disabled]), textarea:not([disabled]), button:not([disabled])')
      : null
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true })
      if (document.activeElement === focusTarget) return true
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await new Promise((resolve) => setTimeout(resolve, Math.min(FREE_INSPECTOR_FOCUS_POLL_MS, remaining)))
  }
  return false
}

async function synchronizeRouteFocusedEntity(ownership = claimRouteEntityFocus()) {
  if (!ownsCanvasEntityFocus(ownership)) return false
  const targetId = ownership.nodeId
  const freeTarget = freeCanvas.value.nodes.find((node) => String(node.id) === targetId)
  if (freeTarget) {
    await setFocusedCanvasNode(null, { force: true, restoreFocus: false })
    if (!ownsCanvasEntityFocus(ownership)) return false
    if (canvasMode.value !== 'free') await setCanvasMode('free')
    if (!ownsCanvasEntityFocus(ownership) || canvasMode.value !== 'free') return false
    activateFreeCanvasNode(freeTarget.id, { focusInspector: false, ownership })
    return waitForFreeCanvasInspectorFocus(ownership)
  }

  closeFreeCanvasInspector({ restoreFocus: false, invalidateFocus: false })
  selectedFreeNodeIds.value = []
  selectedFreeEdgeIds.value = []
  if (!ownsCanvasEntityFocus(ownership)) return false
  if (!targetId || !nodes.value.some((node) => String(node.id) === targetId)) {
    return setFocusedCanvasNode(null, { force: true, restoreFocus: false })
  }
  if (canvasMode.value !== 'production') {
    await setCanvasMode('production', { preserveRouteFocusOwnership: true })
  }
  if (!ownsCanvasEntityFocus(ownership) || canvasMode.value !== 'production') return false
  return setFocusedCanvasNode(targetId, { force: true })
}

async function synchronizeCanvasRouteFocus({ resetProject = false } = {}) {
  if (resetProject) resetCanvasProjectForRoute()
  const ownership = claimRouteEntityFocus()

  const projectAlreadyLoaded = Number(drama.value?.id) === ownership.projectId
  const loaded = projectAlreadyLoaded || await loadCanvasProject({
    blocking: true,
    preserveOnError: false,
  })
  if (!loaded || !ownsCanvasEntityFocus(ownership)) return false
  if (filterEpisodeId.value !== ownership.episodeId) {
    filterEpisodeId.value = ownership.episodeId
    await loadForDrama(drama.value, ownership.episodeId)
    if (!ownsCanvasEntityFocus(ownership)) return false
    rebuildGraph()
  }
  return synchronizeRouteFocusedEntity(ownership)
}

function startCanvasRouteSynchronization(options = {}) {
  canvasRouteSynchronization = synchronizeCanvasRouteFocus(options).catch(() => false)
  return canvasRouteSynchronization
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
  if (requestedFocus && nodes.value.some((node) => String(node.id) === requestedFocus)) {
    initialFitDone.value = true
    await synchronizeRouteFocusedEntity(claimRouteEntityFocus())
    return
  }
  if (hasSavedViewport.value || initialFitDone.value) return
  initialFitDone.value = true
  await nextTick()
  await fitCanvasView()
}

function freeCanvasUiMode(mode) {
  return mode === 'free' || mode === 'hybrid' ? 'free' : 'production'
}

function normalizeFreeCanvasForProject(input) {
  return normalizeFreeCanvas({
    ...input,
    projectId: Number.isFinite(canvasProjectId.value) && canvasProjectId.value > 0 ? canvasProjectId.value : undefined,
  })
}

function hydrateFreeCanvasState(metadata) {
  const persisted = parseFreeCanvas(metadata)
  const compatibility = inspectFreeCanvasCompatibility(persisted)
  freeCanvasReadOnly.value = !compatibility.compatible
  freeCanvasCompatibilityMessage.value = compatibility.message
  const normalized = compatibility.compatible
    ? normalizeFreeCanvasForProject(persisted)
    : createEmptyFreeCanvas({
      mode: 'production',
      projectId: Number.isFinite(canvasProjectId.value) && canvasProjectId.value > 0 ? canvasProjectId.value : undefined,
    })
  freeCanvas.value = normalized
  canvasMode.value = freeCanvasUiMode(normalized.mode)
  freeCanvasHistory = createCanvasHistory(normalized)
  freeHistoryRevision.value += 1
  selectedFreeNodeId.value = null
  selectedFreeNodeIds.value = []
  selectedFreeEdgeIds.value = []
  editingFreeNodeId.value = null
  freeClipboard = null
  freePasteCount = 0
}

async function loadProjectAssets(projectId, requestOptions = {}) {
  try {
    const response = await assetsAPI.list({ drama_id: projectId, page_size: 100 }, requestOptions)
    if (Number(projectId) !== Number(dramaId.value)) return
    projectAssets.value = (response?.items || []).filter((asset) => (
      asset?.drama_id == null || Number(asset.drama_id) === Number(projectId)
    ))
  } catch (error) {
    if (isCanvasAbortError(error, requestOptions.signal)) throw error
    if (Number(projectId) === Number(dramaId.value)) projectAssets.value = []
  }
}

function modeScopedProductionGraph() {
  const freeMode = canvasMode.value === 'free'
  return {
    nodes: productionGraph.value.nodes.map((node) => ({
      ...node,
      connectable: false,
      deletable: false,
      draggable: freeMode ? false : node.draggable,
      selectable: freeMode ? false : node.selectable,
      focusable: freeMode ? false : node.focusable,
    })),
    edges: productionGraph.value.edges.map((edge) => ({
      ...edge,
      deletable: false,
      updatable: false,
    })),
  }
}

function mergeActiveCanvasGraphs() {
  const merged = mergeCanvasGraphs(modeScopedProductionGraph(), freeGraph.value, canvasMode.value)
  nodes.value = merged.nodes
  edges.value = merged.edges
}

function pruneFreeCanvasSelection() {
  const nodeIds = new Set(freeCanvas.value.nodes.map((node) => String(node.id)))
  const edgeIds = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
  selectedFreeNodeIds.value = selectedFreeNodeIds.value.filter((id) => nodeIds.has(String(id)))
  selectedFreeEdgeIds.value = selectedFreeEdgeIds.value.filter((id) => edgeIds.has(String(id)))
  if (!nodeIds.has(String(selectedFreeNodeId.value))) selectedFreeNodeId.value = null
  if (!nodeIds.has(String(editingFreeNodeId.value))) editingFreeNodeId.value = null
}

function commitFreeCanvasState(nextState, reason, { save = true } = {}) {
  if (freeCanvasReadOnly.value) {
    ElMessage.warning(freeCanvasCompatibilityMessage.value || '当前自由画布处于只读保护状态')
    return freeCanvas.value
  }
  let normalized
  try {
    normalized = normalizeFreeCanvasForProject(nextState)
  } catch (error) {
    ElMessage.warning(error?.message || '自由画布内容不符合保存要求')
    return freeCanvas.value
  }
  freeCanvas.value = freeCanvasHistory.commit(normalized, reason)
  canvasMode.value = freeCanvasUiMode(freeCanvas.value.mode)
  pruneFreeCanvasSelection()
  freeHistoryRevision.value += 1
  mergeActiveCanvasGraphs()
  if (save) scheduleLayoutSave()
  return freeCanvas.value
}

async function applyFreeCanvasHistoryState(nextState) {
  const activeMode = canvasMode.value
  freeCanvas.value = normalizeFreeCanvasForProject({
    ...nextState,
    mode: activeMode,
  })
  pruneFreeCanvasSelection()
  freeHistoryRevision.value += 1
  mergeActiveCanvasGraphs()
  const targetViewport = canvasMode.value === 'free'
    ? freeCanvas.value.viewport
    : productionViewport.value
  currentViewport.value = { ...targetViewport }
  await nextTick()
  await canvasFlowApi.value?.setViewport?.(targetViewport, { duration: 180 })
  scheduleLayoutSave()
}

async function setCanvasMode(mode, { preserveRouteFocusOwnership = false } = {}) {
  const nextMode = mode === 'free' ? 'free' : 'production'
  if (nextMode === canvasMode.value) return
  if (nextMode === 'free' && freeCanvasReadOnly.value) {
    ElMessage.warning(freeCanvasCompatibilityMessage.value || '当前自由画布版本需要升级后编辑')
    return
  }
  if (focusedNodeId.value && !await setFocusedCanvasNode(null)) return

  let nextFreeCanvas = freeCanvas.value
  if (canvasMode.value === 'free') {
    nextFreeCanvas = normalizeFreeCanvasForProject({
      ...nextFreeCanvas,
      viewport: currentViewport.value,
    })
  } else {
    productionViewport.value = { ...currentViewport.value }
  }

  freeCanvas.value = normalizeFreeCanvasForProject({
    ...nextFreeCanvas,
    mode: nextMode,
  })
  canvasMode.value = nextMode
  if (nextMode === 'production') {
    finishFreeCanvasNodeEditing()
    closeFreeCanvasInspector({
      restoreFocus: false,
      invalidateFocus: !preserveRouteFocusOwnership,
    })
  }
  freeHistoryRevision.value += 1
  mergeActiveCanvasGraphs()

  const targetViewport = nextMode === 'free' ? freeCanvas.value.viewport : productionViewport.value
  currentViewport.value = { ...targetViewport }
  await nextTick()
  await canvasFlowApi.value?.setViewport?.(targetViewport, { duration: 180 })
  scheduleLayoutSave()
}

function undoFreeCanvas() {
  if (canvasMode.value !== 'free' || freeCanvasReadOnly.value) return
  if (!freeCanvasHistory.canUndo()) return
  void applyFreeCanvasHistoryState(freeCanvasHistory.undo())
}

function redoFreeCanvas() {
  if (canvasMode.value !== 'free' || freeCanvasReadOnly.value) return
  if (!freeCanvasHistory.canRedo()) return
  void applyFreeCanvasHistoryState(freeCanvasHistory.redo())
}

function setFreeCanvasBackground(background) {
  if (canvasMode.value !== 'free' || !['dots', 'lines', 'none'].includes(background)) return
  commitFreeCanvasState({ ...freeCanvas.value, background }, 'background')
}

function syncWorkflowFromDrama() {
  workflowGroups.value = parseWorkflowGroups(drama.value?.metadata)
  if (activeGroupId.value && !workflowGroups.value.some((g) => g.id === activeGroupId.value)) {
    activeGroupId.value = null
  }
}

function rebuildGraph() {
  if (!drama.value) {
    productionGraph.value = { nodes: [], edges: [] }
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
  productionGraph.value = { nodes: nextNodes, edges: nextEdges }
  mergeActiveCanvasGraphs()
}

function applyHighlight() {
  if (!productionGraph.value.nodes.length) return
  const highlighted = applyCanvasHighlight(
    productionGraph.value.nodes.map((n) => ({
      ...n,
      class: undefined,
      data: { ...n.data, highlighted: false, dimmed: false },
    })),
    productionGraph.value.edges,
    highlightAssetId.value,
    drama.value
  )
  productionGraph.value = highlighted
  mergeActiveCanvasGraphs()
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
  if (canvasMode.value !== 'production') {
    closeContextMenu()
    return
  }
  pendingFlowPosition.value = contextMenuFlowPos.value
  openCreateDialog(type, contextMenuFlowPos.value)
  closeContextMenu()
}

function onContextMenuFreeNode(type) {
  const position = contextMenuFlowPos.value
  closeContextMenu()
  void createFreeCanvasNode(type, position)
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

function buildCanvasReturnTo(focusNodeId = '') {
  const returnQuery = { ...route.query }
  const returnEpisodeId = routeEpisodeId()
  if (returnEpisodeId != null) returnQuery.episode = String(returnEpisodeId)
  else delete returnQuery.episode
  const selectedFocusId = focusNodeId
    || (canvasMode.value === 'free' ? selectedFreeNodeId.value : focusedNodeId.value)
    || routeFocusNodeId()
  const returnFocusId = routeFocusNodeId({ query: { focus: selectedFocusId } })
  if (returnFocusId) returnQuery.focus = returnFocusId
  else delete returnQuery.focus
  return router.resolve({
    name: 'film-canvas',
    params: { id: String(dramaId.value) },
    query: returnQuery,
  }).fullPath
}

function openAiConfig(serviceType, focusNodeId = '') {
  const returnTo = buildCanvasReturnTo(focusNodeId)
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
  beginNodeGeneration: (info) => nodeGenerationCoordinator.begin(info),
  hasNodeGeneration: () => nodeGenerationCoordinator.hasActive(),
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

async function refreshFreeCanvasVideoCapability() {
  const requestedDramaId = dramaId.value
  const requestId = ++freeCanvasCapabilityRequestId
  freeCanvasVideoCapability.value = getVideoGenerationCapability([], { loading: true })
  try {
    const configs = await aiAPI.list('video')
    if (requestId !== freeCanvasCapabilityRequestId || requestedDramaId !== dramaId.value) return
    freeCanvasVideoCapability.value = getVideoGenerationCapability(configs)
  } catch (_) {
    if (requestId !== freeCanvasCapabilityRequestId || requestedDramaId !== dramaId.value) return
    freeCanvasVideoCapability.value = getVideoGenerationCapability([], { failed: true })
  }
}

function onSelectionChange({ nodes: selectedNodes = [], edges: selectedEdges = [] }) {
  selectedStoryboardIds.value = canvasMode.value === 'production'
    ? selectedNodes
      .filter((node) => node.type === 'canvasStoryboard' && node.data?.storyboard?.id)
      .map((node) => node.data.storyboard.id)
    : []
  selectedFreeNodeIds.value = selectedNodes
    .filter((node) => node.type === 'freeCanvas' || isFreeCanvasNodeId(node.id))
    .map((node) => node.id)
  selectedFreeEdgeIds.value = selectedEdges
    .filter((edge) => freeCanvas.value.edges.some((item) => String(item.id) === String(edge.id)))
    .map((edge) => edge.id)
  if (selectedFreeNodeIds.value.length === 1) selectedFreeNodeId.value = selectedFreeNodeIds.value[0]
  else if (selectedFreeNodeIds.value.length > 1) selectedFreeNodeId.value = null
  else selectedFreeNodeId.value = null
  if (!selectedFreeNodeIds.value.includes(editingFreeNodeId.value)) editingFreeNodeId.value = null
}

function onViewportChange(viewport) {
  currentViewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
  if (canvasMode.value === 'production') productionViewport.value = { ...currentViewport.value }
}

function syncProductionGraphPositions() {
  const positions = new Map(
    nodes.value
      .filter((node) => node.type !== 'freeCanvas' && !String(node.id).startsWith('free:'))
      .map((node) => [String(node.id), node.position]),
  )
  productionGraph.value = {
    ...productionGraph.value,
    nodes: productionGraph.value.nodes.map((node) => (
      positions.has(String(node.id))
        ? { ...node, position: { ...positions.get(String(node.id)) } }
        : node
    )),
  }
}

function onCanvasNodeDragStop(payload = {}) {
  const changedNodes = Array.isArray(payload.nodes)
    ? payload.nodes
    : (payload.node ? [payload.node] : [])
  const freePositions = new Map(
    changedNodes
      .filter((node) => isFreeCanvasNodeId(node.id))
      .map((node) => [String(node.id), node.position]),
  )
  if (freePositions.size) {
    const nextNodes = freeCanvas.value.nodes.map((node) => (
      freePositions.has(String(node.id))
        ? { ...node, position: { ...freePositions.get(String(node.id)) } }
        : node
    ))
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, 'move')
    return
  }
  syncProductionGraphPositions()
  scheduleLayoutSave()
}

function onCanvasMoveEnd() {
  if (canvasMode.value === 'free') {
    commitFreeCanvasState({
      ...freeCanvas.value,
      viewport: currentViewport.value,
    }, 'viewport')
    return
  }
  productionViewport.value = { ...currentViewport.value }
  scheduleLayoutSave()
}

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
    if (!updated) return { ok: false, cancelled: true }
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
      }, 2000)
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

const {
  workflowOrderSaving,
  reorderWorkflowStoryboards,
} = useCanvasWorkflowOrder({
  workflowGroups,
  persist: () => persistCanvasState({ groupsOnly: true, reportError: false }),
  onSaveFailed: (error, result) => {
    abandonCanvasSaveOperation(result?.operation)
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
  routeProjectId: canvasProjectId,
  canvasMode,
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
  if (canvasMode.value !== 'production') return
  await runAiGenerateStoryboards()
}

async function batchGenerateImages() {
  if (canvasMode.value !== 'production') return
  if (!ensureKnownStoryboardMedia((currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id))) return
  await runBatchGenerateImages()
}

async function batchGenerateVideos() {
  if (canvasMode.value !== 'production') return
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
  if (canvasMode.value !== 'production') return
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

async function onAlignNodes() {
  if (!drama.value || !nodes.value.length || aligningNodes.value) return
  const requestedProjectId = currentCanvasProjectId()
  if (!requestedProjectId) return
  if (canvasMode.value !== 'production') {
    ElMessage.info('自动对齐用于制作流程节点，请先切换到制作模式')
    return
  }
  if (!await setFocusedCanvasNode(null)) return
  if (!isCanvasProjectCurrent(requestedProjectId)) return
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
    syncProductionGraphPositions()
    layoutCache.value = {
      version: 1,
      nodes: { ...positions },
      viewport: layoutCache.value?.viewport,
    }
    await nextTick()
    if (!isCanvasProjectCurrent(requestedProjectId)) return
    const flowApi = canvasFlowApi.value
    if (flowApi?.fitView) {
      await flowApi.fitView({
        padding: 0.14,
        minZoom: MIN_READABLE_CANVAS_ZOOM,
        maxZoom: 1,
        duration: 380,
        includeHiddenNodes: false,
      })
      if (!isCanvasProjectCurrent(requestedProjectId)) return
      await new Promise((r) => setTimeout(r, 400))
      if (!isCanvasProjectCurrent(requestedProjectId)) return
      const vp = flowApi.getViewport?.()
      if (vp) {
        onViewportChange(vp)
      }
    }
    const saved = await persistCanvasState({ layoutOnly: true })
    if (!saved.ok || !isCanvasProjectCurrent(requestedProjectId)) return
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
    filterEpisodeId.value = routeEpisodeId()
    await loadForDrama(drama.value, filterEpisodeId.value)
    rebuildGraph()
  } catch (e) {
    if (!silent) ElMessage.error(e?.message || '加载项目失败')
  } finally {
    if (!silent) loading.value = false
  }
}

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
        ElMessage.error(`分镜 #${storyboardId} 失败：${error?.message || error}`)
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
      ElMessage.error(e?.message || '工作流执行失败')
    }
  } finally {
    if (activeWorkflowRun.value === run) {
      activeWorkflowRun.value = null
      workflowRunning.value = false
      workflowProgress.value = ''
    }
  }
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
  if (isFreeCanvasNodeId(node.id)) {
    openFreeCanvasInspectorFor(node.id)
    if (node.data?.freeNode?.type === 'text') startFreeCanvasNodeEditing(node.id)
    return
  }
  if (canvasMode.value !== 'production') return
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
  closeFreeCanvasInspector({ restoreFocus: false })
  finishFreeCanvasNodeEditing()
  selectedFreeNodeIds.value = []
  selectedFreeEdgeIds.value = []
  await setFocusedCanvasNode(null, { restoreFocus: true })
  closeContextMenu()
}

async function onNodeClick({ node, event }) {
  if (isFreeCanvasNodeId(node.id)) {
    event?.stopPropagation?.()
    if (event?.ctrlKey || event?.metaKey || event?.shiftKey) return
    finishFreeCanvasNodeEditing(node.id)
    openFreeCanvasInspectorFor(node.id)
    return
  }
  if (canvasMode.value !== 'production') return
  if (node.type === 'canvasAddButton') {
    event?.stopPropagation?.()
    openCreateDialog(node.data?.assetType || 'storyboard')
    return
  }

  if (canvasMode.value === 'production' && PANEL_NODE_TYPES.has(node.type)) {
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

function resetCanvasProjectForRoute() {
  canvasEntityFocusRevision += 1
  cancelScheduledCanvasSave()
  layoutDirty.value = false
  failedCanvasSaveOperation.value = null
  layoutSaveError.value = ''
  layoutSaveState.value = 'idle'
  highlightAssetId.value = null
  layoutCache.value = null
  productionGraph.value = { nodes: [], edges: [] }
  projectAssets.value = []
  freeMediaPickerVisible.value = false
  activeGroupId.value = null
  workflowOutcomeUnknown.value = false
  selectedStoryboardIds.value = []
  focusedNodeId.value = null
  selectedFreeNodeId.value = null
  selectedFreeNodeIds.value = []
  selectedFreeEdgeIds.value = []
  editingFreeNodeId.value = null
  initialFitDone.value = false
  canvasInteractive.value = true
  for (const key of Object.keys(mediaValidity)) delete mediaValidity[key]
  productionReadinessState.value = { status: 'loading', data: null }
  freeCanvasVideoCapability.value = getVideoGenerationCapability([], { loading: true })
  refreshProductionReadiness()
  refreshFreeCanvasVideoCapability()
}

watch(
  () => [String(route.params.id || ''), routeFocusNodeId(), routeEpisodeId()],
  ([projectId, focusNodeId, episodeId], previousIntent) => {
    const resetProject = !previousIntent || projectId !== previousIntent[0]
    const contextChanged = previousIntent && (
      previousIntent[1] !== focusNodeId
      || (previousIntent[2] ?? null) !== episodeId
    )
    if (!resetProject && !contextChanged) return
    void startCanvasRouteSynchronization({ resetProject })
  },
  { immediate: true, flush: 'sync' },
 )

watch(drama, () => startStatusPoll())

function updateCanvasViewportReady() {
  const rect = canvasMainRef.value?.getBoundingClientRect?.()
  canvasViewportReady.value = Boolean(rect && rect.width > 0 && rect.height > 0)
}

onMounted(() => {
  window.addEventListener('beforeunload', handleCanvasBeforeUnload)
  window.addEventListener('keydown', handleFreeCanvasKeydown)
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
  window.removeEventListener('keydown', handleFreeCanvasKeydown)
  activeWorkflowRun.value?.controller?.abort()
  activeWorkflowRun.value = null
  nodeGenerationCoordinator.stopWaiting('画布已关闭，后台任务和供应商计费可能继续')
  if (layoutDirty.value) {
    void persistCanvasState({ layoutOnly: true, reportError: false, allowDuringTeardown: true })
  }
  canvasInstanceActive.value = false
  canvasLoadRequestId++
  readinessRequestId++
  freeCanvasCapabilityRequestId++
  cancelScheduledCanvasSave()
  if (savedHintTimer) clearTimeout(savedHintTimer)
  if (paneClickSuppressTimer) clearTimeout(paneClickSuppressTimer)
  if (canvasReadyFrame != null) window.cancelAnimationFrame(canvasReadyFrame)
  canvasResizeObserver?.disconnect()
  stopStatusPoll()
})
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

function setFreeCanvasConfigOperationState(nodeId, status, metadata = {}) {
  if (!['idle', 'running', 'failed', 'cancelled'].includes(status)) return false
  const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId))
  if (node?.type !== 'config') return false
  const nextNodes = freeCanvas.value.nodes.map((item) => (
    String(item.id) === String(nodeId)
      ? { ...item, status, metadata }
      : item
  ))
  commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `config:${status}:${nodeId}`)
  return true
}

function cancelFreeCanvasConfig(nodeId) {
  const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
  if (!runtime?.canCancel) return
  const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId))
  setFreeCanvasConfigOperationState(nodeId, 'cancelled', {
    ...(node?.metadata?.operationId ? { operationId: node.metadata.operationId } : {}),
    updatedAt: new Date().toISOString(),
  })
  ElMessage.warning('已停止等待；已提交任务可能继续执行并产生供应商计费')
}

async function retryFreeCanvasConfig(nodeId) {
  const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
  if (!runtime?.canRetry) return
  if (['failed', 'cancelled'].includes(runtime.status)) {
    setFreeCanvasConfigOperationState(nodeId, 'idle', { updatedAt: new Date().toISOString() })
  }
  await Promise.all([refreshProductionReadiness(), refreshFreeCanvasVideoCapability()])
}

async function createFreeCanvasNode(type, position = null, overrides = {}) {
  if (!['text', 'image', 'video', 'config', 'reference'].includes(type)) return null
  if (canvasMode.value !== 'free') await setCanvasMode('free')
  if (canvasMode.value !== 'free') return null
  if (freeCanvas.value.nodes.length >= 500) {
    ElMessage.warning('自由画布已达到 500 个节点上限，请先整理后再添加')
    return null
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

function closeFreeCanvasInspector({ restoreFocus = true, invalidateFocus = true } = {}) {
  const previousId = selectedFreeNodeId.value
  if (invalidateFocus) canvasEntityFocusRevision += 1
  selectedFreeNodeId.value = null
  if (restoreFocus && previousId) void focusFreeCanvasNodeTrigger(previousId)
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

function deleteFreeCanvasNode(nodeId) {
  removeFreeCanvasItems([nodeId])
}

function deleteFreeCanvasSelection() {
  const nodeIds = nodes.value
    .filter((node) => node.selected && isFreeCanvasNodeId(node.id))
    .map((node) => node.id)
  const freeEdgeIds = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
  const edgeIds = edges.value
    .filter((edge) => edge.selected && freeEdgeIds.has(String(edge.id)))
    .map((edge) => edge.id)
  selectedFreeNodeIds.value = nodeIds
  selectedFreeEdgeIds.value = edgeIds
  selectedFreeNodeId.value = nodeIds.length === 1 ? nodeIds[0] : null
  return removeFreeCanvasItems(nodeIds, edgeIds)
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

function localMediaReference(nodeOrAsset) {
  const candidate = nodeOrAsset?.storageKey
    || nodeOrAsset?.local_path
    || ((nodeOrAsset?.type === 'image' || nodeOrAsset?.type === 'video') ? nodeOrAsset?.content : '')
    || ''
  return normalizeFreeCanvasMediaPath(candidate)
}

function resolveFreeCanvasNodeMediaUrl(node) {
  return freeCanvasMediaUrl(node, projectAssetsById.value)
}

function openFreeCanvasMediaPicker() {
  if (canvasMode.value !== 'free') return
  freeMediaPickerVisible.value = true
}

function toggleFreeCanvasLibrary() {
  if (canvasMode.value !== 'free') return
  freeLibraryVisible.value = !freeLibraryVisible.value
}

async function createFreeEntityReference({ kind, item } = {}) {
  if (canvasMode.value !== 'free' || !item || !['character', 'scene', 'prop'].includes(kind)) return
  const kindLabel = { character: '角色', scene: '场景', prop: '道具' }[kind]
  const title = item.name || item.location || `${kindLabel} ${item.id || ''}`.trim()
  const content = [item.description, item.appearance, item.personality, item.time]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
  await createFreeCanvasNode('reference', null, {
    title: `${kindLabel} · ${title}`,
    content,
    ...(kind === 'scene' && item.id ? { sceneId: item.id } : {}),
  })
}

async function createFreeNodeFromLibraryItem(item, position = null) {
  const itemProjectId = item?.projectId ?? item?.project_id ?? item?.drama_id ?? item?.dramaId
  if (itemProjectId != null && Number(itemProjectId) !== Number(dramaId.value)) {
    ElMessage.warning('请选择当前项目的媒体素材')
    return
  }
  if (item?.storyboardId && item?.storageKey) {
    await createFreeCanvasNode(item.type === 'video' ? 'video' : 'image', position, {
      title: item.label || (item.type === 'video' ? '分镜视频' : '分镜图片'),
      storyboard_ref: item.storyboardId,
      storyboardId: item.storyboardId,
      storageKey: item.storageKey,
      content: item.storageKey,
    })
    return
  }
  await createFreeNodeFromAsset(item, position)
}

async function createFreeNodeFromAsset(asset, position = null) {
  const sourceDramaId = asset?.drama_id
  if (sourceDramaId != null && Number(sourceDramaId) !== Number(dramaId.value)) {
    ElMessage.warning('请选择当前项目或全局素材，其他项目素材需要先复制到当前项目')
    return
  }
  const assetType = asset?.type === 'video' ? 'video' : 'image'
  const storageKey = localMediaReference(asset)
  const current = projectAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
  projectAssets.value = [asset, ...current]
  await createFreeCanvasNode(assetType, position, {
    title: asset?.name || (assetType === 'video' ? '视频素材' : '图片素材'),
    asset_ref: asset?.id,
    assetId: asset?.id,
    ...(storageKey ? { storageKey, content: storageKey } : {}),
  })
}

function isMediaFile(file) {
  return /^(?:image|video)\//i.test(String(file?.type || ''))
}

async function uploadFreeCanvasFiles(files, position = null) {
  if (canvasMode.value !== 'free' || freeCanvasUploading.value) return
  const requestedDramaId = dramaId.value
  const selectedFiles = Array.from(files || [])
  const supported = selectedFiles.filter(isMediaFile)
  const unsupportedCount = selectedFiles.length - supported.length
  const { accepted, oversized } = partitionMediaLibraryUploads(supported)
  if (unsupportedCount) ElMessage.warning(`已跳过 ${unsupportedCount} 个非图片或视频文件`)
  if (oversized.length) {
    ElMessage.warning(`${oversized.length} 个文件超过单文件 ${MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL} 限制`)
  }
  if (!accepted.length) return

  freeCanvasUploading.value = true
  let succeeded = 0
  try {
    for (const [index, file] of accepted.entries()) {
      if (!canvasInstanceActive.value || requestedDramaId !== dramaId.value) break
      freeCanvasUploadStatus.value = `正在上传 ${index + 1}/${accepted.length}`
      try {
        const asset = await uploadAPI.uploadAsset(file, { dramaId: requestedDramaId })
        if (!canvasInstanceActive.value || requestedDramaId !== dramaId.value) break
        const existing = projectAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
        projectAssets.value = [asset, ...existing]
        const nodePosition = position
          ? { x: position.x + index * 28, y: position.y + index * 28 }
          : null
        await createFreeNodeFromAsset(asset, nodePosition)
        succeeded += 1
      } catch (error) {
        ElMessage.warning(`${file.name || '素材'} 上传失败：${error?.message || '请稍后重试'}`)
      }
    }
  } finally {
    if (canvasInstanceActive.value && requestedDramaId === dramaId.value) {
      freeCanvasUploading.value = false
      freeCanvasUploadStatus.value = ''
    }
  }
  if (succeeded) ElMessage.success(`已添加 ${succeeded} 个素材到自由画布`)
}

function onFreeCanvasDragOver(event) {
  const types = Array.from(event?.dataTransfer?.types || [])
  if (
    canvasMode.value !== 'free'
    || (!types.includes('Files') && !types.includes(FREE_CANVAS_MEDIA_DRAG_TYPE))
  ) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}

function onFreeCanvasDrop(event) {
  if (canvasMode.value !== 'free') return
  const files = Array.from(event?.dataTransfer?.files || [])
  if (files.length) {
    event.preventDefault()
    const position = screenToFlowPosition(event.clientX, event.clientY)
    void uploadFreeCanvasFiles(files, position)
    return
  }
  const types = Array.from(event?.dataTransfer?.types || [])
  if (!types.includes(FREE_CANVAS_MEDIA_DRAG_TYPE)) return
  event.preventDefault()
  const payload = parseFreeCanvasMediaDragPayload(
    event.dataTransfer.getData(FREE_CANVAS_MEDIA_DRAG_TYPE),
    dramaId.value,
  )
  if (!payload) return
  const item = payload.kind === 'storyboard-media'
    ? freeStoryboardMediaItems.value.find((candidate) => (
      String(candidate.id) === payload.mediaId
      && String(candidate.storyboardId) === payload.storyboardId
      && Number(candidate.projectId) === payload.projectId
    ))
    : projectAssets.value.find((candidate) => (
      String(candidate.id) === payload.mediaId
      && (candidate.drama_id == null || Number(candidate.drama_id) === payload.projectId)
    ))
  if (!item) return
  const position = screenToFlowPosition(event.clientX, event.clientY)
  if (!position) return
  void createFreeNodeFromLibraryItem(item, position)
}

function goMediaLibrary() {
  router.push({ name: 'media-library', query: { returnTo: buildCanvasReturnTo() } })
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.(
    'input, textarea, select, [contenteditable="true"], .el-input, .el-textarea',
  ))
}

function isEditableKeyTarget(target) {
  return isTypingTarget(target) || Boolean(target?.closest?.(
    'button, video, audio, .el-popper, .free-canvas-inspector-dock',
  ))
}

function selectAllFreeCanvasNodes() {
  selectedFreeNodeIds.value = freeCanvas.value.nodes.map((node) => node.id)
  selectedFreeEdgeIds.value = []
  selectedFreeNodeId.value = selectedFreeNodeIds.value.length === 1 ? selectedFreeNodeIds.value[0] : null
  nodes.value = nodes.value.map((node) => ({
    ...node,
    selected: isFreeCanvasNodeId(node.id),
  }))
  edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
}

function copyFreeCanvasSelection() {
  if (!selectedFreeNodeIds.value.length) return false
  freeClipboard = {
    projectId: Number(dramaId.value),
    state: serializeFreeCanvas(freeCanvas.value),
    nodeIds: [...selectedFreeNodeIds.value],
  }
  freePasteCount = 0
  return true
}

function pasteFreeCanvasSelection() {
  if (!freeClipboard || Number(freeClipboard.projectId) !== Number(dramaId.value)) return false
  const sourceState = normalizeFreeCanvas(freeClipboard.state)
  const offset = 24 * (freePasteCount + 1)
  const cloned = cloneFreeSelection(sourceState, freeClipboard.nodeIds, { x: offset, y: offset })
  const originalNodeIds = new Set(sourceState.nodes.map((node) => String(node.id)))
  const originalEdgeIds = new Set(sourceState.edges.map((edge) => String(edge.id)))
  const available = Math.max(0, 500 - freeCanvas.value.nodes.length)
  const copiedNodes = cloned.nodes
    .filter((node) => !originalNodeIds.has(String(node.id)))
  if (!copiedNodes.length) {
    ElMessage.warning(available ? '复制内容已不可用' : '自由画布已达到 500 个节点上限')
    return false
  }
  if (copiedNodes.length > available) {
    ElMessage.warning(`需要 ${copiedNodes.length} 个空位，当前只剩 ${available} 个；已保留原画布`)
    return false
  }
  const copiedNodeIds = new Set(copiedNodes.map((node) => String(node.id)))
  const remainingEdgeCapacity = Math.max(0, 1000 - freeCanvas.value.edges.length)
  const copiedEdges = cloned.edges
    .filter((edge) => !originalEdgeIds.has(String(edge.id)))
    .filter((edge) => copiedNodeIds.has(String(edge.source)) && copiedNodeIds.has(String(edge.target)))
  if (copiedEdges.length > remainingEdgeCapacity) {
    ElMessage.warning(`需要 ${copiedEdges.length} 条连线额度，当前只剩 ${remainingEdgeCapacity} 条；已保留原画布`)
    return false
  }
  freePasteCount += 1
  selectedFreeNodeIds.value = copiedNodes.map((node) => node.id)
  selectedFreeEdgeIds.value = copiedEdges.map((edge) => edge.id)
  selectedFreeNodeId.value = copiedNodes.length === 1 ? copiedNodes[0].id : null
  commitFreeCanvasState({
    ...freeCanvas.value,
    nodes: [...freeCanvas.value.nodes, ...copiedNodes],
    edges: [...freeCanvas.value.edges, ...copiedEdges],
  }, 'paste')
  return true
}

function handleFreeCanvasKeydown(event) {
  if (canvasMode.value !== 'free') return
  if (event.key === 'Escape') {
    if (isEditableKeyTarget(event.target)) return
    if (contextMenuVisible.value) {
      event.preventDefault()
      closeContextMenu()
      return
    }
    if (selectedFreeNodeId.value) {
      event.preventDefault()
      closeFreeCanvasInspector({ restoreFocus: true })
    }
    return
  }
  if (isTypingTarget(event.target)) return

  const modifier = event.ctrlKey || event.metaKey
  const key = String(event.key || '').toLowerCase()
  if (!modifier && (event.key === 'Enter' || event.key === ' ')) {
    const nodeId = event.target?.closest?.('.vue-flow__node')?.dataset?.id
    if (isFreeCanvasNodeId(nodeId)) {
      event.preventDefault()
      event.stopPropagation()
      finishFreeCanvasNodeEditing(nodeId)
      activateFreeCanvasNode(nodeId, { focusInspector: false })
      return
    }
  }
  if (modifier && key === 'a') {
    event.preventDefault()
    selectAllFreeCanvasNodes()
    return
  }
  if (modifier && key === 'c') {
    if (copyFreeCanvasSelection()) event.preventDefault()
    return
  }
  if (modifier && key === 'v') {
    if (pasteFreeCanvasSelection()) event.preventDefault()
    return
  }
  if (modifier && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoFreeCanvas()
    else undoFreeCanvas()
    return
  }
  if (modifier && key === 'y') {
    event.preventDefault()
    redoFreeCanvas()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedFreeNodeIds.value.length || selectedFreeEdgeIds.value.length) {
      event.preventDefault()
      deleteFreeCanvasSelection()
    }
  }
}

function safeFreeCanvasError(error, fallback) {
  const message = String(error?.message || '').replace(/[\r\n\0]+/g, ' ').trim()
  const trustedMessages = new Set(['本地保存暂时不可用'])
  if (trustedMessages.has(message)) return message
  const safeFallback = String(fallback || '操作失败，请重试').replace(/[\r\n\0]+/g, ' ').trim()
  return safeFallback.slice(0, 240) || '操作失败，请重试'
}

function freeNodeReferenceText(node) {
  const title = String(node?.title || node?.label || '').trim()
  const content = String(node?.content ?? node?.text ?? node?.description ?? '').trim()
  if (!title) return content
  if (!content || content === title) return title
  return `${title}\n${content}`
}

function appendFreeReference(existing, node) {
  const reference = freeNodeReferenceText(node)
  if (!reference) return String(existing || '')
  const block = `[自由画布参考]\n${reference}`
  const current = String(existing || '').trim()
  if (current.includes(block)) return current
  return current ? `${current}\n\n${block}` : block
}

function resolveFreeConversionTarget(value) {
  const match = /^(character|scene|prop|storyboard):(\d+)$/.exec(String(value || ''))
  if (!match) return null
  const [, type, rawId] = match
  const id = Number(rawId)
  if (type === 'storyboard') {
    const storyboard = storyboardsById.value.get(String(id))
    return storyboard ? { type, id, entity: storyboard, label: storyboard.title || `分镜 ${id}` } : null
  }
  const collection = type === 'character'
    ? drama.value?.characters
    : type === 'scene'
      ? drama.value?.scenes
      : drama.value?.props
  const entity = (collection || []).find((item) => Number(item.id) === id)
  if (!entity) return null
  const label = type === 'scene' ? entity.location : entity.name
  return { type, id, entity, label: label || String(id) }
}

function freeNodeMediaReference(node) {
  return resolveFreeCanvasMediaPath(node, projectAssetsById.value)
}

async function convertFreeCanvasReference(payload = {}) {
  if (freeInspectorBusy.value) return
  const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(payload.id))
  const target = resolveFreeConversionTarget(payload.target)
  if (!node || !target) {
    ElMessage.warning('转换目标已不可用，请重新选择')
    return
  }

  const mediaReference = freeNodeMediaReference(node)
  const textReference = freeNodeReferenceText(node)
  const isVideoReference = node.type === 'video'
  if (!mediaReference && !textReference) {
    ElMessage.warning('当前节点没有可转换的文本或本地素材')
    return
  }
  if (isVideoReference && target.type !== 'storyboard' && mediaReference) {
    ElMessage.warning('角色、场景和道具参考只接受图片；请先将视频保存为素材')
    return
  }

  const operation = mediaReference
    ? (target.type === 'storyboard' ? '追加为分镜参考图' : '覆盖目标的参考图')
    : '追加到目标描述'
  freeInspectorBusy.value = true
  freeInspectorAction.value = 'convert'
  try {
    await ElMessageBox.confirm(
      `将“${node.title || '自由节点'}”${operation}：${target.label}。自由节点会保留。`,
      '确认转为制作参考',
      {
        type: 'warning',
        confirmButtonText: '确认转换',
        cancelButtonText: '取消',
      },
    )
  } catch (_) {
    freeInspectorBusy.value = false
    freeInspectorAction.value = ''
    return
  }

  try {
    if (target.type === 'character') {
      if (mediaReference) await characterAPI.putRefImage(target.id, mediaReference)
      else await characterAPI.update(target.id, { description: appendFreeReference(target.entity.description, node) })
    } else if (target.type === 'scene') {
      if (mediaReference) await sceneAPI.putRefImage(target.id, mediaReference)
      else await sceneAPI.update(target.id, { prompt: appendFreeReference(target.entity.prompt, node) })
    } else if (target.type === 'prop') {
      if (mediaReference) await propAPI.putRefImage(target.id, mediaReference)
      else await propAPI.update(target.id, { description: appendFreeReference(target.entity.description, node) })
    } else if (mediaReference) {
      if (isVideoReference) {
        throw new Error('分镜参考区域只接受图片素材')
      }
      const current = Array.isArray(target.entity.reference_images) ? target.entity.reference_images : []
      const nextReference = {
        name: node.title || '自由画布参考图',
        local_path: mediaReference,
        image_url: `/static/${mediaReference}`,
        source_drama_id: Number(dramaId.value),
        source_drama_title: drama.value?.title || '',
      }
      const deduped = current.filter((item) => String(item?.local_path || '') !== mediaReference)
      const nextReferences = [...deduped, nextReference]
      if (nextReferences.length > 10) nextReferences.splice(0, nextReferences.length - 10)
      await storyboardsAPI.update(target.id, { reference_images: nextReferences })
    } else {
      await storyboardsAPI.update(target.id, {
        description: appendFreeReference(target.entity.description, node),
      })
    }

    const nextNodes = freeCanvas.value.nodes.map((item) => {
      if (String(item.id) !== String(node.id)) return item
      if (target.type === 'storyboard') {
        return { ...item, storyboard_ref: target.id, storyboardId: target.id }
      }
      if (target.type === 'scene') return { ...item, sceneId: target.id }
      return item
    })
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `convert:${target.type}`)
    await loadCanvasProject({ blocking: false, preserveOnError: true, preserveFreeState: true })
    ElMessage.success('已转换为制作参考，自由节点仍保留在画布中')
  } catch (error) {
    ElMessage.error(safeFreeCanvasError(error, '转换失败，请检查目标和素材后重试'))
  } finally {
    freeInspectorBusy.value = false
    freeInspectorAction.value = ''
  }
}

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
    ElMessage.error(safeFreeCanvasError(error, '素材保存失败，请重试'))
  } finally {
    freeInspectorBusy.value = false
    freeInspectorAction.value = ''
  }
}
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
.layout-save-error {
  max-width: 320px;
  color: var(--canvas-danger-text);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

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
.drama-canvas-page.free-inspector-open .canvas-main {
  margin-right: 380px;
}
.free-canvas-inspector-dock {
  position: fixed;
  top: 150px;
  right: 20px;
  z-index: 1200;
  width: min(340px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 174px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.free-canvas-bottom-toolbar {
  position: absolute;
  left: 50%;
  bottom: 20px;
  z-index: 1100;
  max-width: calc(100% - 220px);
  transform: translateX(-50%);
  box-shadow: var(--canvas-raised-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
}
.free-canvas-empty-state {
  position: absolute;
  inset: 22% 24px auto;
  z-index: 1050;
  display: grid;
  justify-items: center;
  gap: 14px;
  color: var(--canvas-text-primary);
  text-align: center;
  pointer-events: none;
}
.free-canvas-empty-state h2 {
  margin: 0;
  font-size: 18px;
  line-height: 24px;
}
.free-canvas-empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  pointer-events: auto;
}
.drama-canvas-page.free-mode :deep(.vue-flow__node:not(.vue-flow__node-freeCanvas)) {
  opacity: 0.16;
  filter: grayscale(0.85);
  pointer-events: none;
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
  .drama-canvas-page.inspector-open .canvas-main,
  .drama-canvas-page.free-inspector-open .canvas-main {
    margin-right: 0;
  }
}
@media (max-width: 760px) {
  .free-canvas-inspector-dock {
    top: 104px;
    right: 16px;
    width: calc(100vw - 32px);
    max-height: min(620px, calc(100vh - 120px));
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
