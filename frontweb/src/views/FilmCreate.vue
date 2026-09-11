<template>
  <div class="film-create" :class="{ 'sidebar-collapsed': navCollapsed, 'project-state-active': projectLoadState !== 'ready' }">
    <!-- 顶部 -->
    <FilmCreateHeader
      ref="filmCreateHeaderRef"
      v-bind="headerBindings"
    />

    <!-- 左侧固定侧边栏 -->
    <FilmCreateQuickNav
      v-if="projectLoadState === 'ready'"
      :nav-collapsed="navCollapsed"
      :nav-steps="navSteps"
      :active-nav-anchor="activeNavAnchor"
      v-model:storyboard-menu-expanded="storyboardMenuExpanded"
      :storyboards="storyboards"
      :all-active-task-items="allActiveTaskItems"
      :all-active-task-labels="allActiveTaskLabels"
      :pipeline-stopping="pipelineStopping"
      @toggle-nav="toggleNav"
      @scroll-to-anchor="scrollToAnchor"
      @cancel-active-task="cancelActiveTask"
    />

    <FilmCreateProjectLoadState
      v-if="projectLoadState !== 'ready'"
      ref="projectLoadFailureRef"
      :state="projectLoadState"
      :error-text="projectLoadError"
      :not-found="projectLoadNotFound"
      :pending="projectLoadPending"
      @retry="retryFilmProjectLoad"
      @go-list="goList"
    />

    <main v-else class="main">
      <FilmCreateProjectDependencyWarning
        :media-error="storyboardMediaLoadError"
        :dependency-warning="projectDependencyWarning"
        :loading="projectDependencyLoading"
        @retry="retryProjectDependencies"
      />

      <FilmCreatePipelinePanel
        ref="pipelinePanelRef"
        v-bind="pipelinePanelBindings"
      />

      <!-- 剧本工作台：单卡片 + 选项卡（创作 / 选择） -->
      <FilmCreateScriptWorkbench
        class="section card script-workbench-unified"
        v-bind="scriptWorkbenchBindings"
        v-model:story-input="storyInput"
        @generate-story="onGenerateStory"
        @return-to-creation="returnToScriptCreation"
      />

      <!-- 资源管理：角色 / 道具 / 场景 -->
      <FilmCreateResourcePanel
        class="section card resource-panel"
        v-bind="resourcePanelBindings"
        :character-generation-disabled-reason="characterGenerationDisabledReason"
      />
      <!-- 分镜生成 -->
      <FilmCreateStoryboardPanel
        class="section card"
        id="anchor-storyboard"
        v-bind="storyboardPanelBindings"
        :batch-action-disabled-reason="batchActionDisabledReason"
      />
      <FilmCreateOutputSection
        v-bind="outputSectionBindings"
      />
    </main>

    <FilmCreateWorkspaceDialogs
      v-if="projectLoadState === 'ready'"
      ref="aiConfigContentRef"
      :resource-dialogs="resourceDialogsBindings"
      :storyboard-dialogs="storyboardDialogsBindings"
      v-model:visible="showNovelImport"
      v-model:mode="novelImportMode"
      v-model:text="novelText"
      v-model:max-chapters="novelMaxChapters"
      v-model:ai-summarize="novelAiSummarize"
      :file-name="novelFileName"
      :importing="novelImporting"
      @reset="novelImportReset"
      @file-change="onNovelFileChange"
      @import="onImportNovel"
      v-model="showAiConfigDialog"
      :initial-service-type="aiConfigInitialServiceType"
      :before-close="confirmAiConfigWorkspaceClose"
      @back="requestAiConfigWorkspaceClose"
      @configuration-changed="onAiConfigurationChanged"
      :preview-image-url="previewImageUrl || ''"
      @close-image-preview="closeImagePreview"
      v-model:show-global-media-picker="showGlobalMediaPicker"
      :global-media-picker-title="globalMediaPickerTitle"
      :global-media-picker-accept="globalMediaPickerAccept"
      :global-media-picker-context="globalMediaPickerContext"
      @select="onGlobalMediaAssetSelected"
      @open-library="openMediaLibraryFromPicker"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive, nextTick } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { useTheme } from '@/composables/useTheme'
