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

        <span v-if="layoutSaveState === 'saving'" class="layout-status saving" aria-live="polite">保存中…</span>
        <span v-else-if="layoutSaveState === 'saved'" class="layout-status saved" aria-live="polite">已保存</span>
        <span v-else-if="layoutSaveState === 'error'" class="layout-status error" role="alert">保存失败</span>
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
        <el-button
          v-if="episodeGenerating"
          type="warning"
          plain
          size="small"
          aria-label="取消批量生成"
          @click="cancelEpisodeGenerate"
        >
          取消
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
        @cancel-workflow="cancelActiveWorkflow"
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
          <el-button link size="small" @click="goListMode">列表模式</el-button>
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
          <el-button @click="goProjectList">返回项目列表</el-button>
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
            :aria-label="`定位角色${c.name || '未命名'}`"
            @click="selectSidebarAsset('char:' + c.id)"
          >
            {{ c.name || '未命名' }}
          </button>
          <p v-if="!(drama.characters || []).length" class="sidebar-empty" role="status">
            暂无角色
            <el-button link type="primary" size="small" aria-label="新建角色" @click="openCreateDialog('character')">新建</el-button>
          </p>
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
            :aria-label="`定位场景${s.location || '未命名'}`"
            @click="selectSidebarAsset('scene:' + s.id)"
          >
            {{ s.location || '未命名' }}
          </button>
          <p v-if="!(drama.scenes || []).length" class="sidebar-empty" role="status">
            暂无场景
            <el-button link type="primary" size="small" aria-label="新建场景" @click="openCreateDialog('scene')">新建</el-button>
          </p>
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
            :aria-label="`定位道具${p.name || '未命名'}`"
            @click="selectSidebarAsset('prop:' + p.id)"
          >
            {{ p.name || '未命名' }}
          </button>
          <p v-if="!(drama.props || []).length" class="sidebar-empty" role="status">
            暂无道具
            <el-button link type="primary" size="small" aria-label="新建道具" @click="openCreateDialog('prop')">新建</el-button>
          </p>
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
          :only-render-visible-elements="true"
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
          aria-describedby="free-canvas-empty-desc"
        >
          <h2 id="free-canvas-empty-title">开始自由创作</h2>
          <p id="free-canvas-empty-desc">还没有自由节点。可以新建文本、配置，或导入媒体开始编排。</p>
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
      @select="onFreeCanvasMediaPicked"
      @open-library="goMediaLibrary"
    />
    <CanvasInspectorDock
      v-if="focusedInspectorNode"
      :key="`${dramaId}:${focusedInspectorNode.id}`"
      :node="focusedInspectorNode"
    />
    <FreeCanvasInspector
      v-if="selectedFreeNode"
      :key="`${dramaId}:${selectedFreeNode.id}`"
      class="free-canvas-inspector-dock"
      :data-free-node-id="String(selectedFreeNode.id)"
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

