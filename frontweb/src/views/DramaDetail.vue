<template>
  <div class="drama-detail">
    <DramaDetailHeader
      :page-title="dramaLoadState === 'error' ? '项目加载失败' : drama?.title || '剧集管理'"
      :is-dark="isDark"
      :is-drama-ready="isDramaReady"
      :current-episode-id="currentEpisodeId"
      @go-list="goList"
      @toggle-theme="toggleTheme"
      @go-create="goCreate"
      @go-canvas-mode="goCanvasMode"
    />

    <main class="main" :aria-busy="dramaLoadState === 'loading'">
      <DramaDetailLoadState
        v-if="dramaLoadState === 'loading' || dramaLoadState === 'error'"
        ref="dramaLoadFailureRef"
        :state="dramaLoadState"
        :error-text="dramaLoadError"
        :not-found="dramaLoadNotFound"
        :pending="loading"
        @retry="retryDramaLoad"
        @go-list="goList"
      />

      <template v-else-if="isDramaReady">
      <DramaDetailInfoCard
        :info-form="infoForm"
        :info-save-state="infoSaveState"
        :info-save-scheduled="infoSaveScheduled"
        :info-save-status-label="infoSaveStatusLabel"
        @save="saveInfo"
        @retry-save="retryInfoSave"
      />

      <DramaDetailReadinessSection
        :readiness-dependency-state="readinessDependencyState"
        :readiness-dependency-error="readinessDependencyError"
        :has-readiness-snapshot="hasReadinessSnapshot"
        :project-readiness="projectReadiness"
        @retry="retryReadinessDependencies"
        @action="handleReadinessAction"
      />

      <DramaDetailSourceWorkflow
        v-if="drama"
        :drama-id="dramaId"
        :drama="drama"
        :source-import-intent="sourceImportIntent"
        @refresh="handleSourceWorkflowRefresh"
        @enter-production="enterSourceWorkflowProduction"
        @focus-episode-list="scrollToSection('episode-list')"
      />

<DramaDetailEpisodeList ref="episodeBatchImportDialogRef" v-bind="episodeListBindings" />

      <DramaDetailResourceLibrary v-bind="resourceLibraryBindings" />
      </template>
    </main>

    <template v-if="isDramaReady">
    <DramaDetailResourceDialogs v-bind="resourceDialogsBindings" />

    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import DramaDetailHeader from '@/components/dramaDetail/DramaDetailHeader.vue'