import { useFilmStore } from '@/stores/film'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { syncGeneratingSetsFromStore, buildEpisodeContext, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { dramaAPI as rawDramaAPI } from '@/api/drama'
import { timelinesAPI as rawTimelinesAPI } from '@/api/timelines'
import { generationAPI as rawGenerationAPI } from '@/api/generation'
import { characterAPI as rawCharacterAPI } from '@/api/characters'
import { propAPI as rawPropAPI } from '@/api/props'
import { sceneAPI as rawSceneAPI } from '@/api/scenes'
import { taskAPI as rawTaskAPI } from '@/api/task'
import { imagesAPI as rawImagesAPI } from '@/api/images'
import { videosAPI as rawVideosAPI } from '@/api/videos'
import { storyboardsAPI as rawStoryboardsAPI } from '@/api/storyboards'
import { uploadAPI as rawUploadAPI } from '@/api/upload'
import { characterLibraryAPI as rawCharacterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI as rawSceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI as rawPropLibraryAPI } from '@/api/propLibrary'
import {
  createEpisodeSwitchController,
} from '@/utils/scriptDraft'
import { isPlaceholderMediaUrl, storyboardImageUrl } from '@/utils/mediaUrl'
import FilmCreateHeader from '@/components/filmCreate/FilmCreateHeader.vue'
import FilmCreateProjectLoadState from '@/components/filmCreate/FilmCreateProjectLoadState.vue'
import FilmCreateQuickNav from '@/components/filmCreate/FilmCreateQuickNav.vue'
import FilmCreatePipelinePanel from '@/components/filmCreate/FilmCreatePipelinePanel.vue'
import FilmCreateScriptWorkbench from '@/components/filmCreate/FilmCreateScriptWorkbench.vue'
import FilmCreateResourcePanel from '@/components/filmCreate/FilmCreateResourcePanel.vue'
import FilmCreateStoryboardPanel from '@/components/filmCreate/FilmCreateStoryboardPanel.vue'
import FilmCreateProjectDependencyWarning from '@/components/filmCreate/FilmCreateProjectDependencyWarning.vue'
import FilmCreateOutputSection from '@/components/filmCreate/FilmCreateOutputSection.vue'
import FilmCreateWorkspaceDialogs from '@/components/filmCreate/FilmCreateWorkspaceDialogs.vue'
import {
  userFacingVideoGenerationError,
} from '@/utils/filmCreateActionState'
import { createFilmCreateWorkspaceBindingSources } from '@/components/filmCreate/filmCreateWorkspaceBindings.js'
import {
  createFilmCreateSurfaceBindingSources,
  createFilmCreateSurfaceBindings,
} from '@/components/filmCreate/filmCreateSurfaceBindings.js'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import {
  generationStyleOptions,
} from '@/constants/styleOptions'
import { useNavigation } from '@/composables/filmCreate/useNavigation'
import { useCharacters } from '@/composables/filmCreate/useCharacters'
import { useProps as usePropsComposable } from '@/composables/filmCreate/useProps'
import { useScenes } from '@/composables/filmCreate/useScenes'
import { useFilmCreateStoryboardMedia } from '@/composables/filmCreate/useFilmCreateStoryboardMedia'
import { useFilmCreatePipelineRun } from '@/composables/filmCreate/useFilmCreatePipelineRun'
import { useFilmCreatePipelineStages } from '@/composables/filmCreate/useFilmCreatePipelineStages'
import { useFilmCreateBatchGeneration } from '@/composables/filmCreate/useFilmCreateBatchGeneration'
import { useFilmCreateStoryboardImageGeneration } from '@/composables/filmCreate/useFilmCreateStoryboardImageGeneration'
import { useFilmCreateStoryboardVideoGeneration } from '@/composables/filmCreate/useFilmCreateStoryboardVideoGeneration'
import { useFilmCreateStoryboardTts } from '@/composables/filmCreate/useFilmCreateStoryboardTts'
import { useFilmCreateLinkedStoryboardRegen } from '@/composables/filmCreate/useFilmCreateLinkedStoryboardRegen'
import { useFilmCreateUniversalSegment } from '@/composables/filmCreate/useFilmCreateUniversalSegment'
import { useFilmCreateStoryboardUpload } from '@/composables/filmCreate/useFilmCreateStoryboardUpload'
import { useFilmCreateResourceUpload } from '@/composables/filmCreate/useFilmCreateResourceUpload'
import { useFilmCreateStoryboardCrud } from '@/composables/filmCreate/useFilmCreateStoryboardCrud'
import { useFilmCreateStoryboardPrompts } from '@/composables/filmCreate/useFilmCreateStoryboardPrompts'
import { useFilmCreateTailFrameLink } from '@/composables/filmCreate/useFilmCreateTailFrameLink'
import { useFilmCreateScriptPersistence } from '@/composables/filmCreate/useFilmCreateScriptPersistence'
import { useFilmCreateStoryboardReferences } from '@/composables/filmCreate/useFilmCreateStoryboardReferences'
import { useFilmCreateScriptWorkspace } from '@/composables/filmCreate/useFilmCreateScriptWorkspace'
import { useFilmCreateScriptNovelState } from '@/composables/filmCreate/useFilmCreateScriptNovelState'
import { useFilmCreateNavigationGuards } from '@/composables/filmCreate/useFilmCreateNavigationGuards'
import { useFilmCreateProjectLoad } from '@/composables/filmCreate/useFilmCreateProjectLoad'
import { useFilmCreateStoryboardBindings } from '@/composables/filmCreate/useFilmCreateStoryboardBindings'
import { useFilmCreateStoryboardExport } from '@/composables/filmCreate/useFilmCreateStoryboardExport'
import { useFilmCreateEpisodeCompose } from '@/composables/filmCreate/useFilmCreateEpisodeCompose'
import { useFilmCreateProductionReadiness } from '@/composables/filmCreate/useFilmCreateProductionReadiness'
import { useFilmCreateRouteSync } from '@/composables/filmCreate/useFilmCreateRouteSync'
import { useFilmCreateWorkspaceBootstrap } from '@/composables/filmCreate/useFilmCreateWorkspaceBootstrap'
import { useFilmCreateTaskPolling } from '@/composables/filmCreate/useFilmCreateTaskPolling'
import { useFilmCreateMediaPreview } from '@/composables/filmCreate/useFilmCreateMediaPreview'
import { useFilmCreateTaskRecovery } from '@/composables/filmCreate/useFilmCreateTaskRecovery'
import { useFilmCreateStoryboardAccessors } from '@/composables/filmCreate/useFilmCreateStoryboardAccessors'
import { useFilmCreateStoryboardFields } from '@/composables/filmCreate/useFilmCreateStoryboardFields'
import { useFilmCreateDeliverySettings } from '@/composables/filmCreate/useFilmCreateDeliverySettings'
import { useFilmCreatePromptDialogState } from '@/composables/filmCreate/useFilmCreatePromptDialogState'
import { useFilmCreateProjectLoadSurface } from '@/composables/filmCreate/useFilmCreateProjectLoadSurface'
import { useFilmCreateAiConfigDialogState } from '@/composables/filmCreate/useFilmCreateAiConfigDialogState'
import { useFilmCreateResourcePanelState } from '@/composables/filmCreate/useFilmCreateResourcePanelState'
import { useFilmCreateMediaPickerState } from '@/composables/filmCreate/useFilmCreateMediaPickerState'
import { useFilmCreateMediaPickerCopy } from '@/composables/filmCreate/useFilmCreateMediaPickerCopy'
import { useFilmCreateBatchMediaState } from '@/composables/filmCreate/useFilmCreateBatchMediaState'
import { useFilmCreateUploadDragState } from '@/composables/filmCreate/useFilmCreateUploadDragState'
import { useFilmCreateStoryboardGenerateSettings } from '@/composables/filmCreate/useFilmCreateStoryboardGenerateSettings'
import { useFilmCreateProductionCapabilityState } from '@/composables/filmCreate/useFilmCreateProductionCapabilityState'
import { useFilmCreateOmniPolishState } from '@/composables/filmCreate/useFilmCreateOmniPolishState'
import { useFilmCreateInFlightMediaSets } from '@/composables/filmCreate/useFilmCreateInFlightMediaSets'
import { useFilmCreateStoryboardStateSync } from '@/composables/filmCreate/useFilmCreateStoryboardStateSync'
import { useFilmCreateStoryboardVideoFields } from '@/composables/filmCreate/useFilmCreateStoryboardVideoFields'
import { useFilmCreateRefImageDrop } from '@/composables/filmCreate/useFilmCreateRefImageDrop'
import { useFilmCreateStylePrompts } from '@/composables/filmCreate/useFilmCreateStylePrompts'
import { useFilmCreateWorkspaceNav } from '@/composables/filmCreate/useFilmCreateWorkspaceNav'
import { useFilmCreateAiConfigWorkspace } from '@/composables/filmCreate/useFilmCreateAiConfigWorkspace'
import { useFilmCreateDeliveryActions } from '@/composables/filmCreate/useFilmCreateDeliveryActions'
import { useFilmCreateScriptEstimates } from '@/composables/filmCreate/useFilmCreateScriptEstimates'
import { useFilmCreateTaskCancel } from '@/composables/filmCreate/useFilmCreateTaskCancel'
import { useFilmCreateActiveTasks } from '@/composables/filmCreate/useFilmCreateActiveTasks'
import { useFilmCreateNavSteps } from '@/composables/filmCreate/useFilmCreateNavSteps'
import { useFilmCreateActionDisabledReasons } from '@/composables/filmCreate/useFilmCreateActionDisabledReasons'
import { trackFilmCreateAction } from '@/utils/filmCreateActionLog'
import { useFilmCreateScriptDraft } from '@/composables/filmCreate/useFilmCreateScriptDraft'
import { useFilmCreateResourceGenerate } from '@/composables/filmCreate/useFilmCreateResourceGenerate'
import { useFilmCreateTtsDisableReason } from '@/composables/filmCreate/useFilmCreateTtsDisableReason'
import { useFilmCreateFirstLastFrameSetting } from '@/composables/filmCreate/useFilmCreateFirstLastFrameSetting'
import { createProjectInstanceLifecycle } from '@/utils/projectInstanceLifecycle.js'

const projectLifecycle = createProjectInstanceLifecycle()
const ElMessage = projectLifecycle.guardNotifier(RawElMessage)
const dramaAPI = projectLifecycle.guardApi(rawDramaAPI)
const timelinesAPI = projectLifecycle.guardApi(rawTimelinesAPI)
const generationAPI = projectLifecycle.guardApi(rawGenerationAPI)
const characterAPI = projectLifecycle.guardApi(rawCharacterAPI)
const propAPI = projectLifecycle.guardApi(rawPropAPI)
const sceneAPI = projectLifecycle.guardApi(rawSceneAPI)
const taskAPI = projectLifecycle.guardApi(rawTaskAPI)
const imagesAPI = projectLifecycle.guardApi(rawImagesAPI)
const videosAPI = projectLifecycle.guardApi(rawVideosAPI)
const storyboardsAPI = projectLifecycle.guardApi(rawStoryboardsAPI)
const uploadAPI = projectLifecycle.guardApi(rawUploadAPI)
const characterLibraryAPI = projectLifecycle.guardApi(rawCharacterLibraryAPI)
const sceneLibraryAPI = projectLifecycle.guardApi(rawSceneLibraryAPI)
const propLibraryAPI = projectLifecycle.guardApi(rawPropLibraryAPI)

const route = useRoute()
const router = useRouter()
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.query.returnTo))
const store = useFilmStore()
const genStore = useGenerationTaskStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { videoResolution: storeVideoResolution } = storeToRefs(store)
const initialRouteProjectId = route.params.id && route.params.id !== 'new' ? Number(route.params.id) : null
const {
  projectLoadState,
  projectLoadError,
  projectLoadNotFound,
  projectLoadPending,
  projectLoadFailureRef,
  projectDependencyWarning,
  projectDependencyLoading,
  projectPageTitle,
} = useFilmCreateProjectLoadSurface({ initialRouteProjectId, store })

// ── Composable: Navigation ─────────────────────────────
const { navCollapsed, storyboardMenuExpanded, activeNavAnchor, toggleNav, scrollToTop, scrollToAnchor } = useNavigation({
  getAnchorIds: () => navSteps.value.map((step) => step.anchor),
})


const {
  showAiConfigDialog,
  aiConfigContentRef,
  pipelinePanelRef,
  aiConfigInitialServiceType,
  aiConfigChanged,
  aiConfigOpenedFromPipelineAction,
} = useFilmCreateAiConfigDialogState()
const {
  videoCapabilityConfigs,
  videoCapabilityLoading,
  videoCapabilityFailed,
  authoritativeProductionReadiness,
  productionReadinessLoading,
  productionReadinessFailed,
} = useFilmCreateProductionCapabilityState()

const {
  openAiConfig,
  openAiConfigFromPipeline,
  onAiConfigurationChanged,
  confirmAiConfigWorkspaceClose,
  requestAiConfigWorkspaceClose,
} = useFilmCreateAiConfigWorkspace({
  ElMessage,
  showAiConfigDialog,
  aiConfigContentRef,
  pipelinePanelRef,
  aiConfigInitialServiceType,
  aiConfigChanged,
  aiConfigOpenedFromPipelineAction,
  invalidateActiveVideoAiConfigCache: (...args) => invalidateActiveVideoAiConfigCache(...args),
  refreshVideoGenerationCapability: (...args) => refreshVideoGenerationCapability(...args),
  refreshProductionReadiness: (...args) => refreshProductionReadiness(...args),
})

const {
  storyInput,
  storyStyle,
  storyType,
  storyEpisodeCount,
  storyGenerating,
  scriptWorkbenchMode,
  showSelectScriptDialog,
  selectScriptLoading,
  selectScriptImporting,
  selectScriptDramas,
  selectableScriptDramas,
  selectPreviewEpisodeId,
  showNovelImport,
  novelImportMode,
  novelText,
  novelFileName,
  novelFileContent,
  novelMaxChapters,
  novelAiSummarize,
  novelImporting,
  scriptTitle,
  selectedEpisodeId,
  episodeSwitching,
  selectedEpisodeContextLabel,
  savedCurrentEpisodeNumber,
  scriptLanguage,
  scriptStoryboardStyle,
  scriptGenerating,
  scriptDraftStatus,
  scriptDraftStatusLabel,
  isStoryGenRunning,
} = useFilmCreateScriptNovelState({ store, genStore })

const {
  generationStyle,
  projectAspectRatio,
  videoClipDuration,
  videoMusic,
  videoSfx,
  videoQuality,
  videoSubtitle,
  videoBurnDialogue,
  videoWatermark,
  videoWatermarkText,
} = useFilmCreateDeliverySettings()

const {
  getSelectedStylePrompt,
  getSelectedStylePromptZh,
  projectStylePromptMetadata,
  getSelectedStyle,
} = useFilmCreateStylePrompts({
  generationStyle,
})


const scriptContent = computed({
  get: () => store.scriptContent,
  set: (v) => store.setScriptContent(v)
})
const videoResolution = storeVideoResolution

const dramaId = computed(() => store.dramaId)
const characters = computed(() => store.characters)
const scenes = computed(() => store.scenes)
const props = computed(() => store.props)
const storyboards = computed(() => store.storyboards)
const currentEpisode = computed(() => store.currentEpisode)
const currentEpisodeId = computed(() => store.currentEpisode?.id ?? null)

const {
  invalidateActiveVideoAiConfigCache,
  getNovel2AnimeReadiness,
  refreshProductionReadiness,
  refreshVideoGenerationCapability,
  getActiveVideoAiConfig,
  canUseUniversalOmniVideoApi,
  confirmUniversalNonSeedance2Video,
  videoGenerationCapability,
  videoCapabilityReason,
  productionCapabilityGaps,
  productionReadinessState,
  productionReadinessReason,
  ttsCapabilityReason,
} = useFilmCreateProductionReadiness({
  dramaId,
  productionReadinessLoading,
  productionReadinessFailed,
  authoritativeProductionReadiness,
  videoCapabilityLoading,
  videoCapabilityFailed,
  videoCapabilityConfigs,
})
const productionReadinessServiceType = computed(() => (
  productionCapabilityGaps.value.find((gap) => gap.service_type)?.service_type || ''
))

