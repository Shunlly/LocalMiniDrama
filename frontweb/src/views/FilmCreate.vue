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
import { useFilmCreateEpisodeAssets } from '@/composables/filmCreate/useFilmCreateEpisodeAssets'
import { useFilmCreateStoryboardMediaAccess } from '@/composables/filmCreate/useFilmCreateStoryboardMediaAccess'
import { useFilmCreateStoryboardPrep } from '@/composables/filmCreate/useFilmCreateStoryboardPrep'
import { useFilmCreateScriptActions } from '@/composables/filmCreate/useFilmCreateScriptActions'
import { useFilmCreateStoryboardActions } from '@/composables/filmCreate/useFilmCreateStoryboardActions'
import { useFilmCreatePipelineActions } from '@/composables/filmCreate/useFilmCreatePipelineActions'
import { useFilmCreateProductionRuntime } from '@/composables/filmCreate/useFilmCreateProductionRuntime'
import { useFilmCreateResourceActions } from '@/composables/filmCreate/useFilmCreateResourceActions'
import { useFilmCreateScriptNovelState } from '@/composables/filmCreate/useFilmCreateScriptNovelState'
import { useFilmCreateNavigationGuards } from '@/composables/filmCreate/useFilmCreateNavigationGuards'
import { useFilmCreateProjectSession } from '@/composables/filmCreate/useFilmCreateProjectSession'
import { useFilmCreateProductionReadiness } from '@/composables/filmCreate/useFilmCreateProductionReadiness'
import { useFilmCreateRouteSync } from '@/composables/filmCreate/useFilmCreateRouteSync'
import { useFilmCreateMediaPreview } from '@/composables/filmCreate/useFilmCreateMediaPreview'
import { useFilmCreateTaskRecovery } from '@/composables/filmCreate/useFilmCreateTaskRecovery'
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
  aiConfigWorkspaceOpen: showAiConfigDialog,
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

