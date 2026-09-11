<template>
  <div class="film-create" :class="filmCreateRootClass">
    <!-- 顶部 -->
    <FilmCreateHeader
      ref="filmCreateHeaderRef"
      v-bind="headerBindings"
    />

    <!-- 左侧固定侧边栏 -->
    <FilmCreateQuickNav
      v-if="projectLoadState === 'ready'"
      v-bind="quickNavBindings"
    />

    <FilmCreateProjectLoadState
      v-if="projectLoadState !== 'ready'"
      ref="projectLoadFailureRef"
      v-bind="projectLoadStateBindings"
    />

    <main v-else class="main">
      <FilmCreateProjectDependencyWarning
        v-bind="projectDependencyWarningBindings"
      />

      <FilmCreatePipelinePanel
        ref="pipelinePanelRef"
        v-bind="pipelinePanelBindings"
      />

      <!-- 剧本工作台：单卡片 + 选项卡（创作 / 选择） -->
      <FilmCreateScriptWorkbench
        class="section card script-workbench-unified"
        v-bind="scriptWorkbenchBindings"
      />

      <!-- 资源管理：角色 / 道具 / 场景 -->
      <FilmCreateResourcePanel
        class="section card resource-panel"
        v-bind="resourcePanelBindings"
      />
      <!-- 分镜生成 -->
      <FilmCreateStoryboardPanel
        class="section card"
        id="anchor-storyboard"
        v-bind="storyboardPanelBindings"
      />
      <FilmCreateOutputSection
        v-bind="outputSectionBindings"
      />
    </main>

    <FilmCreateWorkspaceDialogs
      v-if="projectLoadState === 'ready'"
      ref="aiConfigContentRef"
      v-bind="workspaceDialogsLayerBindings"
    />
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { useTheme } from '@/composables/useTheme'
import { useFilmStore } from '@/stores/film'
import { useGenerationTaskStore } from '@/stores/generationTaskStore'
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
import { storyboardImageUrl } from '@/utils/mediaUrl'
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
import { createFilmCreateCloseoutBindings } from '@/components/filmCreate/filmCreateCloseoutBindings.js'
import {
  createFilmCreateSurfaceBindings,
} from '@/components/filmCreate/filmCreateSurfaceBindings.js'
import {
  createFilmCreateShellBindings,
} from '@/components/filmCreate/filmCreateShellBindings.js'
import {
  useFilmCreateGeneratingDisplay,
  useFilmCreateReadinessDisplay,
  useFilmCreateRootClass,
  useFilmCreateRouteDisplay,
  useFilmCreateStoreDisplay,
} from '@/composables/filmCreate/useFilmCreatePageDisplay'
import {
  generationStyleOptions,
} from '@/constants/styleOptions'
import { useNavigation } from '@/composables/filmCreate/useNavigation'
import { useCharacters } from '@/composables/filmCreate/useCharacters'
import { useProps as usePropsComposable } from '@/composables/filmCreate/useProps'
import { useScenes } from '@/composables/filmCreate/useScenes'
import { useFilmCreateStoryboardMedia } from '@/composables/filmCreate/useFilmCreateStoryboardMedia'
import { useFilmCreateStoryboardPrep } from '@/composables/filmCreate/useFilmCreateStoryboardPrep'
import { useFilmCreateScriptActions } from '@/composables/filmCreate/useFilmCreateScriptActions'
import { useFilmCreateStoryboardActions } from '@/composables/filmCreate/useFilmCreateStoryboardActions'
import { useFilmCreatePipelineActions } from '@/composables/filmCreate/useFilmCreatePipelineActions'
import { useFilmCreatePipelineRun } from '@/composables/filmCreate/useFilmCreatePipelineRun'
import { useFilmCreateResourceUpload } from '@/composables/filmCreate/useFilmCreateResourceUpload'
import { useFilmCreateScriptNovelState } from '@/composables/filmCreate/useFilmCreateScriptNovelState'
import { useFilmCreateNavigationGuards } from '@/composables/filmCreate/useFilmCreateNavigationGuards'
import { useFilmCreateProjectLoad } from '@/composables/filmCreate/useFilmCreateProjectLoad'
import { useFilmCreateProductionReadiness } from '@/composables/filmCreate/useFilmCreateProductionReadiness'
import { useFilmCreateRouteSync } from '@/composables/filmCreate/useFilmCreateRouteSync'
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
import { useFilmCreateRefImageDrop } from '@/composables/filmCreate/useFilmCreateRefImageDrop'
import { useFilmCreateStylePrompts } from '@/composables/filmCreate/useFilmCreateStylePrompts'
import { useFilmCreateWorkspaceNav } from '@/composables/filmCreate/useFilmCreateWorkspaceNav'
import { useFilmCreateAiConfigWorkspace } from '@/composables/filmCreate/useFilmCreateAiConfigWorkspace'
import { useFilmCreateDeliveryActions } from '@/composables/filmCreate/useFilmCreateDeliveryActions'
import { useFilmCreateTaskCancel } from '@/composables/filmCreate/useFilmCreateTaskCancel'
import { useFilmCreateActiveTasks } from '@/composables/filmCreate/useFilmCreateActiveTasks'
import { useFilmCreateNavSteps } from '@/composables/filmCreate/useFilmCreateNavSteps'
import { useFilmCreateActionDisabledReasons } from '@/composables/filmCreate/useFilmCreateActionDisabledReasons'
import { trackFilmCreateAction } from '@/utils/filmCreateActionLog'
import { useFilmCreateScriptDraft } from '@/composables/filmCreate/useFilmCreateScriptDraft'
import { useFilmCreateResourceGenerate } from '@/composables/filmCreate/useFilmCreateResourceGenerate'
import { useFilmCreateTtsDisableReason } from '@/composables/filmCreate/useFilmCreateTtsDisableReason'
import { createProjectInstanceLifecycle } from '@/utils/projectInstanceLifecycle.js'
import { createFilmCreateGuardedApis } from '@/components/filmCreate/filmCreateGuardedApis.js'