const {
  pollUntilResourceHasImage,
  resolvePollMeta,
  pollTask,
} = useFilmCreateTaskPolling({
  genStore,
  dramaId,
  currentEpisodeId,
  store,
  ElMessage,
  loadDrama: (...args) => loadDrama(...args),
})

const {
  baseUrl,
  previewImageUrl,
  imageUrl,
  assetImageUrl,
  hasAssetImage,
  openImagePreview,
  closeImagePreview,
  assetVideoUrl,
  isHttpVideoUrl,
  recordHasPlayableVideoUrl,
  toAbsoluteImageUrl,
} = useFilmCreateMediaPreview({
  ElMessage,
})
const hasAnyEpisode = computed(() => (store.drama?.episodes || []).length > 0)
const {
  showGlobalMediaPicker,
  globalMediaPickerMode,
  globalMediaPickerTarget,
} = useFilmCreateMediaPickerState()

const {
  filmCreateHeaderRef,
  goList,
  goCanvasMode,
  openMediaLibraryFromPicker,
  onSelectEpisode,
} = useFilmCreateWorkspaceNav({
  router,
  route,
  dramaId,
  selectedEpisodeId,
  projectListReturnTo,
  showGlobalMediaPicker,
})
const {
  globalMediaPickerAccept,
  globalMediaPickerTitle,
  globalMediaPickerContext,
} = useFilmCreateMediaPickerCopy({
  globalMediaPickerMode,
  globalMediaPickerTarget,
  currentEpisode,
  store,
})

const {
  scriptDraftController,
  captureScriptDraft,
  markScriptDraftSaved,
  persistScriptDraftSnapshot,
  flushScriptDraft,
} = useFilmCreateScriptDraft({
  store,
  dramaAPI,
  scriptTitle,
  scriptContent,
  scriptDraftStatus,
  currentEpisodeId,
})

const episodeSwitchController = createEpisodeSwitchController({
  flushDraft: flushScriptDraft,
  resolveEpisode: (episodeId) => (store.drama?.episodes || []).find((episode) => (
    Number(episode.id) === Number(episodeId)
  )) || null,
  commitEpisode: (episode) => applySelectedEpisode(episode),
  refreshEpisode: (...args) => refreshProjectDependencies(...args),
  onBusyChange: (busy) => {
    episodeSwitching.value = busy
  },
})

const videoProgress = computed(() => store.videoProgress)
const videoStatus = computed(() => store.videoStatus)


const {
  currentEpisodeVideoUrl,
  deliveryCompositeStatusLabel,
  deliverySubtitleAvailable,
  deliveryFileCount,
  videoDownloadStatus,
  videoDownloadError,
  deliveryExportStatus,
  deliveryExportError,
  deliveryExportHasError,
  deliveryExportFeedback,
  buildDeliveryFilename,
  downloadCurrentEpisodeVideo,
  downloadCurrentEpisodeSubtitle,
  exportCurrentProjectPackage,
} = useFilmCreateDeliveryActions({
  store,
  ElMessage,
  dramaId,
  currentEpisode,
  currentEpisodeId,
  storyboards,
  videoStatus,
  videoProgress,
  timelinesAPI,
  dramaAPI,
})

const storyboardGenerating = computed(() =>
  isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.GENERATE_STORYBOARD)
)
/** 分镜批量生成结束后，按镜序逐个润色全能片段（仅勾选全能模式且各镜为 universal 且有正文时） */
const {
  universalOmniPolishRunning,
  universalOmniPolishAbort,
  universalOmniPolishProgress,
  sbTruncatedWarning,
  sbTruncatedDismissed,
  videoErrorMsg,
} = useFilmCreateOmniPolishState()
// 一键全流程流水线
const {
  pipelineRunning,
  pipelineStarting,
  pipelineStopping,
  pipelinePaused,
  pipelineAbortRequested,
  pipelineErrorLog,
  pipelineCurrentStep,
  pipelineStepIndex,
  pipelineStepTotal,
  pipelineOwnedTaskIds,
  activePipelineRunPromise,
  pipelineCountdown,
  pipelineCountdownMsg,
  pipelineConcurrency,
  pipelineVideoConcurrency,
  pipelineActiveTasks,
  loadPipelineConcurrency,
  runConcurrently,
  cancelPipelineRun,
  pollTaskWithPause,
  onPipelineResume,
  addPipelineError,
  checkPause,
  pipelineRest,
  skipPipelineCountdown,
  runPipelineCountdown,
  pipelineWithRetry,
  confirmProductionPipelineCost,
  executeOwnedPipelineRun,
  setPipelineStep,
} = useFilmCreatePipelineRun({
  store,
  videoClipDuration,
  taskAPI,
  genStore,
  trackFilmCreateAction,
  getStoryboardCountForApi: () => getStoryboardCountForApi(),
  get storyboardMediaActionReason() {
    return storyboardMediaActionReason
  },
  resolvePollMeta: (meta) => resolvePollMeta(meta),
})

// ── Composable: Characters ────────────────────────────
const {
  showEditCharacter, editCharacterForm, editCharacterSaving, editCharacterPromptGenerating,
  extractingCharAppearance, extractingAnchors, addCharRefImage, addCharRefFileInput,
  charactersGenerating, generatingCharIds, sd2CertifyingId, showCharSd2Cert, charSd2CertPayload,
  sd2VoiceUploadingId,
  showCharLibrary, charLibraryList, charLibraryLoading, charLibraryPage, charLibraryPageSize,
  charLibraryTotal, charLibraryKeyword, charLibraryTab,
  dramaAllCharList, dramaAllCharLoading, dramaAllCharPage, dramaAllCharPageSize, dramaAllCharTotal, dramaAllCharKeyword,
  showEditCharLibrary, editCharLibraryForm,
  editCharLibrarySaving, addingCharToLibraryId, addingCharToMaterialId, addingCharFromLibraryId,
  charRoleLabel, onGenerateCharacters: onGenerateCharactersRaw, openAddCharacter, stopCharacterPromptPoll, editCharacter,
  saveCharRefImageIfAny, submitEditCharacter, doGenerateCharacterPrompt, doExtractCharFromImage,
  extractIdentityAnchors, clearCharRefImage, onCloseCharDialog, onDeleteCharacter, onGenerateCharacterImage, onSd2CertifyCharacter, onSd2CertifyRefresh, sd2ActionLabel, onSd2PrimaryAction, openCharSd2CertDialog,
  onSd2VoicePrimaryAction, onSd2VoiceReplace, sd2VoiceActionLabel, playSd2Voice,
  loadCharLibraryList, debouncedLoadCharLibrary, loadDramaAllCharList, debouncedLoadDramaAllCharList,
  onCharLibraryDialogOpen, onCharLibraryTabChange, isCharAddToEpisodeLoading,
  openEditCharLibrary, submitEditCharLibrary,
  onDeleteCharLibrary, onAddCharacterToLibrary, onAddCharacterToMaterialLibrary,
  onAddCharFromLibrary, onAddDramaCharToEpisode,
} = useCharacters({
  store,
  dramaId,
  currentEpisodeId,
  getSelectedStyle,
  loadDrama: (...args) => loadDrama(...args),
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  ElMessage,
  characterAPI,
  characterLibraryAPI,
  dramaAPI,
  generationAPI,
  uploadAPI,
})

// ── Composable: Props ──────────────────────────────────
const {
  showAddProp, addPropSaving, addPropForm,
  showEditProp, editPropForm, editPropSaving, editPropPromptGenerating,
  extractingPropDesc, addPropRefImage, addPropRefFileInput,
  addPropAddRefImage, addPropAddRefFileInput, extractingPropAddDesc,
  propsExtracting, generatingPropIds,
  showPropLibrary, propLibraryList, propLibraryLoading, propLibraryPage, propLibraryPageSize,
  propLibraryTotal, propLibraryKeyword, propLibraryTab,
  dramaAllPropList, dramaAllPropLoading, dramaAllPropPage, dramaAllPropPageSize, dramaAllPropTotal, dramaAllPropKeyword,
  showEditPropLibrary, editPropLibraryForm,
  editPropLibrarySaving, addingPropToLibraryId, addingPropToMaterialId, addingPropFromLibraryId,
  onExtractProps: onExtractPropsRaw, stopPropPromptPoll, editProp, doGeneratePropPrompt, savePropRefImageIfAny,
  clearPropRefImage, doExtractPropFromImage, submitEditProp, submitAddProp,
  onClosePropDialog, onDeleteProp, onGeneratePropImage,
  loadPropLibraryList, debouncedLoadPropLibrary, loadDramaAllPropList, debouncedLoadDramaAllPropList,
  onPropLibraryDialogOpen, onPropLibraryTabChange, isPropAddToEpisodeLoading,
  openEditPropLibrary, submitEditPropLibrary,
  onDeletePropLibrary, onAddPropToLibrary, onAddPropToMaterialLibrary,
  onAddPropFromLibrary, onAddDramaPropToEpisode,
  doExtractFromRef2,
} = usePropsComposable({
  store,
  dramaId,
  currentEpisodeId,
  getSelectedStyle,
  loadDrama: (...args) => loadDrama(...args),
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  ElMessage,
  propAPI,
  propLibraryAPI,
  uploadAPI,
})