const pipelineRun = useFilmCreateProductionRuntime({
  genStore,
  dramaId,
  currentEpisodeId,
  store,
  ElMessage,
  loadDrama: (...args) => loadDrama(...args),
  videoClipDuration,
  taskAPI,
  trackFilmCreateAction,
  getStoryboardCountForApi: () => getStoryboardCountForApi(),
  get storyboardMediaActionReason() {
    return storyboardMediaActionReason
  },
})
const {
  pollUntilResourceHasImage,
  pollTask,
  pipelineRunning,
  pipelineStarting,
  pipelineStopping,
  pipelinePaused,
  pipelineAbortRequested,
  pipelineErrorLog,
  lastPipelineMode,
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

const mediaPreview = useFilmCreateMediaPreview({
  ElMessage,
})
const {
  assetImageUrl, hasAssetImage, assetVideoUrl, recordHasPlayableVideoUrl, toAbsoluteImageUrl,
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
  filmCreateHeaderRef, onSelectEpisode,
} = workspaceNav
const mediaPickerCopy = useFilmCreateMediaPickerCopy({
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

// ── Composable: Characters ────────────────────────────
const { charactersApi, propsApi, scenesApi } = useFilmCreateEpisodeAssets({
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
  propAPI,
  propLibraryAPI,
  sceneAPI,
  sceneLibraryAPI,
  scriptLanguage,
})

const {
  showEditCharacter, editCharacterForm, doGenerateCharacterPrompt,
  extractingCharAppearance, addCharRefImage, charactersGenerating, generatingCharIds,
  showCharLibrary, onGenerateCharacters: onGenerateCharactersRaw,
} = charactersApi

const {
  editPropForm, extractingPropDesc, addPropRefImage, addPropAddRefImage,
  propsExtracting, generatingPropIds, showPropLibrary, onExtractProps: onExtractPropsRaw,
} = propsApi

const {
  editSceneForm, extractingSceneDesc, addSceneRefImage,
  scenesExtracting, generatingSceneIds, generatingPanoramaIds, showSceneLibrary,
  onExtractScenes: onExtractScenesRaw,
} = scenesApi

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
const storyboardMedia = useFilmCreateStoryboardMediaAccess({
  dramaId,
  currentEpisodeId,
  getStoryboards: () => store.storyboards || [],
  imagesAPI,
  videosAPI,
  loadDrama: (...args) => loadDrama(...args),
  store,
  sbVideoErrors,
  storyboardUseFirstLastFrame,
  isSbUniversalMode: (...args) => isSbUniversalMode(...args),
  storyboardsAPI,
  ElMessage,
  ElMessageBox,
  assetImageUrl,
  assetVideoUrl,
  recordHasPlayableVideoUrl,
  toAbsoluteImageUrl,
  userFacingVideoGenerationError,
  sbVideoReferenceImageId,
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
  sbSelectedImgId, sbSelectedLastImgId, sbSelectedVideoId, sbImageUploadSlotById,
  frameTypeForSlot, getSbFirstImage, getSbLastImage, hasSbImage, hasSbDraftImagePlaceholder,
  getSbAllVideos, getSbVideo, getNextStoryboard, getPrevStoryboard,
  restoreSelectionsFromBackend, onSelectSbFrameImage, getSbVideoReferenceGrid,
  getSbFirstFrameUrl, sbVideoFirstLastUrls,
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
// 公共库弹窗状态已移至各 composable
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
  captureVideoLastFrame, isSbUniversalMode, onSaveUniversalSegmentField, universalSegmentDurationSecForSb,
  getSbVideoDurationForApi, getMainImageUrlForVideo, sbUniversalSegmentTrimmed, sbCanSubmitVideo,
  sbVideoGenerationDisabledReason, buildSbVideoPromptForApi, getVideoDurationForApi, getStoryboardCountForApi,
  buildFirstFrameImagePrompt, buildLastFrameImagePrompt, ensureProfessionalFramePrompt, doUploadSbImage,
  syncStoryboardStateFromEpisode,
} = storyboardPrep

const projectLoad = useFilmCreateProjectSession({
  store,
  dramaId,
  currentEpisodeId,
  projectLifecycle,
  flushDraft: flushScriptDraft,
  resolveEpisode: (episodeId) => (store.drama?.episodes || []).find((episode) => (
    Number(episode.id) === Number(episodeId)
  )) || null,
  onBusyChange: (busy) => {
    episodeSwitching.value = busy
  },
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
  saveProjectSettings, onGenerateStory, onAddEpisode,
  returnToPropPanel, returnToScenePanel,
} = scriptActions

const resourceActions = useFilmCreateResourceActions({
  store,
  trackFilmCreateAction,
  onGenerateCharactersRaw,
  onExtractPropsRaw,
  onExtractScenesRaw,
  dramaId,
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
  onGenerateCharacters,
  onExtractProps,
  onExtractScenes,
  doUploadResourceImage,
} = resourceActions


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
  polishUniversalSegmentsAfterGeneration, onGlobalMediaAssetSelected, collectSbOmniReferenceAbsoluteUrls,
  buildStoryboardVideoReferencePayload, angleToPromptFragment, refreshStoryboardsOnly, onInsertStoryboardAfter,
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
  setPipelineStep, storyboardMediaActionReason, productionCapabilityGaps, lastPipelineMode,
  openAiConfigFromPipeline: (...args) => aiConfigWorkspace.openAiConfigFromPipeline(...args),
  pollTask,
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
  confirmResourceEditorLeave: async () => (await aiConfigContentRef.value?.confirmResourceEditorLeave?.()) !== false,
  hasUnsavedResourceEditors: () => Boolean(aiConfigContentRef.value?.hasUnsavedResourceEditors?.()),
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
  scrollToAnchor,
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
  ...resourceActions,
  ...omniPolishState,
  ...storyboardFields,
  ...inFlightMediaSets,
  ...storyboardMedia,
  ...batchMediaState,
  ...promptDialogState,
  ...uploadDragState,
  ...refImageDrop,
  ...storyboardGenerateSettings,
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
  store, router, route, storyInput,
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
  dramaId,
  onGoToDrama: () => { if (dramaId.value) router.push('/drama/' + dramaId.value) },
})

onMounted(mountWorkspace)
onBeforeUnmount(unmountWorkspace)

</script>


<style scoped src="./FilmCreate.css"></style>