import DramaDetailLoadState from '@/components/dramaDetail/DramaDetailLoadState.vue'
import DramaDetailInfoCard from '@/components/dramaDetail/DramaDetailInfoCard.vue'
import DramaDetailEpisodeList from '@/components/dramaDetail/DramaDetailEpisodeList.vue'
import DramaDetailResourceLibrary from '@/components/dramaDetail/DramaDetailResourceLibrary.vue'
import DramaDetailResourceDialogs from '@/components/dramaDetail/DramaDetailResourceDialogs.vue'
import { createDramaDetailPageBindings } from '@/components/dramaDetail/dramaDetailPageBindings.js'
import { createDramaDetailLoadAndNav } from '@/components/dramaDetail/dramaDetailLoadAndNav.js'
import { createDramaDetailEpisodeActions, toDramaDetailEpisodeSavePayload } from '@/components/dramaDetail/dramaDetailEpisodeActions.js'
import { createDramaDetailInfoAutosave } from '@/components/dramaDetail/dramaDetailInfoAutosave.js'
import { createDramaDetailResourceLists } from '@/components/dramaDetail/dramaDetailResourceLists.js'
import { createDramaDetailResourceImport } from '@/components/dramaDetail/dramaDetailResourceImport.js'
import { createDramaDetailResourceTabs } from '@/components/dramaDetail/dramaDetailResourceTabs.js'
import { createDramaDetailResourceEditorState, DRAMA_DETAIL_RESOURCE_EDITOR_MESSAGE_BOX_KEYBOARD } from '@/components/dramaDetail/dramaDetailResourceEditorState.js'
import { createDramaDetailResourceEditorLeave } from '@/components/dramaDetail/dramaDetailResourceEditorLeave.js'
import { createDramaDetailProductionEditors } from '@/components/dramaDetail/dramaDetailProductionEditors.js'
import { assetImageUrl, createDramaDetailLibraryImages } from '@/components/dramaDetail/dramaDetailResourceImages.js'
import { dramaDetailUserError, characterRoleLabel, propTypeLabel } from '@/components/dramaDetail/dramaDetailResourceEdit.js'
import { createDramaDetailGuardedApis } from '@/components/dramaDetail/dramaDetailGuardedApis.js'
import DramaDetailReadinessSection from '@/components/dramaDetail/DramaDetailReadinessSection.vue'
import DramaDetailSourceWorkflow from '@/components/dramaDetail/DramaDetailSourceWorkflow.vue'
import { useTheme } from '@/composables/useTheme'
import { dramaAPI as rawDramaAPI } from '@/api/drama'
import { aiAPI as rawAiAPI } from '@/api/ai'
import { sourceIntakeAPI as rawSourceIntakeAPI } from '@/api/sourceIntake'
import { characterLibraryAPI as rawCharacterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI as rawSceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI as rawPropLibraryAPI } from '@/api/propLibrary'
import { uploadAPI as rawUploadAPI } from '@/api/upload'
import { imagesAPI as rawImagesAPI } from '@/api/images'
import { taskAPI as rawTaskAPI } from '@/api/task'
import { characterAPI as rawCharacterAPI } from '@/api/characters'
import { sceneAPI as rawSceneAPI } from '@/api/scenes'
import { propAPI as rawPropAPI } from '@/api/props'
import { buildProjectReadiness } from '@/utils/projectReadiness'
import { normalizeProjectListReturnTo, projectRouteInstanceKey, resolveProjectEpisodeId } from '@/utils/projectListRoute'
import { createProjectInstanceLifecycle } from '@/utils/projectInstanceLifecycle.js'

const projectLifecycle = createProjectInstanceLifecycle()
const {
  ElMessage,
  dramaAPI,
  aiAPI,
  sourceIntakeAPI,
  characterLibraryAPI,
  sceneLibraryAPI,
  propLibraryAPI,
  uploadAPI,
  imagesAPI,
  taskAPI,
  characterAPI,
  sceneAPI,
  propAPI,
} = createDramaDetailGuardedApis(projectLifecycle, {
  ElMessage: RawElMessage,
  dramaAPI: rawDramaAPI,
  aiAPI: rawAiAPI,
  sourceIntakeAPI: rawSourceIntakeAPI,
  characterLibraryAPI: rawCharacterLibraryAPI,
  sceneLibraryAPI: rawSceneLibraryAPI,
  propLibraryAPI: rawPropLibraryAPI,
  uploadAPI: rawUploadAPI,
  imagesAPI: rawImagesAPI,
  taskAPI: rawTaskAPI,
  characterAPI: rawCharacterAPI,
  sceneAPI: rawSceneAPI,
  propAPI: rawPropAPI,
})

const route = useRoute()
const { isDark, toggle: toggleTheme } = useTheme()
const router = useRouter()
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.query.returnTo))
const sourceImportIntent = computed(() => route.query.intake === 'source-url')
const dramaId = Number(route.params.id)
const episodeBatchImportDialogRef = ref(null)
const dramaLoadFailureRef = ref(null)

const loading = ref(false)
const drama = ref(null)
const episodes = ref([])
const currentEpisodeId = computed(() => resolveProjectEpisodeId(episodes.value, route.query.episode))
const aiConfigs = ref(null)
const sourceCount = ref(null)
const dramaLoadState = ref('loading')
const dramaLoadError = ref('')
const dramaLoadNotFound = ref(false)
const readinessDependencyState = ref('idle')
const readinessDependencyError = ref('')
const hasReadinessSnapshot = ref(false)
const isDramaReady = computed(() => dramaLoadState.value === 'ready' && Boolean(drama.value))