// ── Composable: Scenes ─────────────────────────────────
const {
  showEditScene, editSceneForm, editSceneSaving, editScenePromptGenerating,
  extractingSceneDesc, addSceneRefImage, addSceneRefFileInput,
  scenesExtracting, generatingSceneIds,
  generatingPanoramaIds,
  // 场景多视角额外 state（由 FilmCreate 管理）
  showSceneLibrary, sceneLibraryList, sceneLibraryLoading, sceneLibraryPage, sceneLibraryPageSize,
  sceneLibraryTotal, sceneLibraryKeyword, sceneLibraryTab,
  dramaAllSceneList, dramaAllSceneLoading, dramaAllScenePage, dramaAllScenePageSize, dramaAllSceneTotal, dramaAllSceneKeyword,
  showEditSceneLibrary, editSceneLibraryForm,
  editSceneLibrarySaving, addingSceneToLibraryId, addingSceneToMaterialId, addingSceneFromLibraryId,
  onExtractScenes: onExtractScenesRaw, openAddScene, stopScenePromptPoll, editScene, doGenerateScenePrompt, doGenerateSceneSinglePrompt,
  saveSceneRefImageIfAny, clearSceneRefImage, doExtractSceneFromImage, submitEditScene,
  onCloseSceneDialog, onDeleteScene, onGenerateSceneImage,
  onGenerateScenePanorama,
  loadSceneLibraryList, debouncedLoadSceneLibrary, loadDramaAllSceneList, debouncedLoadDramaAllSceneList,
  onSceneLibraryDialogOpen, onSceneLibraryTabChange, isSceneAddToEpisodeLoading,
  openEditSceneLibrary, submitEditSceneLibrary,
  onDeleteSceneLibrary, onAddSceneToLibrary, onAddSceneToMaterialLibrary,
  onAddSceneFromLibrary, onAddDramaSceneToEpisode,
} = useScenes({
  store,
  dramaId,
  currentEpisodeId,
  getSelectedStyle,
  scriptLanguage,
  loadDrama: (...args) => loadDrama(...args),
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  dramaAPI,
  ElMessage,
  sceneAPI,
  sceneLibraryAPI,
  uploadAPI,
})

const {
  onGenerateCharacters,
  onExtractProps,
  onExtractScenes,
} = useFilmCreateResourceGenerate({
  store,
  trackFilmCreateAction,
  onGenerateCharactersRaw,
  onExtractPropsRaw,
  onExtractScenesRaw,
})


const {
  resourcePanelCollapsed,
  charactersBlockCollapsed,
  propsBlockCollapsed,
  scenesBlockCollapsed,
  sceneUseQuadGrid,
  propUseQuadGrid,
} = useFilmCreateResourcePanelState()

// 分镜行内编辑状态（按 storyboard id 存储）
const {
  sbCharacterIds,
  sbPropIds,
  sbSceneId,
  sbDialogue,
  sbNarration,
  sbShotType,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbAction,
  sbResult,
  sbAtmosphere,
  sbAngle,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbMovement,
  sbLighting,
  sbDof,
  sbLayoutDescription,
  sbCreationMode,
  sbUniversalSegmentText,
  sbVideoReferenceImageId,
} = useFilmCreateStoryboardFields()
const {
  regeneratingLayoutSbIds,
  sbVideoErrors,
  generatingSbImageIds,
  generatingSbVideoIds,
  generatingUniversalSegmentIds,
  generatingSbFirstImageIds,
  generatingSbLastImageIds,
  regenSbImagesForAsset,
  savingSbReferenceImages,
  upscalingSbIds,
  ttsSbIds,
  ttsSbNarrationIds,
  linkingTailFrameIds,
  usingPrevTailAsFirstIds,
  sbDialogueAudioPaths,
  sbNarrationAudioPaths,
} = useFilmCreateInFlightMediaSets()
const {
  sbImages,
  sbVideos,
  storyboardMediaLoadState,
  storyboardMediaLoadError,
  storyboardMediaStateController,
  storyboardMediaActionReason,
  currentStoryboardMediaContext,
  resetStoryboardMediaContext,
  ensureStoryboardMediaContext,
  assertStoryboardMediaReady,
  currentEpisodeStoryboardIds,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  loadStoryboardMedia,
  loadSingleStoryboardMedia,
  captureDramaRefresh,
} = useFilmCreateStoryboardMedia({
  dramaId,
  currentEpisodeId,
  getStoryboards: () => store.storyboards || [],
  imagesAPI,
  videosAPI,
  onSelectionsRestored: () => restoreSelectionsFromBackend(),
  loadDrama: (...args) => loadDrama(...args),
})
const {
  getGeneratingSetsBag,
  buildSbGenMeta,
  isSbVideoGenerating,
  recoverAndSyncEpisodeTasks,
} = useFilmCreateTaskRecovery({
  dramaId,
  currentEpisodeId,
  store,
  genStore,
  ElMessage,
  videoErrorMsg,
  generatingCharIds,
  generatingPropIds,
  generatingSceneIds,
  generatingSbImageIds,
  generatingSbFirstImageIds,
  generatingSbLastImageIds,
  generatingSbVideoIds,
  currentStoryboardMediaContext,
  loadSingleStoryboardMedia,
  captureDramaRefresh,
})
const {
  regenSbImagesProgress,
  batchImageRunning,
  batchImageStopping,
  batchImageProgress,
  inferringParams,
  showVideoParamsDialog,
  videoParamsTarget,
  videoParamsSaving,
  splitByAudioLoading,
  batchImageErrors,
  batchVideoRunning,
  batchVideoStopping,
  batchVideoProgress,
  batchVideoErrors,
  videoFrameContiguity,
} = useFilmCreateBatchMediaState()
const {
  cancelActiveTask,
} = useFilmCreateTaskCancel({
  ElMessage,
  genStore,
  cancelPipelineRun,
  storyGenerating,
  scriptGenerating,
  universalOmniPolishAbort,
  batchImageStopping,
  batchVideoStopping,
})

const {
  allActiveTaskItems,
  allActiveTaskLabels,
} = useFilmCreateActiveTasks({
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
})

const {
  ttsGenerationDisabledReason,
} = useFilmCreateTtsDisableReason({
  ttsSbIds,
  ttsSbNarrationIds,
  ttsCapabilityReason,
})
/** 分镜 TTS 试听：避免多条同时播放 */
/** 正在编辑视频提示词的分镜 id；编辑中显示文本框与保存/取消 */
const {
  editingSbVideoPromptId,
  editingSbVideoPromptText,
  editingSbImagePromptId,
  editingSbImagePromptText,
  showSbPromptDialog,
  sbPromptTarget,
  sbPromptImageText,
  sbPromptPolishedText,
  sbPromptVideoText,
  sbPromptSaving,
  sbPromptPolishing,
  showFramePromptEditor,
  editingFramePromptSb,
  editingFramePromptSlot,
  editingFramePromptText,
  editingFramePromptSaving,
  editingFramePromptRegenerating,
} = useFilmCreatePromptDialogState()
const {
  uploadingSbImageId,
  sbImageFileInput,
  sbImageUploadForId,
  resourceImageFileInput,
  resourceUploadType,
  resourceUploadId,
  uploadingResourceId,
  dragOverResourceKey,
  dragOverSbId,
} = useFilmCreateUploadDragState()

const {
  getFirstImageFile,
  readFileAsRefImage,
  onRefImageFileChange,
  onRefImageDrop,
  onRefImageFileChange2,
  onRefImageDrop2,
  doExtractFromRef,
  onResourceDragOver,
  onResourceDragLeave,
  onResourceDrop,
  onSbImageDragOver,
  onSbImageDragLeave,
  onSbImageDrop,
} = useFilmCreateRefImageDrop({
  ElMessage,
  uploadAPI,
  addCharRefImage,
  addPropRefImage,
  addSceneRefImage,
  addPropAddRefImage,
  extractingCharAppearance,
  extractingPropDesc,
  extractingSceneDesc,
  editCharacterForm,
  editPropForm,
  editSceneForm,
  dragOverResourceKey,
  dragOverSbId,
  doUploadResourceImage: (...args) => doUploadResourceImage(...args),
  doUploadSbImage: (...args) => doUploadSbImage(...args),
})
// 公共库弹窗状态已移至各 composable
const {
  storyboardCount,
  videoDuration,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  storyboardUseFirstLastFrame,
  exportingStoryboardSheet,
  lastFrameUseFirstLayoutLock,
  gridMode,
} = useFilmCreateStoryboardGenerateSettings()

const {
  sbSelectedImgId,
  sbSelectedLastImgId,
  sbSelectedVideoId,
  sbImageUploadSlotById,
  uploadingSbImageSlot,
  frameTypeForSlot,
  resolveSbImageById,
  getSbFirstImage,
  getSbLastImage,
  hasSbImage,
  hasSbFirstLastPair,
  getSbAllImages,
  hasSbDraftImagePlaceholder,
  getSbImage,
  getQuadGridImage,
  getSbAllVideos,
  getSbVideo,
  getNextStoryboard,
  getPrevStoryboard,
  canUsePrevTailAsFirst,
  getVideoStripItems,
  onSelectSbMainVideo,
  getSbVideoError,
  sbMainVideoPlayerKey,
  restoreSelectionsFromBackend,
  getStripItems,
  historyImageLabel,
  stripItemTitle,
  onStripItemClick,
  quadPanelLabel,
  onSelectStripItem,
  onSelectSbFrameImage,
  onSelectSbMainImage,
  onRemoveSbHistoryImage,
  getSbGridImages,
  getSbVideoReferenceGrid,
  getSbFirstFrameUrl,
  getSbLastFrameUrl,
  sbVideoFirstLastUrls,
  getSbLocalImage,
} = useFilmCreateStoryboardAccessors({
  store,
  sbImages,
  sbVideos,
  sbVideoErrors,
  storyboardUseFirstLastFrame,
  isSbUniversalMode: (...args) => isSbUniversalMode(...args),
  storyboardsAPI,
  imagesAPI,
  ElMessage,
  ElMessageBox,
  refreshStoryboardMediaForCurrentContext,
  assetImageUrl,
  assetVideoUrl,
  recordHasPlayableVideoUrl,
  toAbsoluteImageUrl,
  userFacingVideoGenerationError,
  sbVideoReferenceImageId,
})