import { workflowRunsAPI } from '@/api/workflowRuns'
import { aiAPI } from '@/api/ai'
import { useTheme } from '@/composables/useTheme'
import { CANVAS_CONTEXT_KEY } from '@/composables/useCanvasContext'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { useDramaCanvasFreeCanvas } from '@/composables/useDramaCanvasFreeCanvas'
import { useDramaCanvasPersist } from '@/composables/useDramaCanvasPersist'
import { useDramaCanvasProjectLoad } from '@/composables/useDramaCanvasProjectLoad'
import { useDramaCanvasWorkflow } from '@/composables/useDramaCanvasWorkflow'
import { useDramaCanvasGraph } from '@/composables/useDramaCanvasGraph'
import { useDramaCanvasViewport } from '@/composables/useDramaCanvasViewport'
import { useCanvasStoryboardMedia } from '@/composables/useCanvasStoryboardMedia'
import { useCanvasCrud } from '@/composables/useCanvasCrud'
import { useCanvasEpisodeGenerate } from '@/composables/useCanvasEpisodeGenerate'
import { useCanvasScript, scriptNodeId } from '@/composables/useCanvasScript'
import { createCanvasNodeStatusStore } from '@/composables/useCanvasNodeStatus'
import { createCanvasNodeGenerationCoordinator } from '@/utils/canvasNodeGenerationCoordinator'
import { useCanvasWorkflowOrder } from '@/composables/useCanvasWorkflowOrder'
import {
  getStoryboardRefFromNode,
} from '@/utils/dramaCanvasAdapter'
import {
  parseCanvasLayout,
  parseFreeCanvas,
  resolveViewport,
} from '@/utils/canvasLayout'
import { buildFreeCanvasGraph } from '@/utils/freeCanvasAdapter'
import { buildFreeCanvasConfigRuntime } from '@/utils/freeCanvasConfigState'
import {
  buildFreeCanvasStoryboardMediaItems,
  getFreeCanvasAssetSaveEligibility,
} from '@/utils/freeCanvasMedia'
import {
  createEmptyFreeCanvas,
} from '@/utils/freeCanvasState'
import {
  findStoryboardInDrama,
  normalizePipeline,
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
import CanvasInspectorDock from '@/components/dramaCanvas/CanvasInspectorDock.vue'
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

let paneClickSuppressTimer = null
let canvasResizeObserver = null
let canvasReadyFrame = null
let readinessRequestId = 0
let freeCanvasCapabilityRequestId = 0
let canvasEntityFocusRevision = 0
let canvasRouteSynchronization = Promise.resolve(true)
const canvasCommandBridge = {
  scheduleLayoutSave() {},
  resetFreeCanvasClipboard() {},
  finishFreeCanvasNodeEditing() {},
}
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
const focusedInspectorNode = computed(() => {
  const id = focusedNodeId.value
  if (!id) return null
  return nodes.value.find((node) => (
    String(node.id) === String(id) && PANEL_NODE_TYPES.has(node.type)
  )) || null
})
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
  dramaId: dramaId.value,
  reusePolicy: 'current-or-global',
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
    && !episodeGenerating.value
    && !nodeGenerationCoordinator.hasActive()
  ) return
  event.preventDefault()
  event.returnValue = ''
}