const projectLifecycle = createProjectInstanceLifecycle()
const {
  ElMessage,
  dramaAPI,
  timelinesAPI,
  generationAPI,
  characterAPI,
  propAPI,
  sceneAPI,
  taskAPI,
  imagesAPI,
  videosAPI,
  storyboardsAPI,
  uploadAPI,
  characterLibraryAPI,
  sceneLibraryAPI,
  propLibraryAPI,
} = createFilmCreateGuardedApis(projectLifecycle, {
  ElMessage: RawElMessage,
  dramaAPI: rawDramaAPI,
  timelinesAPI: rawTimelinesAPI,
  generationAPI: rawGenerationAPI,
  characterAPI: rawCharacterAPI,
  propAPI: rawPropAPI,
  sceneAPI: rawSceneAPI,
  taskAPI: rawTaskAPI,
  imagesAPI: rawImagesAPI,
  videosAPI: rawVideosAPI,
  storyboardsAPI: rawStoryboardsAPI,
  uploadAPI: rawUploadAPI,
  characterLibraryAPI: rawCharacterLibraryAPI,
  sceneLibraryAPI: rawSceneLibraryAPI,
  propLibraryAPI: rawPropLibraryAPI,
})

const route = useRoute()
const router = useRouter()
const { projectListReturnTo } = useFilmCreateRouteDisplay({ route })
const store = useFilmStore()
const genStore = useGenerationTaskStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { videoResolution: storeVideoResolution } = storeToRefs(store)
const storeDisplay = useFilmCreateStoreDisplay({ store, storeVideoResolution })
const {
  scriptContent,
  videoResolution,
  dramaId,
  characters,
  scenes,
  props,
  storyboards,
  currentEpisode,
  currentEpisodeId,
  hasAnyEpisode,
  videoProgress,
  videoStatus,
} = storeDisplay
const generatingDisplay = useFilmCreateGeneratingDisplay({
  genStore,
  dramaId,
  currentEpisodeId,
})
const { storyboardGenerating } = generatingDisplay
const initialRouteProjectId = route.params.id && route.params.id !== 'new' ? Number(route.params.id) : null
const projectLoadSurface = useFilmCreateProjectLoadSurface({ initialRouteProjectId, store })
const {
  projectLoadState,
  projectLoadError,
  projectLoadNotFound,
  projectLoadPending,
  projectLoadFailureRef,
  projectDependencyWarning,
  projectDependencyLoading,
  projectPageTitle,
} = projectLoadSurface