const {
  navSteps,
} = useFilmCreateNavSteps({
  genStore,
  dramaId,
  currentEpisodeId,
  scriptContent,
  isStoryGenRunning,
  characters,
  hasAssetImage,
  charactersGenerating,
  generatingCharIds,
  props,
  propsExtracting,
  generatingPropIds,
  scenes,
  scenesExtracting,
  generatingSceneIds,
  storyboards,
  storyboardGenerating,
  universalOmniPolishRunning,
  hasSbImage,
  generatingSbImageIds,
  batchImageRunning,
  getSbAllVideos,
  batchVideoRunning,
  generatingSbVideoIds,
  videoStatus,
  currentEpisodeVideoUrl,
})

const {
  projectActionDisabledReason,
  episodeActionDisabledReason,
  characterGenerationDisabledReason,
  propsExtractionDisabledReason,
  scenesExtractionDisabledReason,
  pipelineActionDisabledReason,
  productionPipelineActionDisabledReason,
  storyboardActionDisabledReason,
  batchActionDisabledReason,
  batchVideoActionDisabledReason,
  playableStoryboardVideoCount,
  composeActionDisabledReason,
} = useFilmCreateActionDisabledReasons({
  dramaId,
  currentEpisodeId,
  scriptContent,
  charactersGenerating,
  propsExtracting,
  scenesExtracting,
  pipelineRunning,
  storyboardMediaActionReason,
  productionReadinessReason,
  storyboardGenerating,
  universalOmniPolishRunning,
  batchImageRunning,
  batchVideoRunning,
  videoCapabilityReason,
  storyboards,
  assetVideoUrl,
  getSbVideo,
  videoStatus,
})

const {
  captureVideoLastFrame,
  onUpscaleSbImage,
  onSaveSbNarrationField,
  isSbUniversalMode,
  setSbCreationModeId,
  onToggleSbUniversalMode,
  onSaveUniversalSegmentField,
  universalSegmentDurationSecForSb,
  getSbVideoDurationForApi,
  getMainImageUrlForVideo,
  sbUniversalSegmentTrimmed,
  sbCanSubmitVideo,
  sbVideoGenerationDisabledReason,
  buildSbVideoPromptForApi,
} = useFilmCreateStoryboardVideoFields({
  store,
  storyboardsAPI,
  ElMessage,
  upscalingSbIds,
  refreshStoryboardMediaForCurrentContext,
  sbNarration,
  sbCreationMode,
  sbUniversalSegmentText,
  sbDuration,
  videoClipDuration,
  getSbFirstFrameUrl,
  storyboardMediaActionReason,
  isSbVideoGenerating,
  videoCapabilityReason,
})

const {
  clipSecondsForStoryboardEstimate,
  shotCountEstimateFromDurationSec,
  scriptStoryboardEstimate,
  scriptEstimateVideoDurationHint,
  scriptEstimateVideoDurationTitle,
  scriptEstimateStoryboardHint,
  scriptEstimateStoryboardTitle,
  scriptTextTrimmedForEstimate,
  userFilledStoryboardCount,
  userFilledVideoDuration,
  getVideoDurationForApi,
  getStoryboardCountForApi,
} = useFilmCreateScriptEstimates({
  videoClipDuration,
  scriptContent,
  storyboardCount,
  videoDuration,
})

const {
  onStoryboardUseFirstLastFrameChange,
} = useFilmCreateFirstLastFrameSetting({
  storyboardUseFirstLastFrame,
  gridMode,
  ElMessage,
  saveProjectSettings: (...args) => saveProjectSettings(...args),
})


const {
  buildFirstFrameImagePrompt,
  buildLastFrameImagePrompt,
  getCachedFramePromptFromDb,
  ensureProfessionalFramePrompt,
  openFramePromptEditor,
  showSbFramePromptPreview,
  saveEditingFramePrompt,
  regenerateEditingFramePrompt,
  onGenerateSbFrameImage,
  onGenerateSbFramePair,
  onGenerateSbImage,
} = useFilmCreateStoryboardImageGeneration({
  dramaId,
  store,
  storyboardsAPI,
  imagesAPI,
  genStore,
  pollTask,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  restoreSelectionsFromBackend,
  loadDrama: (...args) => loadDrama(...args),
  getSelectedStyle,
  getSelectedStylePrompt,
  getSelectedStylePromptZh,
  angleToPromptFragment: (...args) => angleToPromptFragment(...args),
  frameTypeForSlot,
  getSbFirstImage,
  buildSbGenMeta,
  assertStoryboardMediaReady,
  storyboardMediaActionReason,
  projectAspectRatio,
  gridMode,
  storyboardUseFirstLastFrame,
  lastFrameUseFirstLayoutLock,
  sbLocation,
  sbTime,
  sbShotType,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbResult,
  sbAction,
  sbAtmosphere,
  sbCharacterIds,
  sbSelectedImgId,
  sbSelectedLastImgId,
  generatingSbImageIds,
  generatingSbFirstImageIds,
  generatingSbLastImageIds,
  showFramePromptEditor,
  editingFramePromptSb,
  editingFramePromptSlot,
  editingFramePromptText,
  editingFramePromptSaving,
  editingFramePromptRegenerating,
})

const {
  onUploadSbImageClick,
  doUploadSbImage,
  onSbImageFileChange,
} = useFilmCreateStoryboardUpload({
  dramaId,
  store,
  uploadAPI,
  imagesAPI,
  storyboardUseFirstLastFrame,
  sbImageUploadForId,
  sbImageUploadSlotById,
  uploadingSbImageId,
  sbSelectedImgId,
  frameTypeForSlot,
  onSelectSbFrameImage,
  refreshStoryboardMediaForCurrentContext,
  restoreSelectionsFromBackend,
})


const {
  syncStoryboardStateFromEpisode,
} = useFilmCreateStoryboardStateSync({
  sbCharacterIds,
  sbPropIds,
  sbSceneId,
  sbDialogue,
  sbNarration,
  sbShotType,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbAction,
  sbResult,
  sbAtmosphere,
  sbAngle,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbMovement,
  sbLighting,
  sbDof,
  sbLayoutDescription,
  sbCreationMode,
  sbUniversalSegmentText,
  sbVideoReferenceImageId,
})

const {
  onEpisodeSelect,
  applySelectedEpisode,
  friendlyFilmProjectLoadError,
  refreshProjectDependencies,
  retryProjectDependencies,
  loadDrama,
  retryFilmProjectLoad,
  invalidateProjectLoads,
} = useFilmCreateProjectLoad({
  store,
  dramaId,
  currentEpisodeId,
  projectLifecycle,
  episodeSwitchController,
  syncEpisodeRouteQuery: (episodeId) => syncEpisodeRouteQuery(episodeId),
  resetStoryboardMediaContext,
  ensureStoryboardMediaContext,
  storyboardMediaStateController,
  syncStoryboardStateFromEpisode,
  markScriptDraftSaved,
  loadStoryboardMedia,
  recoverAndSyncEpisodeTasks,
  loadPipelineConcurrency,
  refreshVideoGenerationCapability: (...args) => refreshVideoGenerationCapability(...args),
  refreshProductionReadiness: (...args) => refreshProductionReadiness(...args),
  scriptTitle,
  selectedEpisodeId,
  savedCurrentEpisodeNumber,
  storyInput,
  storyStyle,
  storyType,
  generationStyle,
  projectAspectRatio,
  videoClipDuration,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  storyboardUseFirstLastFrame,
  lastFrameUseFirstLayoutLock,
  gridMode,
  projectLoadState,
  projectLoadPending,
  projectLoadError,
  projectLoadNotFound,
  projectDependencyWarning,
  projectDependencyLoading,
  projectLoadFailureRef,
  scriptDraftController,
})

const {
  getSbCharacterIds,
  getMovementLabel,
  setSbCharacterIds,
  charactersAvailableToAddToSb,
  onSbAddCharacterCommand,
  getSbPropIds,
  setSbPropIds,
  onStoryboardPropChange,
  getSbSelectedScene,
  getSbSelectedCharacters,
  getSbSelectedProps,
  onStoryboardCharacterChange,
  onLastFrameLayoutLockChange,
  onStoryboardSceneChange,
  dedupeStoryboardsForAssetLink,
  getCharAffectedStoryboards,
  getSceneAffectedStoryboards,
  getPropAffectedStoryboards,
  scrollToStoryboard,
} = useFilmCreateStoryboardBindings({
  storyboards,
  characters,
  props,
  scenes,
  storyboardsAPI,
  sbCharacterIds,
  sbPropIds,
  sbSceneId,
  saveProjectSettings: (...args) => saveProjectSettings(...args),
})

const {
  onRegenAffectedSbImages,
} = useFilmCreateLinkedStoryboardRegen({
  dramaId,
  imagesAPI,
  taskAPI,
  assertStoryboardMediaReady,
  captureStoryboardMediaRefresh,
  storyboardUseFirstLastFrame,
  isSbUniversalMode,
  ensureProfessionalFramePrompt,
  getSelectedStyle,
  projectAspectRatio,
  regenSbImagesForAsset,
  regenSbImagesProgress,
  sbSelectedImgId,
})

const {
  saveScriptToBackend,
  saveProjectSettings,
  onGenerateStory,
} = useFilmCreateScriptPersistence({
  store,
  dramaAPI,
  router,
  route,
  scriptTitle,
  storyType,
  generationStyle,
  storyStyle,
  storyInput,
  projectAspectRatio,
  videoClipDuration,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  storyboardUseFirstLastFrame,
  lastFrameUseFirstLayoutLock,
  projectStylePromptMetadata,
  loadDrama,
  savedCurrentEpisodeNumber,
  selectedEpisodeId,
  onEpisodeSelect,
  storyGenerating,
  scriptGenerating,
  pollTask,
  trackFilmCreateAction,
  storyEpisodeCount,
})