const editorState = createDramaDetailResourceEditorState()
const {
  editDramaCharVisible, editDramaCharForm, editDramaCharSaving, editDramaCharBaseline,
  editDramaSceneVisible, editDramaSceneForm, editDramaSceneSaving, editDramaSceneBaseline,
  editDramaPropVisible, editDramaPropForm, editDramaPropSaving, editDramaPropBaseline,
  editCharVisible, editCharForm, editCharSaving, editCharBaseline,
  editSceneVisible, editSceneForm, editSceneSaving, editSceneBaseline,
  editPropVisible, editPropForm, editPropSaving, editPropBaseline,
  editors,
} = editorState

const {
  captureResourceEditorBaseline,
  hasUnsavedResourceEdits,
  confirmResourceEditLeave,
  requestResourceEditorClose,
} = createDramaDetailResourceEditorLeave({
  editors,
  ElMessage,
  ElMessageBox,
  messageBoxKeyboard: DRAMA_DETAIL_RESOURCE_EDITOR_MESSAGE_BOX_KEYBOARD,
})

const {
  infoForm,
  infoSaveState,
  infoSaveError,
  infoSaveScheduled,
  infoSavedFingerprint,
  infoDraftFingerprint,
  hasUnsavedInfoChanges,
  infoSaveStatusLabel,
  syncInfoFormFromDrama,
  clearInfoSaveTimer,
  scheduleInfoSave,
  flushInfoSave,
  retryInfoSave,
  confirmBatchImportLeave,
  confirmInfoLeave,
  handleInfoBeforeUnload,
  saveInfo,
} = createDramaDetailInfoAutosave({
  dramaId,
  drama,
  isDramaReady,
  dramaAPI,
  ElMessage,
  ElMessageBox,
  episodeBatchImportDialogRef,
  confirmResourceEditLeave,
  hasUnsavedResourceEdits,
  dramaDetailUserError,
})

const {
  charList, charLoading, charError, charPage, charPageSize, charTotal, charKw,
  loadCharList, onCharKwInput, openEditChar, saveChar, deleteChar,
  sceneList, sceneLoading, sceneError, scenePage, scenePageSize, sceneTotal, sceneKw,
  loadSceneList, onSceneKwInput, openEditScene, saveScene, deleteScene,
  propList, propLoading, propError, propPage, propPageSize, propTotal, propKw,
  loadPropList, onPropKwInput, openEditProp, saveProp, deleteProp,
} = createDramaDetailResourceLists({
  dramaId,
  characterLibraryAPI,
  sceneLibraryAPI,
  propLibraryAPI,
  ElMessage,
  ElMessageBox,
  captureResourceEditorBaseline,
  editCharForm,
  editCharVisible,
  editCharSaving,
  editSceneForm,
  editSceneVisible,
  editSceneSaving,
  editPropForm,
  editPropVisible,
  editPropSaving,
  dramaDetailUserError,
})

const {
  importVisible, importType, importList, importLoading, importError,
  importPage, importPageSize, importTotal, importKw, importingId,
  openImport, loadImportList, onImportKwInput, doImport,
} = createDramaDetailResourceImport({
  dramaId,
  characterLibraryAPI,
  sceneLibraryAPI,
  propLibraryAPI,
  loadCharList,
  loadSceneList,
  loadPropList,
  ElMessage,
  dramaDetailUserError,
})

const {
  activeResTab, previewUrl, openPreview, onResourceTabKeydown,
} = createDramaDetailResourceTabs({
  loadCharList,
  loadSceneList,
  loadPropList,
})

const { doUploadLibImg, doGenerateLibImg } = createDramaDetailLibraryImages({
  dramaId,
  uploadAPI,
  imagesAPI,
  taskAPI,
  ElMessage,
  toUserError: dramaDetailUserError,
})

function clarifySourceWorkflowAction(action) {
  if (!action || action.target !== 'source-workflow') return action
  return {
    ...action,
    label: '前往素材处理',
    title: '前往素材处理',
    description: '定位到故事素材流程后，可在该区域导入素材或启动处理。',
  }
}

function isNavigableReadinessAction(action) {
  return ['source-workflow', 'episode-list', 'project-resources'].includes(action?.target)
}

function sameReadinessDestination(left, right) {
  if (!left || !right) return false
  return left.target === right.target && (left.serviceType || '') === (right.serviceType || '')
}