// ── Composable: Navigation ─────────────────────────────
const navigation = useNavigation({
  getAnchorIds: () => navSteps.value.map((step) => step.anchor),
})
const { navCollapsed, storyboardMenuExpanded, activeNavAnchor, toggleNav, scrollToAnchor } = navigation
const { filmCreateRootClass } = useFilmCreateRootClass({ navCollapsed, projectLoadState })


const aiConfigDialogState = useFilmCreateAiConfigDialogState()
const {
  showAiConfigDialog,
  aiConfigContentRef,
  pipelinePanelRef,
  aiConfigInitialServiceType,
  aiConfigChanged,
  aiConfigOpenedFromPipelineAction,
} = aiConfigDialogState
const {
  videoCapabilityConfigs,
  videoCapabilityLoading,
  videoCapabilityFailed,
  authoritativeProductionReadiness,
  productionReadinessLoading,
  productionReadinessFailed,
} = useFilmCreateProductionCapabilityState()

const aiConfigWorkspace = useFilmCreateAiConfigWorkspace({
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
  openAiConfig,
  openAiConfigFromPipeline,
  onAiConfigurationChanged,
  confirmAiConfigWorkspaceClose,
  requestAiConfigWorkspaceClose,
} = aiConfigWorkspace

const scriptNovelState = useFilmCreateScriptNovelState({ store, genStore })
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
} = scriptNovelState

const deliverySettings = useFilmCreateDeliverySettings()
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
} = deliverySettings

const {
  getSelectedStylePrompt,
  getSelectedStylePromptZh,
  projectStylePromptMetadata,
  getSelectedStyle,
} = useFilmCreateStylePrompts({
  generationStyle,
})


const productionReadiness = useFilmCreateProductionReadiness({
  dramaId,
  productionReadinessLoading,
  productionReadinessFailed,
  authoritativeProductionReadiness,
  videoCapabilityLoading,
  videoCapabilityFailed,
  videoCapabilityConfigs,
})
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
} = productionReadiness
const readinessDisplay = useFilmCreateReadinessDisplay({
  productionCapabilityGaps,
})
const { productionReadinessServiceType } = readinessDisplay

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