const {
  openSelectScriptDialog,
  returnToScriptCreation,
  returnToCharacterPanel,
  returnToPropPanel,
  returnToScenePanel,
  loadSelectScriptList,
  onPickScriptFromDialog,
  novelImportReset,
  onNovelFileChange,
  onImportNovel,
  onGenerateScript,
  onAddEpisode,
} = useFilmCreateScriptWorkspace({
  store,
  dramaAPI,
  router,
  route,
  loadDrama,
  scrollToAnchor,
  saveScriptToBackend,
  flushScriptDraft,
  markScriptDraftSaved,
  trackFilmCreateAction,
  scriptTitle,
  scriptContent,
  scriptGenerating,
  savedCurrentEpisodeNumber,
  selectedEpisodeId,
  selectPreviewEpisodeId,
  showSelectScriptDialog,
  scriptWorkbenchMode,
  showCharLibrary,
  showPropLibrary,
  showSceneLibrary,
  resourcePanelCollapsed,
  charactersBlockCollapsed,
  propsBlockCollapsed,
  scenesBlockCollapsed,
  selectScriptLoading,
  selectScriptDramas,
  selectScriptImporting,
  novelText,
  novelFileName,
  novelFileContent,
  novelImportMode,
  novelImporting,
  novelMaxChapters,
  novelAiSummarize,
  showNovelImport,
})

const {
  onUploadResourceClick,
  parseExtraImages,
  localPathToUrl,
  findResource,
  doUploadResourceImage,
  onSetPrimaryImage,
  onRemoveExtraImage,
  onResourceImageFileChange,
} = useFilmCreateResourceUpload({
  dramaId,
  store,
  uploadAPI,
  characterAPI,
  propAPI,
  sceneAPI,
  loadDrama,
  resourceUploadType,
  resourceUploadId,
  resourceImageFileInput,
  uploadingResourceId,
})


const {
  normalizeAudioRelPath,
  sbDialogueAudioRelPath,
  sbNarrationAudioRelPath,
  playSbTtsFromRel,
  playSbDialogueTts,
  playSbNarrationTts,
  onTtsSbDialogue,
  onTtsSbNarration,
} = useFilmCreateStoryboardTts({
  ttsSbIds,
  ttsSbNarrationIds,
  sbDialogueAudioPaths,
  sbNarrationAudioPaths,
  sbNarration,
  ttsGenerationDisabledReason,
  projectLifecycle,
})

const {
  formatSrtTimestamp,
  onExportStoryboardSheet,
  onExportNarrationSrt,
} = useFilmCreateStoryboardExport({
  store,
  currentEpisodeId,
  storyboards,
  storyboardsAPI,
  storyboardUseFirstLastFrame,
  exportingStoryboardSheet,
  getSbFirstImage,
  getSbLastImage,
  buildFirstFrameImagePrompt,
  buildLastFrameImagePrompt,
  getSbSelectedScene,
  getSbSelectedCharacters,
  getSbSelectedProps,
  getMovementLabel,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbDialogue,
  sbNarration,
  sbAction,
  sbResult,
  sbAtmosphere,
  sbShotType,
  sbMovement,
  sbLayoutDescription,
  sbUniversalSegmentText,
})


/** 全能提示词生成/润色：提交当前编辑区中的分镜字段（避免未点保存时仍用库内旧对白） */
const {
  buildUniversalSegmentFieldOverrides,
  universalSegmentAtImageToGrokTags,
  onUniversalSegmentToGrokVideoTags,
  onUniversalSegmentPromptMenu,
  onGenerateUniversalSegmentPrompt,
  onPolishUniversalSegmentPromptStream,
  polishUniversalSegmentsAfterGeneration,
} = useFilmCreateUniversalSegment({
  store,
  storyboardsAPI,
  generatingUniversalSegmentIds,
  sbUniversalSegmentText,
  sbUniversalSegmentTrimmed,
  universalSegmentDurationSecForSb,
  isSbUniversalMode,
  storyboardUniversalOmni,
  universalOmniPolishRunning,
  universalOmniPolishAbort,
  universalOmniPolishProgress,
  pipelineRest,
  onSaveUniversalSegmentField,
  sbTitle,
  sbLocation,
  sbTime,
  sbAction,
  sbDialogue,
  sbNarration,
  sbResult,
  sbAtmosphere,
  sbShotType,
  sbMovement,
  sbLayoutDescription,
})


const {
  currentStoryboardReferenceState,
  findStoryboardRow,
  mergeStoryboardIntoStore,
  getSbFreeReferenceItems,
  getSbPrimaryFreeReferenceItem,
  collectSbFreeReferenceAbsoluteUrls,
  uniqueStoryboardReferenceUrls,
  saveStoryboardReferenceImages,
  openGlobalMediaPicker,
  onGlobalMediaAssetSelected,
  onRemoveSbFreeReferenceImage,
  onPromoteSbFreeReferenceImage,
  currentDramaReferenceEntities,
  getSbUniversalOmniRefSlots,
  collectSbOmniReferenceAbsoluteUrls,
  collectSbSceneOnlyReferenceAbsoluteUrls,
  getSbPrimaryReferenceAbsoluteUrl,
  buildStoryboardVideoReferencePayload,
} = useFilmCreateStoryboardReferences({
  store,
  storyboards,
  storyboardsAPI,
  sbSceneId,
  sbCharacterIds,
  sbPropIds,
  videoParamsTarget,
  toAbsoluteImageUrl,
  assetImageUrl,
  scenes,
  characters,
  props,
  savingSbReferenceImages,
  globalMediaPickerMode,
  globalMediaPickerTarget,
  showGlobalMediaPicker,
  getMainImageUrlForVideo,
  sbVideoFirstLastUrls,
})


const {
  onEditSbImagePrompt,
  onOpenSbPromptDialog,
  formatVideoPromptForEdit,
  onPolishSbPrompt,
  onSaveSbPromptDialog,
  onSaveSbImagePrompt,
  onEditSbVideoPrompt,
  angleToPromptFragment,
  onSaveSbVideoFields,
  onSaveSbVideoPrompt,
  onOpenVideoParamsDialog,
  onVideoParamsDialogClosed,
  countDialogueLinesInSb,
  canSplitSbByAudio,
  onSplitSbByAudio,
  onSaveVideoParams,
  onBatchInferParams,
  onRegenerateLayoutDescription,
} = useFilmCreateStoryboardPrompts({
  currentEpisodeId,
  storyboards,
  storyboardsAPI,
  loadDrama,
  refreshStoryboardsOnly: (...args) => refreshStoryboardsOnly(...args),
  editingSbImagePromptId,
  editingSbImagePromptText,
  sbPromptTarget,
  sbPromptImageText,
  sbPromptPolishedText,
  sbPromptVideoText,
  showSbPromptDialog,
  sbPromptPolishing,
  sbPromptSaving,
  editingSbVideoPromptId,
  editingSbVideoPromptText,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbAction,
  sbDialogue,
  sbNarration,
  sbAtmosphere,
  sbResult,
  sbAngle,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbMovement,
  sbLighting,
  sbDof,
  sbShotType,
  sbLayoutDescription,
  sbCreationMode,
  sbUniversalSegmentText,
  sbVideoReferenceImageId,
  regeneratingLayoutSbIds,
  inferringParams,
  videoParamsTarget,
  showVideoParamsDialog,
  videoParamsSaving,
  splitByAudioLoading,
})

const {
  onGenerateSbVideo,
} = useFilmCreateStoryboardVideoGeneration({
  dramaId,
  videosAPI,
  storyboardsAPI,
  genStore,
  pollTask,
  captureStoryboardMediaRefresh,
  sbVideoGenerationDisabledReason,
  isSbUniversalMode,
  sbVideoReferenceImageId,
  getSbVideoReferenceGrid,
  getActiveVideoAiConfig,
  canUseUniversalOmniVideoApi,
  confirmUniversalNonSeedance2Video,
  toAbsoluteImageUrl,
  assetImageUrl,
  collectSbOmniReferenceAbsoluteUrls,
  collectSbSceneOnlyReferenceAbsoluteUrls,
  collectSbFreeReferenceAbsoluteUrls,
  getSbFirstFrameUrl,
  getSbPrimaryReferenceAbsoluteUrl,
  generatingSbVideoIds,
  buildSbGenMeta,
  sbVideoErrors,
  buildStoryboardVideoReferencePayload,
  assertStoryboardMediaReady,
  buildSbVideoPromptForApi,
  getSelectedStyle,
  projectAspectRatio,
  videoResolution,
  getSbVideoDurationForApi,
  sbSelectedVideoId,
  userFacingVideoGenerationError,
})

const {
  onLinkTailFrameToNext,
  onUsePrevTailAsFirst,
} = useFilmCreateTailFrameLink({
  dramaId,
  storyboardsAPI,
  imagesAPI,
  getNextStoryboard,
  getPrevStoryboard,
  getSbVideo,
  getSbLastImage,
  linkingTailFrameIds,
  usingPrevTailAsFirstIds,
  refreshStoryboardMediaForCurrentContext,
  refreshStoryboardsOnly: (...args) => refreshStoryboardsOnly(...args),
  onSelectSbFrameImage,
  sbSelectedImgId,
})

const {
  refreshStoryboardsForEpisode,
  refreshStoryboardsOnly,
  onGenerateStoryboard,
  onAddSingleStoryboard,
  onDeleteSingleStoryboard,
  onInsertStoryboardBefore,
  storyboardReorderBusy,
  dropTargetStoryboardIndex,
  onMoveStoryboardUp,
  onMoveStoryboardDown,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDragEnd,
  onReorderDrop,
} = useFilmCreateStoryboardCrud({
  currentEpisodeId,
  dramaId,
  store,
  dramaAPI,
  storyboardsAPI,
  genStore,
  pollTask,
  captureDramaRefresh,
  loadDrama,
  getSelectedStyle,
  getStoryboardCountForApi,
  getVideoDurationForApi,
  projectAspectRatio,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  sbTruncatedWarning,
  sbTruncatedDismissed,
  polishUniversalSegmentsAfterGeneration,
  trackFilmCreateAction,
})