function resolveEpisodeEmptyState(episodeEmpty) {
  const primaryAction = clarifySourceWorkflowAction(episodeEmpty?.primaryAction)
  const unblockAction = clarifySourceWorkflowAction(episodeEmpty?.unblockAction)
  return {
    ...episodeEmpty,
    primaryAction,
    primaryDisabledReason: isNavigableReadinessAction(primaryAction) ? '' : (episodeEmpty?.primaryDisabledReason || ''),
    unblockAction: sameReadinessDestination(primaryAction, unblockAction) ? null : unblockAction,
    note: episodeEmpty?.primaryDisabledReason || '',
  }
}

const projectReadiness = computed(() => {
  if (!drama.value || !hasReadinessSnapshot.value || !Array.isArray(aiConfigs.value) || typeof sourceCount.value !== 'number') {
    return null
  }
  const readiness = buildProjectReadiness({
    drama: drama.value,
    sourceCount: sourceCount.value,
    aiConfigs: aiConfigs.value,
  })
  return {
    ...readiness,
    nextAction: clarifySourceWorkflowAction(readiness.nextAction),
    episodeEmptyState: resolveEpisodeEmptyState(readiness.episodeEmptyState),
  }
})
const episodeEmptyState = computed(() => {
  if (projectReadiness.value) return projectReadiness.value.episodeEmptyState
  const pending = readinessDependencyState.value === 'loading' || readinessDependencyState.value === 'refreshing'
  return {
    title: '暂时无法判断项目就绪状态',
    description: readinessDependencyError.value || '正在加载 AI 配置与素材状态。',
    primaryAction: {
      id: 'retry_readiness_dependencies',
      label: pending ? '正在检查...' : '重试就绪检查',
      target: 'readiness-dependencies',
    },
    primaryDisabledReason: pending ? '正在检查项目就绪依赖' : '',
    unblockAction: null,
    note: '',
  }
})
const nextEpisodeNumber = computed(() => (
  episodes.value.length > 0
    ? Math.max(...episodes.value.map((e) => Number(e.episode_number) || 0), 0) + 1
    : 1
))

const {
  loadDrama,
  retryDramaLoad,
  loadReadinessDependencies,
  retryReadinessDependencies,
  handleSourceWorkflowRefresh,
  handleReadinessAction,
  scrollToSection,
  scrollToSourceIntake,
  goList,
  withProjectListReturnTo,
  goCreate,
  goCanvasMode,
  goEpisode,
} = createDramaDetailLoadAndNav({
  dramaId,
  drama,
  episodes,
  loading,
  dramaLoadState,
  dramaLoadError,
  dramaLoadNotFound,
  dramaLoadFailureRef,
  isDramaReady,
  readinessDependencyState,
  readinessDependencyError,
  hasReadinessSnapshot,
  aiConfigs,
  sourceCount,
  projectLifecycle,
  aiAPI,
  sourceIntakeAPI,
  ElMessage,
  router,
  route,
  projectListReturnTo,
  currentEpisodeId,
  syncInfoFormFromDrama,
  clearInfoSaveTimer,
  infoSaveScheduled,
  infoSaveError,
  infoSaveState,
  loadCharList,
})

const {
  addingEpisode,
  deletingEpisodeId,
  openEpisodeBatchImport,
  onBatchImportEpisodes,
  onDeleteEpisode,
} = createDramaDetailEpisodeActions({
  dramaId,
  episodes,
  dramaAPI,
  ElMessage,
  ElMessageBox,
  loadDrama,
  episodeBatchImportDialogRef,
  dramaDetailUserError,
})

async function onAddEpisode() {
  addingEpisode.value = true
  try {
    const list = episodes.value
    const nextNum = list.length > 0
      ? Math.max(...list.map((e) => Number(e.episode_number) || 0), 0) + 1
      : 1
    const updated = list.map((ep, i) => ({
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
      script_content: ep.script_content || '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0
    }))
    updated.push({ episode_number: nextNum, title: '第' + nextNum + '集', script_content: '', description: null, duration: 0 })
    await projectLifecycle.execute(() => dramaAPI.saveEpisodes(dramaId, updated))
    ElMessage.success('已添加第' + nextNum + '集')
    await projectLifecycle.execute(() => loadDrama())
  } catch (e) {
    ElMessage.error(dramaDetailUserError(e, '添加失败'))
  } finally {
    addingEpisode.value = false
  }
}