const mediaPreview = useFilmCreateMediaPreview({
  ElMessage,
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
} = mediaPreview
const mediaPickerState = useFilmCreateMediaPickerState()
const {
  showGlobalMediaPicker,
  globalMediaPickerMode,
  globalMediaPickerTarget,
} = mediaPickerState

const workspaceNav = useFilmCreateWorkspaceNav({
  router,
  route,
  dramaId,
  selectedEpisodeId,
  projectListReturnTo,
  showGlobalMediaPicker,
})
const {
  filmCreateHeaderRef,
  goList,
  goCanvasMode,
  openMediaLibraryFromPicker,
  onSelectEpisode,
} = workspaceNav
const mediaPickerCopy = useFilmCreateMediaPickerCopy({
  globalMediaPickerMode,
  globalMediaPickerTarget,
  currentEpisode,
  store,
})
const {
  globalMediaPickerAccept,
  globalMediaPickerTitle,
  globalMediaPickerContext,
} = mediaPickerCopy

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

const deliveryActions = useFilmCreateDeliveryActions({
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
} = deliveryActions

/** 分镜批量生成结束后，按镜序逐个润色全能片段（仅勾选全能模式且各镜为 universal 且有正文时） */
const omniPolishState = useFilmCreateOmniPolishState()
const {
  universalOmniPolishRunning,
  universalOmniPolishAbort,
  universalOmniPolishProgress,
  sbTruncatedWarning,
  sbTruncatedDismissed,
  videoErrorMsg,
} = omniPolishState
// 一键全流程流水线
const pipelineRun = useFilmCreatePipelineRun({
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
} = pipelineRun

// ── Composable: Characters ────────────────────────────
const charactersApi = useCharacters({
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
} = charactersApi

// ── Composable: Props ──────────────────────────────────
const propsApi = usePropsComposable({
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
} = propsApi

// ── Composable: Scenes ─────────────────────────────────
const scenesApi = useScenes({
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
} = scenesApi

const resourceGenerate = useFilmCreateResourceGenerate({
  store,
  trackFilmCreateAction,
  onGenerateCharactersRaw,
  onExtractPropsRaw,
  onExtractScenesRaw,
})
const {
  onGenerateCharacters,
  onExtractProps,
  onExtractScenes,
} = resourceGenerate


const resourcePanelState = useFilmCreateResourcePanelState()
const {
  resourcePanelCollapsed,
  charactersBlockCollapsed,
  propsBlockCollapsed,
  scenesBlockCollapsed,
  sceneUseQuadGrid,
  propUseQuadGrid,
} = resourcePanelState

// 分镜行内编辑状态（按 storyboard id 存储）
const storyboardFields = useFilmCreateStoryboardFields()
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
} = storyboardFields
const inFlightMediaSets = useFilmCreateInFlightMediaSets()
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
} = inFlightMediaSets
const storyboardMedia = useFilmCreateStoryboardMedia({
  dramaId,
  currentEpisodeId,
  getStoryboards: () => store.storyboards || [],
  imagesAPI,
  videosAPI,
  onSelectionsRestored: () => restoreSelectionsFromBackend(),
  loadDrama: (...args) => loadDrama(...args),
})
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
} = storyboardMedia
const taskRecovery = useFilmCreateTaskRecovery({
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
  getGeneratingSetsBag,
  buildSbGenMeta,
  isSbVideoGenerating,
  recoverAndSyncEpisodeTasks,
} = taskRecovery
const batchMediaState = useFilmCreateBatchMediaState()
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
} = batchMediaState
const taskCancel = useFilmCreateTaskCancel({
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
  cancelActiveTask,
} = taskCancel

const activeTasks = useFilmCreateActiveTasks({
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
  allActiveTaskItems,
  allActiveTaskLabels,
} = activeTasks

const ttsDisableReason = useFilmCreateTtsDisableReason({
  ttsSbIds,
  ttsSbNarrationIds,
  ttsCapabilityReason,
})
const {
  ttsGenerationDisabledReason,
} = ttsDisableReason
/** 分镜 TTS 试听：避免多条同时播放 */
/** 正在编辑视频提示词的分镜 id；编辑中显示文本框与保存/取消 */
const promptDialogState = useFilmCreatePromptDialogState()
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
} = promptDialogState
const uploadDragState = useFilmCreateUploadDragState()
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
} = uploadDragState

const refImageDrop = useFilmCreateRefImageDrop({
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
} = refImageDrop
// 公共库弹窗状态已移至各 composable
const storyboardGenerateSettings = useFilmCreateStoryboardGenerateSettings()
const {
  storyboardCount,
  videoDuration,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  storyboardUseFirstLastFrame,
  exportingStoryboardSheet,
  lastFrameUseFirstLayoutLock,
  gridMode,
} = storyboardGenerateSettings

const storyboardAccessors = useFilmCreateStoryboardAccessors({
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
} = storyboardAccessors

const navStepsState = useFilmCreateNavSteps({
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
  navSteps,
} = navStepsState

const actionDisabledReasons = useFilmCreateActionDisabledReasons({
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
} = actionDisabledReasons

const storyboardPrep = useFilmCreateStoryboardPrep({
  store, storyboardsAPI, ElMessage, upscalingSbIds,
  refreshStoryboardMediaForCurrentContext, sbNarration, sbCreationMode, sbUniversalSegmentText,
  sbDuration, videoClipDuration, getSbFirstFrameUrl, storyboardMediaActionReason,
  isSbVideoGenerating, videoCapabilityReason, scriptContent, storyboardCount,
  videoDuration, storyboardUseFirstLastFrame, gridMode, dramaId,
  imagesAPI, genStore, pollTask, captureStoryboardMediaRefresh,
  restoreSelectionsFromBackend, getSelectedStyle, getSelectedStylePrompt, getSelectedStylePromptZh,
  frameTypeForSlot, getSbFirstImage, buildSbGenMeta, assertStoryboardMediaReady,
  projectAspectRatio, lastFrameUseFirstLayoutLock, sbLocation, sbTime,
  sbShotType, sbAngleH, sbAngleV, sbAngleS,
  sbResult, sbAction, sbAtmosphere, sbCharacterIds,
  sbSelectedImgId, sbSelectedLastImgId, generatingSbImageIds, generatingSbFirstImageIds,
  generatingSbLastImageIds, showFramePromptEditor, editingFramePromptSb, editingFramePromptSlot,
  editingFramePromptText, editingFramePromptSaving, editingFramePromptRegenerating, uploadAPI,
  sbImageUploadForId, sbImageUploadSlotById, uploadingSbImageId, onSelectSbFrameImage,
  sbPropIds, sbSceneId, sbDialogue, sbTitle,
  sbAngle, sbMovement, sbLighting, sbDof,
  sbLayoutDescription, sbVideoReferenceImageId,
  saveProjectSettings: (...args) => saveProjectSettings(...args),
  loadDrama: (...args) => loadDrama(...args),
  angleToPromptFragment: (...args) => angleToPromptFragment(...args),
})
const {
  captureVideoLastFrame, onUpscaleSbImage, onSaveSbNarrationField, isSbUniversalMode,
  setSbCreationModeId, onToggleSbUniversalMode, onSaveUniversalSegmentField, universalSegmentDurationSecForSb,
  getSbVideoDurationForApi, getMainImageUrlForVideo, sbUniversalSegmentTrimmed, sbCanSubmitVideo,
  sbVideoGenerationDisabledReason, buildSbVideoPromptForApi, clipSecondsForStoryboardEstimate, shotCountEstimateFromDurationSec,
  scriptStoryboardEstimate, scriptEstimateVideoDurationHint, scriptEstimateVideoDurationTitle, scriptEstimateStoryboardHint,
  scriptEstimateStoryboardTitle, scriptTextTrimmedForEstimate, userFilledStoryboardCount, userFilledVideoDuration,
  getVideoDurationForApi, getStoryboardCountForApi, onStoryboardUseFirstLastFrameChange, buildFirstFrameImagePrompt,
  buildLastFrameImagePrompt, getCachedFramePromptFromDb, ensureProfessionalFramePrompt, openFramePromptEditor,
  showSbFramePromptPreview, saveEditingFramePrompt, regenerateEditingFramePrompt, onGenerateSbFrameImage,
  onGenerateSbFramePair, onGenerateSbImage, onUploadSbImageClick, doUploadSbImage,
  onSbImageFileChange, syncStoryboardStateFromEpisode,
} = storyboardPrep

const projectLoad = useFilmCreateProjectLoad({
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
  onEpisodeSelect,
  applySelectedEpisode,
  friendlyFilmProjectLoadError,
  refreshProjectDependencies,
  retryProjectDependencies,
  loadDrama,
  retryFilmProjectLoad,
  invalidateProjectLoads,
} = projectLoad

const scriptActions = useFilmCreateScriptActions({
  store, dramaAPI, router, route,
  scriptTitle, storyType, generationStyle, storyStyle,
  storyInput, projectAspectRatio, videoClipDuration, storyboardIncludeNarration,
  storyboardUniversalOmni, storyboardUseFirstLastFrame, lastFrameUseFirstLayoutLock, projectStylePromptMetadata,
  loadDrama, savedCurrentEpisodeNumber, selectedEpisodeId, onEpisodeSelect,
  storyGenerating, scriptGenerating, pollTask, trackFilmCreateAction,
  storyEpisodeCount, scrollToAnchor, flushScriptDraft, markScriptDraftSaved,
  scriptContent, selectPreviewEpisodeId, showSelectScriptDialog, scriptWorkbenchMode,
  showCharLibrary, showPropLibrary, showSceneLibrary, resourcePanelCollapsed,
  charactersBlockCollapsed, propsBlockCollapsed, scenesBlockCollapsed, selectScriptLoading,
  selectScriptDramas, selectScriptImporting, novelText, novelFileName,
  novelFileContent, novelImportMode, novelImporting, novelMaxChapters,
  novelAiSummarize, showNovelImport,
})
const {
  saveScriptToBackend, saveProjectSettings, onGenerateStory, openSelectScriptDialog,
  returnToScriptCreation, returnToCharacterPanel, returnToPropPanel, returnToScenePanel,
  loadSelectScriptList, onPickScriptFromDialog, novelImportReset, onNovelFileChange,
  onImportNovel, onGenerateScript, onAddEpisode,
} = scriptActions

const resourceUpload = useFilmCreateResourceUpload({
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
  onUploadResourceClick,
  parseExtraImages,
  localPathToUrl,
  findResource,
  doUploadResourceImage,
  onSetPrimaryImage,
  onRemoveExtraImage,
  onResourceImageFileChange,
} = resourceUpload


const storyboardActions = useFilmCreateStoryboardActions({
  storyboards, characters, props, scenes,
  storyboardsAPI, sbCharacterIds, sbPropIds, sbSceneId,
  saveProjectSettings, dramaId, imagesAPI, taskAPI,
  assertStoryboardMediaReady, captureStoryboardMediaRefresh, storyboardUseFirstLastFrame, isSbUniversalMode,
  ensureProfessionalFramePrompt, getSelectedStyle, projectAspectRatio, regenSbImagesForAsset,
  regenSbImagesProgress, sbSelectedImgId, ttsSbIds, ttsSbNarrationIds,
  sbDialogueAudioPaths, sbNarrationAudioPaths, sbNarration, ttsGenerationDisabledReason,
  projectLifecycle, store, currentEpisodeId, exportingStoryboardSheet,
  getSbFirstImage, getSbLastImage, buildFirstFrameImagePrompt, buildLastFrameImagePrompt,
  sbTitle, sbLocation, sbTime, sbDuration,
  sbDialogue, sbAction, sbResult, sbAtmosphere,
  sbShotType, sbMovement, sbLayoutDescription, sbUniversalSegmentText,
  generatingUniversalSegmentIds, sbUniversalSegmentTrimmed, universalSegmentDurationSecForSb, storyboardUniversalOmni,
  universalOmniPolishRunning, universalOmniPolishAbort, universalOmniPolishProgress, pipelineRest,
  onSaveUniversalSegmentField, videoParamsTarget, toAbsoluteImageUrl, assetImageUrl,
  savingSbReferenceImages, globalMediaPickerMode, globalMediaPickerTarget, showGlobalMediaPicker,
  getMainImageUrlForVideo, sbVideoFirstLastUrls, loadDrama, editingSbImagePromptId,
  editingSbImagePromptText, sbPromptTarget, sbPromptImageText, sbPromptPolishedText,
  sbPromptVideoText, showSbPromptDialog, sbPromptPolishing, sbPromptSaving,
  editingSbVideoPromptId, editingSbVideoPromptText, sbAngle, sbAngleH,
  sbAngleV, sbAngleS, sbLighting, sbDof,
  sbCreationMode, sbVideoReferenceImageId, regeneratingLayoutSbIds, inferringParams,
  showVideoParamsDialog, videoParamsSaving, splitByAudioLoading, videosAPI,
  genStore, pollTask, sbVideoGenerationDisabledReason, getSbVideoReferenceGrid,
  getActiveVideoAiConfig, canUseUniversalOmniVideoApi, confirmUniversalNonSeedance2Video, getSbFirstFrameUrl,
  generatingSbVideoIds, buildSbGenMeta, sbVideoErrors, buildSbVideoPromptForApi,
  videoResolution, getSbVideoDurationForApi, sbSelectedVideoId, userFacingVideoGenerationError,
  getNextStoryboard, getPrevStoryboard, getSbVideo, linkingTailFrameIds,
  usingPrevTailAsFirstIds, refreshStoryboardMediaForCurrentContext, onSelectSbFrameImage, dramaAPI,
  captureDramaRefresh, getStoryboardCountForApi, getVideoDurationForApi, storyboardIncludeNarration,
  sbTruncatedWarning, sbTruncatedDismissed, trackFilmCreateAction, pipelineRunning,
  pipelineConcurrency, pipelineVideoConcurrency, storyboardMediaActionReason, batchImageRunning,
  batchImageStopping, batchImageErrors, batchImageProgress, batchVideoRunning,
  batchVideoStopping, batchVideoErrors, batchVideoProgress, sbImages,
  sbVideos, gridMode, videoFrameContiguity, loadStoryboardMedia,
  hasSbImage, uploadAPI, restoreSelectionsFromBackend, sbCanSubmitVideo,
  recordHasPlayableVideoUrl, captureVideoLastFrame, refreshVideoGenerationCapability,
})
const {
  getSbCharacterIds, getMovementLabel, setSbCharacterIds, charactersAvailableToAddToSb,
  onSbAddCharacterCommand, getSbPropIds, setSbPropIds, onStoryboardPropChange,
  getSbSelectedScene, getSbSelectedCharacters, getSbSelectedProps, onStoryboardCharacterChange,
  onLastFrameLayoutLockChange, onStoryboardSceneChange, dedupeStoryboardsForAssetLink, getCharAffectedStoryboards,
  getSceneAffectedStoryboards, getPropAffectedStoryboards, scrollToStoryboard, onRegenAffectedSbImages,
  normalizeAudioRelPath, sbDialogueAudioRelPath, sbNarrationAudioRelPath, playSbTtsFromRel,
  playSbDialogueTts, playSbNarrationTts, onTtsSbDialogue, onTtsSbNarration,
  formatSrtTimestamp, onExportStoryboardSheet, onExportNarrationSrt, buildUniversalSegmentFieldOverrides,
  universalSegmentAtImageToGrokTags, onUniversalSegmentToGrokVideoTags, onUniversalSegmentPromptMenu, onGenerateUniversalSegmentPrompt,
  onPolishUniversalSegmentPromptStream, polishUniversalSegmentsAfterGeneration, currentStoryboardReferenceState, findStoryboardRow,
  mergeStoryboardIntoStore, getSbFreeReferenceItems, getSbPrimaryFreeReferenceItem, collectSbFreeReferenceAbsoluteUrls,
  uniqueStoryboardReferenceUrls, saveStoryboardReferenceImages, openGlobalMediaPicker, onGlobalMediaAssetSelected,
  onRemoveSbFreeReferenceImage, onPromoteSbFreeReferenceImage, currentDramaReferenceEntities, getSbUniversalOmniRefSlots,
  collectSbOmniReferenceAbsoluteUrls, collectSbSceneOnlyReferenceAbsoluteUrls, getSbPrimaryReferenceAbsoluteUrl, buildStoryboardVideoReferencePayload,
  onEditSbImagePrompt, onOpenSbPromptDialog, formatVideoPromptForEdit, onPolishSbPrompt,
  onSaveSbPromptDialog, onSaveSbImagePrompt, onEditSbVideoPrompt, angleToPromptFragment,
  onSaveSbVideoFields, onSaveSbVideoPrompt, onOpenVideoParamsDialog, onVideoParamsDialogClosed,
  countDialogueLinesInSb, canSplitSbByAudio, onSplitSbByAudio, onSaveVideoParams,
  onBatchInferParams, onRegenerateLayoutDescription, onGenerateSbVideo, onLinkTailFrameToNext,
  onUsePrevTailAsFirst, refreshStoryboardsForEpisode, refreshStoryboardsOnly, onGenerateStoryboard,
  onAddSingleStoryboard, onDeleteSingleStoryboard, onInsertStoryboardBefore, onInsertStoryboardAfter, storyboardReorderBusy,
  dropTargetStoryboardIndex, onMoveStoryboardUp, onMoveStoryboardDown, onReorderDragStart,
  onReorderDragOver, onReorderDragEnd, onReorderDrop, startBatchImageGeneration,
  startBatchVideoGeneration,
} = storyboardActions

const pipelineActions = useFilmCreatePipelineActions({
  store, dramaId, currentEpisodeId, dramaAPI,
  genStore, captureDramaRefresh, loadDrama, composeActionDisabledReason,
  currentEpisodeVideoUrl, videoErrorMsg, videoSubtitle, videoBurnDialogue,
  videoWatermark, videoWatermarkText, storyInput, scriptLanguage,
  generationAPI, propAPI, characterAPI, sceneAPI,
  imagesAPI, videosAPI, loadStoryboardMedia, refreshStoryboardsOnly,
  getStoryboardCountForApi, getVideoDurationForApi, projectAspectRatio, storyboardIncludeNarration,
  sbTruncatedWarning, sbTruncatedDismissed,
  storyboardUniversalOmni, polishUniversalSegmentsAfterGeneration, hasAssetImage, hasSbImage,
  generatingCharIds, generatingSceneIds, generatingPropIds, generatingSbImageIds,
  generatingSbVideoIds, getSelectedStyle, captureStoryboardMediaRefresh, refreshStoryboardMediaForCurrentContext,
  pollUntilResourceHasImage, sceneUseQuadGrid, storyboardUseFirstLastFrame, isSbUniversalMode,
  ensureProfessionalFramePrompt, assertStoryboardMediaReady, sbVideos, recordHasPlayableVideoUrl,
  sbCanSubmitVideo, collectSbOmniReferenceAbsoluteUrls, getSbFirstFrameUrl, buildStoryboardVideoReferencePayload,
  buildSbVideoPromptForApi, getSbVideoDurationForApi, videoResolution, buildSbGenMeta,
  refreshProductionReadiness, trackFilmCreateAction, pipelineStarting, pipelineRunning,
  pipelineStopping, activePipelineRunPromise, pipelineAbortRequested, pipelineErrorLog,
  pipelineCurrentStep, pipelineStepIndex, pipelineActiveTasks, pipelineOwnedTaskIds,
  pipelineStepTotal, pipelineConcurrency, pipelineVideoConcurrency, executeOwnedPipelineRun,
  confirmProductionPipelineCost, checkPause, pollTaskWithPause, addPipelineError,
  pipelineRest, runPipelineCountdown, pipelineWithRetry, runConcurrently,
  setPipelineStep, storyboardMediaActionReason,
  pollTask,
})
const {
  getFinalizeMergeOptions, onGenerateVideo, startOneClickPipeline, startTextFrameworkPipeline,
  runOneClickPipeline, startRepairPipeline, runRepairPipeline,
} = pipelineActions

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
  generatingCharIds,
  generatingSceneIds,
  generatingPropIds,
  generatingPanoramaIds,
  getRunningGenerationTasks: () => genStore.getAllRunningTasks(),
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
  ...storeDisplay,
  ...scriptNovelState,
  ...deliverySettings,
  ...deliveryActions,
  ...omniPolishState,
  ...pipelineRun,
  ...actionDisabledReasons,
  ...productionReadiness,
  ...readinessDisplay,
  ...aiConfigWorkspace,
  ...scriptActions,
  ...pipelineActions,
  ...projectLoad,
  ...workspaceNav,
  ...projectLoadSurface,
  store, router, isDark, toggleTheme,
  generationStyleOptions,
})

const {
  scriptWorkbenchBindings,
  resourcePanelBindings,
  storyboardPanelBindings,
  resourceDialogsBindings,
  storyboardDialogsBindings,
  mountWorkspace,
  unmountWorkspace,
} = createFilmCreateCloseoutBindings({
  // 分镜/资源字段从已有 composable 返回值 spread，避免重复罗列
  ...resourcePanelState,
  ...charactersApi,
  ...propsApi,
  ...scenesApi,
  ...resourceGenerate,
  ...resourceUpload,
  ...omniPolishState,
  ...storyboardFields,
  ...inFlightMediaSets,
  ...storyboardMedia,
  ...batchMediaState,
  ...promptDialogState,
  ...uploadDragState,
  ...refImageDrop,
  ...storyboardGenerateSettings,
  ...storyboardAccessors,
  ...actionDisabledReasons,
  ...storyboardPrep,
  ...storyboardActions,
  ...mediaPreview,
  ...storeDisplay,
  ...scriptNovelState,
  ...scriptActions,
  ...productionReadiness,
  ...aiConfigWorkspace,
  ...workspaceNav,
  ...generatingDisplay,
  ...taskRecovery,
  ...ttsDisableReason,
  ...pipelineRun,
  ...projectLoad,
  store, router, route,
  storyboardsAPI, storyboardImageUrl,
  onInsertStoryboardAfter, onGenerateStory,
  handleBeforeUnload, applyRouteToStore,
  projectLifecycle, scriptDraftController,
})

const {
  quickNavBindings,
  projectLoadStateBindings,
  projectDependencyWarningBindings,
  workspaceDialogsLayerBindings,
} = createFilmCreateShellBindings({
  ...navigation,
  ...navStepsState,
  ...projectLoadSurface,
  ...projectLoad,
  ...activeTasks,
  ...scriptNovelState,
  ...scriptActions,
  ...aiConfigDialogState,
  ...aiConfigWorkspace,
  ...mediaPreview,
  ...mediaPickerState,
  ...mediaPickerCopy,
  ...storyboardMedia,
  ...pipelineRun,
  ...storeDisplay,
  ...workspaceNav,
  ...taskCancel,
  resourceDialogsBindings, storyboardDialogsBindings,
  onGlobalMediaAssetSelected,
})

onMounted(mountWorkspace)
onBeforeUnmount(unmountWorkspace)

</script>


<style scoped src="./FilmCreate.css"></style>