const {
  startBatchImageGeneration,
  startBatchVideoGeneration,
} = useFilmCreateBatchGeneration({
  currentEpisodeId,
  dramaId,
  store,
  pipelineRunning,
  pipelineConcurrency,
  pipelineVideoConcurrency,
  storyboardMediaActionReason,
  batchImageRunning,
  batchImageStopping,
  batchImageErrors,
  batchImageProgress,
  batchVideoRunning,
  batchVideoStopping,
  batchVideoErrors,
  batchVideoProgress,
  sbImages,
  sbVideos,
  sbSelectedImgId,
  sbSelectedVideoId,
  gridMode,
  storyboardUseFirstLastFrame,
  videoFrameContiguity,
  projectAspectRatio,
  videoResolution,
  generatingSbVideoIds,
  loadStoryboardMedia,
  hasSbImage,
  isSbUniversalMode,
  ensureProfessionalFramePrompt,
  assertStoryboardMediaReady,
  imagesAPI,
  videosAPI,
  storyboardsAPI,
  uploadAPI,
  pollTask,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  restoreSelectionsFromBackend,
  getSelectedStyle,
  getSbVideoReferenceGrid,
  sbCanSubmitVideo,
  getSbFirstFrameUrl,
  collectSbSceneOnlyReferenceAbsoluteUrls,
  collectSbOmniReferenceAbsoluteUrls,
  getSbPrimaryReferenceAbsoluteUrl,
  toAbsoluteImageUrl,
  assetImageUrl,
  recordHasPlayableVideoUrl,
  buildStoryboardVideoReferencePayload,
  buildSbVideoPromptForApi,
  getSbVideoDurationForApi,
  captureVideoLastFrame,
  buildSbGenMeta,
  refreshVideoGenerationCapability,
  canUseUniversalOmniVideoApi,
})

const {
  getFinalizeMergeOptions,
  onGenerateVideo,
} = useFilmCreateEpisodeCompose({
  store,
  dramaId,
  currentEpisodeId,
  dramaAPI,
  genStore,
  pollTask: (...args) => pollTask(...args),
  captureDramaRefresh,
  loadDrama,
  composeActionDisabledReason,
  currentEpisodeVideoUrl,
  videoErrorMsg,
  videoSubtitle,
  videoBurnDialogue,
  videoWatermark,
  videoWatermarkText,
})


const {
  startOneClickPipeline,
  startTextFrameworkPipeline,
  runOneClickPipeline,
  startRepairPipeline,
  runRepairPipeline,
} = useFilmCreatePipelineStages({
  currentEpisodeId,
  dramaId,
  store,
  storyInput,
  scriptLanguage,
  generationAPI,
  dramaAPI,
  propAPI,
  characterAPI,
  sceneAPI,
  imagesAPI,
  videosAPI,
  loadDrama,
  loadStoryboardMedia,
  refreshStoryboardsOnly,
  getStoryboardCountForApi,
  getVideoDurationForApi,
  projectAspectRatio,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  polishUniversalSegmentsAfterGeneration,
  hasAssetImage,
  hasSbImage,
  generatingCharIds,
  generatingSceneIds,
  generatingPropIds,
  generatingSbImageIds,
  generatingSbVideoIds,
  getSelectedStyle,
  captureDramaRefresh,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  pollUntilResourceHasImage,
  sceneUseQuadGrid,
  storyboardUseFirstLastFrame,
  isSbUniversalMode,
  ensureProfessionalFramePrompt,
  assertStoryboardMediaReady,
  sbVideos,
  recordHasPlayableVideoUrl,
  sbCanSubmitVideo,
  collectSbOmniReferenceAbsoluteUrls,
  getSbFirstFrameUrl,
  buildStoryboardVideoReferencePayload,
  buildSbVideoPromptForApi,
  getSbVideoDurationForApi,
  videoResolution,
  buildSbGenMeta,
  getFinalizeMergeOptions,
  refreshProductionReadiness,
  trackFilmCreateAction,
  pipelineStarting,
  pipelineRunning,
  pipelineStopping,
  activePipelineRunPromise,
  pipelineAbortRequested,
  pipelineErrorLog,
  pipelineCurrentStep,
  pipelineStepIndex,
  pipelineActiveTasks,
  pipelineOwnedTaskIds,
  pipelineStepTotal,
  pipelineConcurrency,
  pipelineVideoConcurrency,
  executeOwnedPipelineRun,
  confirmProductionPipelineCost,
  checkPause,
  pollTaskWithPause,
  addPipelineError,
  pipelineRest,
  runPipelineCountdown,
  pipelineWithRetry,
  runConcurrently,
  setPipelineStep,
  storyboardMediaActionReason,
})

const {
  hasActivePipelineWork,
  handleBeforeUnload,
  requestAiConfigWorkspaceNavigation,
  flushDraftBeforeNavigation,
  confirmPipelineNavigation,
  allowNavigationAfterDraftFlush,
} = useFilmCreateNavigationGuards({
  pipelineStarting,
  pipelineRunning,
  pipelineStopping,
  activePipelineRunPromise,
  pipelineOwnedTaskIds,
  showAiConfigDialog,
  aiConfigContentRef,
  scriptDraftController,
  flushScriptDraft,
  cancelPipelineRun,
  batchImageRunning,
  batchImageStopping,
  batchVideoRunning,
  batchVideoStopping,
  generatingSbImageIds,
  generatingSbVideoIds,
  generatingSbFirstImageIds,
  generatingSbLastImageIds,
  generatingUniversalSegmentIds,
  ttsSbIds,
  ttsSbNarrationIds,
  upscalingSbIds,
})

onBeforeRouteLeave(allowNavigationAfterDraftFlush)
onBeforeRouteUpdate(allowNavigationAfterDraftFlush)

const {
  applyRouteToStore,
  syncEpisodeRouteQuery,
} = useFilmCreateRouteSync({
  route,
  router,
  store,
  dramaId,
  invalidateProjectLoads,
  resetStoryboardMediaContext,
  loadDrama,
  projectLoadError,
  projectLoadNotFound,
  projectDependencyWarning,
  projectLoadPending,
  projectDependencyLoading,
  projectLoadState,
  selectedEpisodeId,
  savedCurrentEpisodeNumber,
  storyInput,
  scriptTitle,
  storyStyle,
  storyType,
  scriptLanguage,
  scriptStoryboardStyle,
  generationStyle,
  markScriptDraftSaved,
  onEpisodeSelect,
})

const {
  headerBindings,
  pipelinePanelBindings,
  outputSectionBindings,
} = createFilmCreateSurfaceBindings({
  ...createFilmCreateSurfaceBindingSources({
    store, router, isDark, projectPageTitle, projectLoadState,
    dramaId, hasAnyEpisode, selectedEpisodeId, episodeSwitching,
    selectedEpisodeContextLabel, goList, onEpisodeSelect, onAddEpisode,
    goCanvasMode, toggleTheme, openAiConfig,
    projectAspectRatio, videoClipDuration, scriptLanguage, generationStyle,
    generationStyleOptions, productionPipelineActionDisabledReason, pipelineActionDisabledReason,
    productionReadinessReason, productionReadinessState, productionReadinessServiceType,
    pipelineStarting, pipelineStopping, pipelineAbortRequested, pipelineRunning,
    pipelinePaused, pipelineErrorLog, pipelineCurrentStep, pipelineStepIndex,
    pipelineStepTotal, pipelineCountdown, pipelineCountdownMsg, pipelineActiveTasks,
    saveProjectSettings, startOneClickPipeline, startTextFrameworkPipeline,
    openAiConfigFromPipeline, refreshProductionReadiness, onPipelineResume,
    cancelPipelineRun, skipPipelineCountdown,
    videoResolution, videoSubtitle, videoBurnDialogue, videoWatermark,
    videoWatermarkText, playableStoryboardVideoCount, storyboards,
    deliveryCompositeStatusLabel, deliveryFileCount, composeActionDisabledReason,
    videoStatus, videoProgress, currentEpisodeVideoUrl, videoDownloadStatus,
    videoDownloadError, currentEpisodeId, deliverySubtitleAvailable,
    deliveryExportStatus, videoErrorMsg, deliveryExportFeedback, deliveryExportHasError,
    onGenerateVideo, downloadCurrentEpisodeVideo, downloadCurrentEpisodeSubtitle,
    exportCurrentProjectPackage,
  }),
})