function handleReadinessActionOrAdd(action) {
  if (action?.target === 'add-episode' || action?.id === 'create_blank_episode') {
    return onAddEpisode()
  }
  return handleReadinessAction(action)
}

function epStatusLabel(status) {
  const map = { draft: '草稿', processing: '生成中', generating: '生成中', completed: '剧本已就绪', failed: '失败', published: '已发布' }
  const key = String(status || '').trim()
  if (!key) return ''
  if (map[key]) return map[key]
  return /[\u4e00-\u9fff]/.test(key) ? key : '未知状态'
}

function goCreateOrAddEpisode() {
  if (currentEpisodeId.value) {
    importVisible.value = false
    goCreate()
    return
  }
  importVisible.value = false
  return onAddEpisode()
}

async function enterSourceWorkflowProduction() {
  if (!currentEpisodeId.value) {
    await loadDrama()
  }
  if (!currentEpisodeId.value) {
    ElMessage.warning('请先新增一集，再进入制作')
    scrollToSection('episode-list')
    return
  }
  goEpisode(currentEpisodeId.value)
}


const {
  openEditDramaChar, saveDramaChar, uploadDramaCharImg, generateDramaCharImg,
  openEditDramaScene, saveDramaScene, uploadDramaSceneImg, generateDramaSceneImg,
  openEditDramaProp, saveDramaProp, uploadDramaPropImg, generateDramaPropImg,
} = createDramaDetailProductionEditors({
  dramaId,
  loadDrama,
  captureResourceEditorBaseline,
  editDramaCharVisible,
  editDramaCharForm,
  editDramaCharSaving,
  editDramaSceneVisible,
  editDramaSceneForm,
  editDramaSceneSaving,
  editDramaPropVisible,
  editDramaPropForm,
  editDramaPropSaving,
  characterAPI,
  sceneAPI,
  propAPI,
  uploadAPI,
  taskAPI,
  ElMessage,
  toUserError: dramaDetailUserError,
})