async function ensureEpisodeGenerationFinished() {
  if (!episodeGenerating.value) return true
  try {
    await ElMessageBox.confirm(
      '离开会停止当前页面继续等待和显示进度，但已提交的后台任务及供应商计费可能继续。是否仍要离开？',
      '批量生成仍在执行',
      { type: 'warning', confirmButtonText: '停止等待并离开', cancelButtonText: '继续等待' },
    )
  } catch (_) {
    return false
  }
  abortEpisodeGenerate()
  return true
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
      if (!await ensureEpisodeGenerationFinished()) return false
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

const {
  freeCanvasUiMode,
  normalizeFreeCanvasForProject,
  hydrateFreeCanvasState,
  loadProjectAssets,
  modeScopedProductionGraph,
  mergeActiveCanvasGraphs,
  pruneFreeCanvasSelection,
  commitFreeCanvasState,
  applyFreeCanvasHistoryState,
  setCanvasMode,
  undoFreeCanvas,
  redoFreeCanvas,
  setFreeCanvasBackground,
  syncWorkflowFromDrama,
  rebuildGraph,
  applyHighlight,
  selectSidebarAsset,
  setHighlightAsset,
  clearAssetHighlight,
  canUndoFreeCanvasHistory,
  canRedoFreeCanvasHistory,
} = useDramaCanvasGraph({
  canvasProjectId,
  dramaId,
  drama,
  nodes,
  edges,
  productionGraph,
  freeCanvas,
  freeCanvasReadOnly,
  freeCanvasCompatibilityMessage,
  canvasMode,
  selectedFreeNodeId,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  editingFreeNodeId,
  freeHistoryRevision,
  projectAssets,
  highlightAssetId,
  filterEpisodeId,
  savedLayout,
  workflowGroups,
  activeGroupId,
  imagesBySbId,
  videosBySbId,
  getStoryboardMediaQueryStatus,
  currentViewport,
  productionViewport,
  canvasFlowApi,
  freeGraph,
  focusedNodeId,
  setFocusedCanvasNode,
  isCanvasAbortError,
  scheduleLayoutSave: (...args) => canvasCommandBridge.scheduleLayoutSave(...args),
  resetFreeCanvasClipboard: (...args) => canvasCommandBridge.resetFreeCanvasClipboard(...args),
  finishFreeCanvasNodeEditing: (...args) => canvasCommandBridge.finishFreeCanvasNodeEditing(...args),
  closeFreeCanvasInspector,
})

const canUndoFreeCanvas = computed(() => {
  freeHistoryRevision.value
  return canvasMode.value === 'free' && !freeCanvasReadOnly.value && canUndoFreeCanvasHistory()
})
const canRedoFreeCanvas = computed(() => {
  freeHistoryRevision.value
  return canvasMode.value === 'free' && !freeCanvasReadOnly.value && canRedoFreeCanvasHistory()
})


const {
  loadCanvasProject,
  retryCanvasProjectLoad,
  loadDrama,
  hasProcessingStoryboards,
  startStatusPoll,
  stopStatusPoll,
  invalidateCanvasLoads,
} = useDramaCanvasProjectLoad({
  isCanvasReady,
  canvasInstanceActive,
  dramaId,
  loading,
  canvasLoadState,
  canvasLoadError,
  canvasLoadNotFound,
  coreCanvasDramaAPI,
  drama,
  nodes,
  edges,
  layoutCache,
  syncWorkflowFromDrama,
  productionViewport,
  hydrateFreeCanvasState,
  currentViewport,
  canvasMode,
  freeCanvas,
  filterEpisodeId,
  routeEpisodeId,
  loadForDrama,
  loadProjectAssets,
  rebuildGraph,
  isCanvasAbortError,
  friendlyCanvasProjectLoadError,
  canvasLoadFailureRef,
  claimRouteEntityFocus,
  synchronizeRouteFocusedEntity,
  safeFreeCanvasError,
})

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
    if (isCanvasUserAbort(e)) return
    ElMessage.error(safeFreeCanvasError(e, '创建失败'))
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
      error: safeFreeCanvasError(error, '正式制作能力加载失败'),
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
  setMediaValidity: (nodeId, state) => {
    if (nodeId) mediaValidity[nodeId] = state
  },
  clearMediaValidity: (nodeId) => {
    if (nodeId) delete mediaValidity[nodeId]
  },
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

const {
  layoutSaveState,
  layoutSaveError,
  failedCanvasSaveOperation,
  layoutDirty,
  canvasSaveCoordinator,
  scheduleLayoutSave,
  cancelScheduledCanvasSave,
  hasPendingCanvasSaves,
  waitForCanvasSaveSettlement,
  persistCanvasState,
  retryCanvasSave,
  abandonCanvasSaveOperation,
  disposeCanvasPersist,
} = useDramaCanvasPersist({
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
})
canvasCommandBridge.scheduleLayoutSave = scheduleLayoutSave


const {
  workflowOrderSaving,
  reorderWorkflowStoryboards,
} = useCanvasWorkflowOrder({
  workflowGroups,
  persist: () => persistCanvasState({ groupsOnly: true, reportError: false }),
  onSaveFailed: (error, result) => {
    abandonCanvasSaveOperation(result?.operation)
    ElMessage.error(`分镜排序保存失败，已恢复原顺序：${safeFreeCanvasError(error, '保存失败')}`)
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
  isFreeCanvasNodeId,
  shouldIgnoreEmptyFreeSelection,
  resetFreeCanvasClipboard,
  freeCanvasConfigRuntime,
  configureFreeCanvasNode,
  cancelFreeCanvasConfig,
  retryFreeCanvasConfig,
  createFreeCanvasNode,
  updateFreeCanvasNode,
  updateFreeNodeContent,
  activateFreeCanvasNode,
  openFreeCanvasInspectorFor,
  startFreeCanvasNodeEditing,
  finishFreeCanvasNodeEditing,
  focusFreeCanvasNodeTrigger,
  deleteFreeCanvasNode,
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
  uploadFreeCanvasFiles,
  onFreeCanvasDragOver,
  onFreeCanvasDrop,
  copyFreeCanvasSelection,
  handleFreeCanvasKeydown,
  convertFreeCanvasReference,
  saveFreeCanvasNodeAsAsset,
} = useDramaCanvasFreeCanvas({
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
})
canvasCommandBridge.resetFreeCanvasClipboard = resetFreeCanvasClipboard
canvasCommandBridge.finishFreeCanvasNodeEditing = finishFreeCanvasNodeEditing

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

const {
  fitCanvasView,
  zoomCanvasIn,
  zoomCanvasOut,
  toggleCanvasInteractive,
  onCanvasNodesInitialized,
  onSelectionChange,
  onViewportChange,
  syncProductionGraphPositions,
  onCanvasNodeDragStop,
  onCanvasMoveEnd,
  onAlignNodes,
} = useDramaCanvasViewport({
  canvasFlowApi,
  canvasMode,
  canvasInteractive,
  currentViewport,
  productionViewport,
  productionGraph,
  nodes,
  freeCanvas,
  selectedStoryboardIds,
  selectedFreeNodeId,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  editingFreeNodeId,
  initialFitDone,
  hasSavedViewport,
  aligningNodes,
  drama,
  filterEpisodeId,
  workflowGroups,
  imagesBySbId,
  videosBySbId,
  layoutCache,
  MIN_READABLE_CANVAS_ZOOM,
  shouldIgnoreEmptyFreeSelection,
  isFreeCanvasNodeId,
  scheduleLayoutSave,
  commitFreeCanvasState,
  persistCanvasState,
  setFocusedCanvasNode,
  currentCanvasProjectId,
  isCanvasProjectCurrent,
  routeFocusNodeId,
  synchronizeRouteFocusedEntity,
  claimRouteEntityFocus,
  safeFreeCanvasError,
})



const {
  episodeGenerating,
  episodeGenProgress,
  aiGenerateStoryboards: runAiGenerateStoryboards,
  batchGenerateImages: runBatchGenerateImages,
  batchGenerateVideos: runBatchGenerateVideos,
  abortEpisodeGenerate,
} = useCanvasEpisodeGenerate({
  drama,
  filterEpisodeId,
  imagesBySbId,
  videosBySbId,
  refreshCanvas,
  nodeStatus,
})

function cancelEpisodeGenerate() {
  abortEpisodeGenerate()
}

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

const {
  onCreateWorkflowGroup,
  onDeleteActiveGroup,
  onRunActiveGroup,
  cancelActiveWorkflow,
  refreshUnknownWorkflowOutcome,
} = useDramaCanvasWorkflow({
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
})

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
  if (target?.closest?.('.canvas-node-panel') || target?.closest?.('.canvas-inspector-dock') || target?.closest?.('.free-canvas-inspector-dock') || target?.closest?.('.el-popper') || target?.closest?.('.canvas-context-menu')) {
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
  window.addEventListener('keydown', handleFreeCanvasKeydown, true)
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
  window.removeEventListener('keydown', handleFreeCanvasKeydown, true)
  activeWorkflowRun.value?.controller?.abort()
  activeWorkflowRun.value = null
  abortEpisodeGenerate()
  nodeGenerationCoordinator.stopWaiting('画布已关闭，后台任务和供应商计费可能继续')
  if (layoutDirty.value) {
    void persistCanvasState({ layoutOnly: true, reportError: false, allowDuringTeardown: true })
  }
  canvasInstanceActive.value = false
  invalidateCanvasLoads()
  readinessRequestId++
  freeCanvasCapabilityRequestId++
  disposeCanvasPersist()
  if (paneClickSuppressTimer) clearTimeout(paneClickSuppressTimer)
  if (canvasReadyFrame != null) window.cancelAnimationFrame(canvasReadyFrame)
  canvasResizeObserver?.disconnect()
  stopStatusPoll()
})

function closeFreeCanvasInspector({ restoreFocus = true, invalidateFocus = true } = {}) {
  const previousId = selectedFreeNodeId.value
  if (invalidateFocus) canvasEntityFocusRevision += 1
  selectedFreeNodeId.value = null
  if (restoreFocus && previousId) void focusFreeCanvasNodeTrigger(previousId)
}
function goMediaLibrary() {
  router.push({ name: 'media-library', query: { returnTo: buildCanvasReturnTo() } })
}
function safeFreeCanvasError(error, fallback) {
  return canvasUserError(error, fallback || '操作失败，请重试')
}
</script>

<style scoped src="./DramaCanvas.css"></style>

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