const {
  scriptWorkbenchBindings,
  resourcePanelBindings,
  storyboardPanelBindings,
  resourceDialogsBindings,
  storyboardDialogsBindings,
  mountWorkspace,
  unmountWorkspace,
} = useFilmCreateWorkspaceBootstrap({
  ...createFilmCreateWorkspaceBindingSources({
    store, props, scriptWorkbenchMode, storyInput,
    storyStyle, storyType, storyEpisodeCount, scriptTitle,
    scriptContent, showSelectScriptDialog, selectPreviewEpisodeId, isStoryGenRunning,
    dramaId, hasAnyEpisode, scriptGenerating, currentEpisodeId,
    scriptDraftStatus, scriptDraftStatusLabel,
    selectScriptLoading, selectScriptImporting, selectableScriptDramas, selectScriptDramas,
    saveProjectSettings, showNovelImport, router, onGenerateStory,
    onAddEpisode, onGenerateScript, openSelectScriptDialog, loadSelectScriptList,
    onPickScriptFromDialog, returnToScriptCreation, resourcePanelCollapsed, charactersBlockCollapsed,
    propsBlockCollapsed, scenesBlockCollapsed, propUseQuadGrid, sceneUseQuadGrid,
    characters, scenes, characterGenerationDisabledReason, projectActionDisabledReason,
    propsExtractionDisabledReason, scenesExtractionDisabledReason, storyboardMediaActionReason, charactersGenerating,
    propsExtracting, scenesExtracting, generatingCharIds, generatingPropIds,
    generatingSceneIds, generatingPanoramaIds, uploadingResourceId, addingCharToLibraryId,
    addingCharToMaterialId, addingPropToLibraryId, addingPropToMaterialId, addingSceneToLibraryId,
    addingSceneToMaterialId, regenSbImagesForAsset, regenSbImagesProgress, sd2CertifyingId,
    sd2VoiceUploadingId, hasAssetImage, assetImageUrl, charRoleLabel,
    localPathToUrl, parseExtraImages, getCharAffectedStoryboards, getPropAffectedStoryboards,
    getSceneAffectedStoryboards, sd2ActionLabel, sd2VoiceActionLabel, onSelectEpisode,
    onGenerateCharacters, openAddCharacter, showCharLibrary, onExtractProps,
    showAddProp, showPropLibrary, onExtractScenes, openAddScene,
    showSceneLibrary, onGenerateCharacterImage, onGeneratePropImage, onGenerateSceneImage,
    onGenerateScenePanorama, editCharacter, editProp, editScene,
    onDeleteCharacter, onDeleteProp, onDeleteScene, onAddCharacterToLibrary,
    onAddCharacterToMaterialLibrary, onAddPropToLibrary, onAddPropToMaterialLibrary, onAddSceneToLibrary,
    onAddSceneToMaterialLibrary, onRegenAffectedSbImages, doUploadResourceImage, onSetPrimaryImage,
    onRemoveExtraImage, openImagePreview, scrollToStoryboard, onSd2PrimaryAction,
    onSd2VoicePrimaryAction, onSd2VoiceReplace, playSd2Voice, storyboardCount,
    videoDuration, gridMode, storyboardUseFirstLastFrame, storyboardUniversalOmni,
    storyboardIncludeNarration, lastFrameUseFirstLayoutLock, videoFrameContiguity, sbTruncatedDismissed,
    batchImageStopping, batchVideoStopping, dragOverSbId, storyboards,
    sbSceneId, sbNarration, sbUniversalSegmentText, batchImageErrors,
    batchVideoErrors, batchImageProgress, batchVideoProgress, generatingSbImageIds,
    generatingSbFirstImageIds, generatingSbLastImageIds, generatingUniversalSegmentIds, linkingTailFrameIds,
    usingPrevTailAsFirstIds, ttsSbIds, ttsSbNarrationIds, upscalingSbIds,
    universalOmniPolishProgress, storyboardGenerating, universalOmniPolishRunning, exportingStoryboardSheet,
    batchImageRunning, batchVideoRunning, sbTruncatedWarning, uploadingSbImageId,
    uploadingSbImageSlot, storyboardActionDisabledReason, episodeActionDisabledReason, batchActionDisabledReason,
    batchVideoActionDisabledReason, videoCapabilityReason, scriptEstimateStoryboardHint, scriptEstimateStoryboardTitle,
    scriptEstimateVideoDurationHint, scriptEstimateVideoDurationTitle, assetVideoUrl, canUsePrevTailAsFirst,
    charactersAvailableToAddToSb, getMovementLabel, getNextStoryboard, getSbCharacterIds,
    getSbFirstImage, getSbImage, getSbLastImage, getSbLocalImage,
    getSbPropIds, getSbSelectedCharacters, getSbSelectedProps, getSbSelectedScene,
    getSbFreeReferenceItems, getSbGridImages, getSbUniversalOmniRefSlots, getSbVideo,
    getSbVideoError, getSbVideoReferenceGrid, getStripItems, getVideoStripItems,
    hasSbDraftImagePlaceholder, hasSbFirstLastPair, hasSbImage, historyImageLabel,
    isSbUniversalMode, isSbVideoGenerating, onAddSingleStoryboard, onDeleteSingleStoryboard,
    onExportNarrationSrt, onExportStoryboardSheet, onGenerateSbFrameImage, onGenerateSbFramePair,
    onGenerateSbImage, onGenerateSbVideo, onGenerateStoryboard, onInsertStoryboardBefore,
    storyboardsAPI, storyboardReorderBusy, dropTargetStoryboardIndex, onMoveStoryboardUp,
    onMoveStoryboardDown, onReorderDragStart, onReorderDragOver, onReorderDragEnd,
    onReorderDrop, onLastFrameLayoutLockChange, onLinkTailFrameToNext, onOpenSbPromptDialog,
    onOpenVideoParamsDialog, onPromoteSbFreeReferenceImage, onRemoveSbFreeReferenceImage, onRemoveSbHistoryImage,
    onSaveSbNarrationField, onSaveUniversalSegmentField, onSbAddCharacterCommand, onSbImageDragLeave,
    onSbImageDragOver, onSbImageDrop, onSelectSbMainVideo, onSelectStripItem,
    onStoryboardSceneChange, onStoryboardUseFirstLastFrameChange, onStripItemClick, onToggleSbUniversalMode,
    onTtsSbDialogue, onTtsSbNarration, onUniversalSegmentPromptMenu, onUploadSbImageClick,
    onUpscaleSbImage, onUsePrevTailAsFirst, openAiConfig, openGlobalMediaPicker,
    playSbDialogueTts, playSbNarrationTts, sbCanSubmitVideo, sbDialogueAudioRelPath,
    sbMainVideoPlayerKey, sbNarrationAudioRelPath, sbUniversalSegmentTrimmed, sbVideoGenerationDisabledReason,
    setSbCharacterIds, setSbPropIds, showSbFramePromptPreview, startBatchImageGeneration,
    startBatchVideoGeneration, storyboardImageUrl, stripItemTitle, ttsGenerationDisabledReason,
    doUploadSbImage, showCharSd2Cert, showEditCharLibrary, showEditCharacter,
    showEditProp, showEditPropLibrary, showEditScene, showEditSceneLibrary,
    charLibraryKeyword, charLibraryPage, charLibraryPageSize, charLibraryTab,
    dramaAllCharKeyword, dramaAllCharPage, dramaAllCharPageSize, dramaAllPropKeyword,
    dramaAllPropPage, dramaAllPropPageSize, dramaAllSceneKeyword, dramaAllScenePage,
    dramaAllScenePageSize, propLibraryKeyword, propLibraryPage, propLibraryPageSize,
    propLibraryTab, sceneLibraryKeyword, sceneLibraryPage, sceneLibraryPageSize,
    sceneLibraryTab, addCharRefImage, addPropAddRefImage, addPropForm,
    addPropRefImage, addSceneRefImage, editCharLibraryForm, editPropLibraryForm,
    editSceneLibraryForm, addPropSaving, charLibraryList, charLibraryLoading,
    charLibraryTotal, charSd2CertPayload, dramaAllCharList, dramaAllCharLoading,
    dramaAllCharTotal, dramaAllPropList, dramaAllPropLoading, dramaAllPropTotal,
    dramaAllSceneList, dramaAllSceneLoading, dramaAllSceneTotal, editCharLibrarySaving,
    editCharacterForm, editCharacterPromptGenerating, editCharacterSaving, editPropForm,
    editPropLibrarySaving, editPropPromptGenerating, editPropSaving, editSceneForm,
    editSceneLibrarySaving, editScenePromptGenerating, editSceneSaving, extractingAnchors,
    extractingCharAppearance, extractingPropAddDesc, extractingPropDesc, extractingSceneDesc,
    propLibraryList, propLibraryLoading, propLibraryTotal, sceneLibraryList,
    sceneLibraryLoading, sceneLibraryTotal, clearCharRefImage, clearPropRefImage,
    clearSceneRefImage, debouncedLoadCharLibrary, debouncedLoadDramaAllCharList, debouncedLoadDramaAllPropList,
    debouncedLoadDramaAllSceneList, debouncedLoadPropLibrary, debouncedLoadSceneLibrary, doExtractCharFromImage,
    doExtractFromRef, doExtractFromRef2, doExtractPropFromImage, doExtractSceneFromImage,
    doGenerateCharacterPrompt, doGeneratePropPrompt, doGenerateScenePrompt, doGenerateSceneSinglePrompt,
    extractIdentityAnchors, isCharAddToEpisodeLoading, isPropAddToEpisodeLoading, isSceneAddToEpisodeLoading,
    loadCharLibraryList, loadDramaAllCharList, loadDramaAllPropList, loadDramaAllSceneList,
    loadPropLibraryList, loadSceneLibraryList, onAddCharFromLibrary, onAddDramaCharToEpisode,
    onAddDramaPropToEpisode, onAddDramaSceneToEpisode, onAddPropFromLibrary, onAddSceneFromLibrary,
    onCharLibraryDialogOpen, onCharLibraryTabChange, onCloseCharDialog, onClosePropDialog,
    onCloseSceneDialog, onDeleteCharLibrary, onDeletePropLibrary, onDeleteSceneLibrary,
    onPropLibraryDialogOpen, onPropLibraryTabChange, onRefImageDrop, onRefImageDrop2,
    onRefImageFileChange, onRefImageFileChange2, onSceneLibraryDialogOpen, onSceneLibraryTabChange,
    openEditCharLibrary, openEditPropLibrary, openEditSceneLibrary, returnToCharacterPanel,
    returnToPropPanel, returnToScenePanel, submitAddProp, submitEditCharLibrary,
    submitEditCharacter, submitEditProp, submitEditPropLibrary, submitEditScene,
    submitEditSceneLibrary, showSbPromptDialog, showFramePromptEditor, showVideoParamsDialog,
    editingFramePromptText, sbPromptImageText, sbPromptPolishedText, sbPromptVideoText,
    sbPromptTarget, editingFramePromptRegenerating, editingFramePromptSaving, editingFramePromptSb,
    editingFramePromptSlot, regeneratingLayoutSbIds, sbAction, sbAngleH,
    sbAngleS, sbAngleV, sbAtmosphere, sbCreationMode,
    sbDialogue, sbDof, sbDuration, sbLayoutDescription,
    sbLighting, sbLocation, sbMovement, sbPromptPolishing,
    sbPromptSaving, sbResult, sbShotType, sbTime,
    sbTitle, sbVideoReferenceImageId, splitByAudioLoading, videoParamsSaving,
    videoParamsTarget, angleToPromptFragment, canSplitSbByAudio, onPolishSbPrompt,
    onRegenerateLayoutDescription, onSaveSbPromptDialog, onSaveVideoParams, onSplitSbByAudio,
    onVideoParamsDialogClosed, regenerateEditingFramePrompt, saveEditingFramePrompt, setSbCreationModeId,
  }),
  route,
  handleBeforeUnload,
  applyRouteToStore,
  loadPipelineConcurrency,
  refreshVideoGenerationCapability,
  refreshProductionReadiness,
  invalidateProjectLoads,
  projectLifecycle,
  scriptDraftController,
})

onMounted(mountWorkspace)
onBeforeUnmount(unmountWorkspace)

</script>


<style scoped src="./FilmCreate.css"></style>