let handledRouteAnchor = ''
watch(
  () => [route.path, route.hash, Boolean(drama.value), sourceImportIntent.value],
  async ([, , ready]) => {
    const id = String(route.hash || '').replace(/^#/, '')
    if (!ready || !['source-intake-workflow', 'episode-list', 'project-resources'].includes(id)) return
    const key = `${route.path}#${id}:${sourceImportIntent.value ? 'source-url' : ''}`
    if (handledRouteAnchor === key) return
    handledRouteAnchor = key
    await nextTick()
    window.setTimeout(() => scrollToSection(id, { focus: !(id === 'source-intake-workflow' && sourceImportIntent.value) }), 0)
  },
  { immediate: true },
)

onBeforeRouteLeave(() => confirmInfoLeave())
onBeforeRouteUpdate((to, from) => {
  if (projectRouteInstanceKey(to) === projectRouteInstanceKey(from)) return true
  return confirmInfoLeave()
})

let dramaDetailUnmounted = false

onMounted(async () => {
  await retryDramaLoad()
  if (dramaDetailUnmounted) return
  window.addEventListener('beforeunload', handleInfoBeforeUnload)
  if (isDramaReady.value && route.query.importBatch) {
    setTimeout(() => {
      if (dramaDetailUnmounted) return
      episodeBatchImportDialogRef.value?.openDialog?.()
    }, 0)
  }
})

onBeforeUnmount(() => {
  dramaDetailUnmounted = true
  projectLifecycle.dispose()
  clearInfoSaveTimer()
  window.removeEventListener('beforeunload', handleInfoBeforeUnload)
})

const {
  episodeListBindings,
  resourceLibraryBindings,
  resourceDialogsBindings,
} = createDramaDetailPageBindings({
  addingEpisode,
  deletingEpisodeId,
  dramaId,
  episodeEmptyState,
  episodes,
  epStatusLabel,
  handleReadinessAction: handleReadinessActionOrAdd,
  nextEpisodeNumber,
  onAddEpisode,
  onBatchImportEpisodes,
  onDeleteEpisode,
  openEpisodeBatchImport,
  withProjectListReturnTo,
  activeResTab,
  assetImageUrl,
  characterRoleLabel,
  charError,
  charKw,
  charList,
  charLoading,
  charPage,
  charPageSize,
  charTotal,
  currentEpisodeId,
  deleteChar,
  deleteProp,
  deleteScene,
  drama,
  goCreateOrAddEpisode,
  loadCharList,
  loadPropList,
  loadSceneList,
  onCharKwInput,
  onPropKwInput,
  onResourceTabKeydown,
  onSceneKwInput,
  openEditChar,
  openEditDramaChar,
  openEditDramaProp,
  openEditDramaScene,
  openEditProp,
  openEditScene,
  openImport,
  openPreview,
  propError,
  propKw,
  propList,
  propLoading,
  propPage,
  propPageSize,
  propTotal,
  propTypeLabel,
  sceneError,
  sceneKw,
  sceneList,
  sceneLoading,
  scenePage,
  scenePageSize,
  sceneTotal,
  editCharForm,
  editCharSaving,
  editCharVisible,
  editDramaCharForm,
  editDramaCharSaving,
  editDramaCharVisible,
  editDramaPropForm,
  editDramaPropSaving,
  editDramaPropVisible,
  editDramaSceneForm,
  editDramaSceneSaving,
  editDramaSceneVisible,
  editPropForm,
  editPropSaving,
  editPropVisible,
  editSceneForm,
  editSceneSaving,
  editSceneVisible,
  importError,
  importKw,
  importList,
  importLoading,
  importPage,
  importPageSize,
  importTotal,
  importType,
  importVisible,
  importingId,
  characterLibraryAPI,
  doGenerateLibImg,
  doImport,
  doUploadLibImg,
  generateDramaCharImg,
  generateDramaPropImg,
  generateDramaSceneImg,
  loadImportList,
  onImportKwInput,
  previewUrl,
  propLibraryAPI,
  requestResourceEditorClose,
  saveChar,
  saveDramaChar,
  saveDramaProp,
  saveDramaScene,
  saveProp,
  saveScene,
  sceneLibraryAPI,
  uploadDramaCharImg,
  uploadDramaPropImg,
  uploadDramaSceneImg,
})
</script>


<style scoped>
.drama-detail {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.12) 0%, transparent 60%);
  color: #e4e4e7;
}
html.light .drama-detail {
  background: #f5f3ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(139, 92, 246, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
}
.main { max-width: min(1200px, 96vw); margin: 0 auto; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 20px; }
.section.card {
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  transition: box-shadow 0.3s, border-color 0.3s;
}
.section.card:hover {
  border-color: rgba(139, 92, 246, 0.25);
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.08);
}
html.light .section.card {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .section.card:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 6px 28px rgba(139, 92, 246, 0.1);
}
.section-title { font-size: 1rem; font-weight: 600; color: #fafafa; margin-bottom: 16px; }
html.light .section-title { color: #18181b; }
html.light .dependency-status {
  background: rgba(239, 246, 255, 0.88);
  border-color: rgba(59, 130, 246, 0.22);
  color: #1d4ed8;
}
html.light .dependency-status--error {
  background: #fef2f2;
  border-color: rgba(239, 68, 68, 0.22);
  color: #b91c1c;
}
.section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.section-header .section-title { margin-bottom: 0; }
.dependency-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.6);
  color: #bfdbfe;
  font-size: 12px;
  line-height: 1.5;
}
.dependency-status--error {
  border-color: rgba(248, 113, 113, 0.32);
  background: rgba(127, 29, 29, 0.16);
  color: #fecaca;
}
.empty-tip { color: #71717a; text-align: center; padding: 32px; }
#episode-list,
#project-resources {
  scroll-margin-top: 120px;
}

@media (max-width: 760px) {
  .drama-detail {
    overflow-x: hidden;
  }
  .main {
    max-width: 100%;
    padding: 16px 12px 40px;
  }
  .section.card {
    padding: 16px;
  }
  .section-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
