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

      <div
        v-if="readinessDependencyState === 'loading' && !hasReadinessSnapshot"
        class="dependency-status"
        role="status"
        aria-live="polite"
      >
        <span>正在检查 AI 配置与故事素材状态...</span>
      </div>
      <div
        v-else-if="readinessDependencyState === 'error'"
        class="dependency-status dependency-status--error"
        role="alert"
        aria-live="assertive"
      >
        <span>
          {{ readinessDependencyError }}
          <template v-if="hasReadinessSnapshot">当前显示的是上次成功加载的就绪状态。</template>
        </span>
        <el-button size="small" type="primary" plain @click="retryReadinessDependencies">
          重试
        </el-button>
      </div>
      <ProjectReadinessPanel
        v-if="projectReadiness"
        :readiness="projectReadiness"
        @action="handleReadinessAction"
      />

      <SourceIntakeWorkflowPanel
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

    <ImagePreviewDialog
      :model-value="Boolean(previewUrl)"
      :src="previewUrl || ''"
      title="资源图片预览"
      @update:model-value="(visible) => { if (!visible) previewUrl = null }"
    />
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import DramaDetailHeader from '@/components/dramaDetail/DramaDetailHeader.vue'
import DramaDetailLoadState from '@/components/dramaDetail/DramaDetailLoadState.vue'
import DramaDetailInfoCard from '@/components/dramaDetail/DramaDetailInfoCard.vue'
import DramaDetailEpisodeList from '@/components/dramaDetail/DramaDetailEpisodeList.vue'
import DramaDetailResourceLibrary from '@/components/dramaDetail/DramaDetailResourceLibrary.vue'
import DramaDetailResourceDialogs from '@/components/dramaDetail/DramaDetailResourceDialogs.vue'
import { createDramaDetailResourceDialogBindings } from '@/components/dramaDetail/dramaDetailResourceDialogBindings.js'
import { createDramaDetailResourceLibraryBindings } from '@/components/dramaDetail/dramaDetailResourceLibraryBindings.js'
import ProjectReadinessPanel from '@/components/ProjectReadinessPanel.vue'
import SourceIntakeWorkflowPanel from '@/components/SourceIntakeWorkflowPanel.vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
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
import { stylePromptMetadataForSave, backfillDramaStylePromptMetadataIfNeeded } from '@/constants/styleOptions'
import { buildProjectReadiness } from '@/utils/projectReadiness'
import { normalizeProjectListReturnTo, projectRouteInstanceKey, resolveProjectEpisodeId } from '@/utils/projectListRoute'
import { scrollAndFocusSection } from '@/utils/sectionFocus.js'
import { createProjectInstanceLifecycle } from '@/utils/projectInstanceLifecycle.js'
import { requestCoreJson as requestCoreDrama } from '@/utils/coreJsonRequest'
import { toUserFacingError } from '@/utils/userFacingError'

const RESOURCE_TABS = ['lib-char', 'lib-scene', 'lib-prop', 'drama-char', 'drama-scene', 'drama-prop']
const MESSAGE_BOX_KEYBOARD = {
  closeOnClickModal: false,
  closeOnPressEscape: true,
  distinguishCancelAndClose: true,
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

/** 把剧集详情操作的异常转成可展示的简体中文 */
function dramaDetailUserError(error, fallback = '操作失败，请稍后重试', serviceLabel = '项目服务') {
  return toUserFacingError(error, fallback, { serviceLabel })
}

function characterRoleLabel(role) {
  const map = { main: '主角', supporting: '配角', extra: '群演', minor: '次要' }
  const key = String(role || '').trim()
  if (!key) return ''
  if (map[key]) return map[key]
  return hasChinese(key) ? key : '其他'
}

function propTypeLabel(type) {
  const map = { key: '关键道具', background: '背景物件', handheld: '手持道具', costume: '服饰' }
  const key = String(type || '').trim()
  if (!key) return ''
  if (map[key]) return map[key]
  return hasChinese(key) ? key : key
}

function onResourceTabKeydown(event) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = Math.max(0, RESOURCE_TABS.indexOf(activeResTab.value))
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % RESOURCE_TABS.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + RESOURCE_TABS.length) % RESOURCE_TABS.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = RESOURCE_TABS.length - 1
  activeResTab.value = RESOURCE_TABS[next]
  nextTick(() => {
    document.getElementById(`drama-res-tab-${RESOURCE_TABS[next]}`)?.focus()
  })
}

const projectLifecycle = createProjectInstanceLifecycle()
const ElMessage = projectLifecycle.guardNotifier(RawElMessage)
const dramaAPI = projectLifecycle.guardApi(rawDramaAPI)
const aiAPI = projectLifecycle.guardApi(rawAiAPI)
const sourceIntakeAPI = projectLifecycle.guardApi(rawSourceIntakeAPI)
const characterLibraryAPI = projectLifecycle.guardApi(rawCharacterLibraryAPI)
const sceneLibraryAPI = projectLifecycle.guardApi(rawSceneLibraryAPI)
const propLibraryAPI = projectLifecycle.guardApi(rawPropLibraryAPI)
const uploadAPI = projectLifecycle.guardApi(rawUploadAPI)
const imagesAPI = projectLifecycle.guardApi(rawImagesAPI)
const taskAPI = projectLifecycle.guardApi(rawTaskAPI)
const characterAPI = projectLifecycle.guardApi(rawCharacterAPI)
const sceneAPI = projectLifecycle.guardApi(rawSceneAPI)
const propAPI = projectLifecycle.guardApi(rawPropAPI)

const route = useRoute()
const { isDark, toggle: toggleTheme } = useTheme()
const router = useRouter()
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.query.returnTo))
const sourceImportIntent = computed(() => route.query.intake === 'source-url')
const dramaId = Number(route.params.id)

// 制作资源编辑
const editDramaCharVisible = ref(false)
const editDramaCharForm    = ref(null)
const editDramaCharSaving  = ref(false)
const editDramaCharBaseline = ref('')

const editDramaSceneVisible = ref(false)
const editDramaSceneForm    = ref(null)
const editDramaSceneSaving  = ref(false)
const editDramaSceneBaseline = ref('')

const editDramaPropVisible = ref(false)
const editDramaPropForm    = ref(null)
const editDramaPropSaving  = ref(false)
const editDramaPropBaseline = ref('')
const episodeBatchImportDialogRef = ref(null)

// 共享：上传图片到库条目
async function doUploadLibImg(event, form, api, reloadFn) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await api.update(form.id, { image_url: url, local_path: null })
    reloadFn()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '上传失败')) }
  finally { form.imgUploading = false }
}

// 共享：AI 生成图片到库条目
async function doGenerateLibImg(form, prompt, api, reloadFn) {
  if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
  form.imgGenerating = true
  try {
    const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: dramaId || null })
    const imgData = res?.data ?? res
    const taskId = imgData?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    const result = task.result
    const imageUrl = result?.image_url
    const localPath = result?.local_path ?? null
    if (!imageUrl && !localPath) throw new Error('未获取到图片地址')
    form.image_url = imageUrl || ''
    form.local_path = localPath
    await api.update(form.id, { image_url: imageUrl || null, local_path: localPath })
    reloadFn()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '生成失败')) }
  finally { form.imgGenerating = false }
}

// ── 制作资源编辑函数 ────────────────────────────────────────────────────────

function openEditDramaChar(item) {
  editDramaCharForm.value = {
    id: item.id, name: item.name ?? '', role: item.role ?? 'minor',
    description: item.description ?? '', personality: item.personality ?? '',
    appearance: item.appearance ?? '',
    image_url: item.image_url ?? '', local_path: item.local_path ?? null,
    imgUploading: false, imgGenerating: false
  }
  captureResourceEditorBaseline('dramaChar')
  editDramaCharVisible.value = true
}
async function saveDramaChar() {
  if (!editDramaCharForm.value?.id) return
  editDramaCharSaving.value = true
  try {
    await characterAPI.update(editDramaCharForm.value.id, {
      name: editDramaCharForm.value.name,
      role: editDramaCharForm.value.role || null,
      description: editDramaCharForm.value.description || null,
      personality: editDramaCharForm.value.personality || null,
      appearance: editDramaCharForm.value.appearance || null,
    })
    ElMessage.success('已保存')
    editDramaCharVisible.value = false
    loadDrama()
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) }
  finally { editDramaCharSaving.value = false }
}
async function uploadDramaCharImg(event) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  const form = editDramaCharForm.value
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await characterAPI.putImage(form.id, { image_url: url, local_path: null })
    loadDrama()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '上传失败')) }
  finally { form.imgUploading = false }
}
async function generateDramaCharImg() {
  const form = editDramaCharForm.value
  if (!form?.id) return
  form.imgGenerating = true
  try {
    const res = await characterAPI.generateImage(form.id, null, null)
    const data = res?.data ?? res
    const taskId = data?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    loadDrama()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '生成失败')) }
  finally { form.imgGenerating = false }
}

function openEditDramaScene(item) {
  editDramaSceneForm.value = {
    id: item.id, location: item.location ?? '', time: item.time ?? '',
    description: item.description ?? '', prompt: item.prompt ?? '',
    image_url: item.image_url ?? '', local_path: item.local_path ?? null,
    imgUploading: false, imgGenerating: false
  }
  captureResourceEditorBaseline('dramaScene')
  editDramaSceneVisible.value = true
}
async function saveDramaScene() {
  if (!editDramaSceneForm.value?.id) return
  editDramaSceneSaving.value = true
  try {
    await sceneAPI.update(editDramaSceneForm.value.id, {
      location: editDramaSceneForm.value.location,
      time: editDramaSceneForm.value.time || null,
      description: editDramaSceneForm.value.description || null,
      prompt: editDramaSceneForm.value.prompt || null,
    })
    ElMessage.success('已保存')
    editDramaSceneVisible.value = false
    loadDrama()
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) }
  finally { editDramaSceneSaving.value = false }
}
async function uploadDramaSceneImg(event) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  const form = editDramaSceneForm.value
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await sceneAPI.update(form.id, { image_url: url, local_path: null })
    loadDrama()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '上传失败')) }
  finally { form.imgUploading = false }
}
async function generateDramaSceneImg() {
  const form = editDramaSceneForm.value
  if (!form?.id) return
  const prompt = [form.location, form.time, form.description].filter(Boolean).join(', ')
  if (!prompt) { ElMessage.warning('请先填写地点或描述'); return }
  form.imgGenerating = true
  try {
    const res = await sceneAPI.generateImage({ scene_id: form.id, drama_id: dramaId, prompt })
    const data = res?.data ?? res
    const taskId = data?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    loadDrama()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '生成失败')) }
  finally { form.imgGenerating = false }
}

function openEditDramaProp(item) {
  editDramaPropForm.value = {
    id: item.id, name: item.name ?? '', type: item.type ?? '',
    description: item.description ?? '', prompt: item.prompt ?? '',
    image_url: item.image_url ?? '', local_path: item.local_path ?? null,
    imgUploading: false, imgGenerating: false
  }
  captureResourceEditorBaseline('dramaProp')
  editDramaPropVisible.value = true
}
async function saveDramaProp() {
  if (!editDramaPropForm.value?.id) return
  editDramaPropSaving.value = true
  try {
    await propAPI.update(editDramaPropForm.value.id, {
      name: editDramaPropForm.value.name,
      type: editDramaPropForm.value.type || null,
      description: editDramaPropForm.value.description || null,
      prompt: editDramaPropForm.value.prompt || null,
    })
    ElMessage.success('已保存')
    editDramaPropVisible.value = false
    loadDrama()
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) }
  finally { editDramaPropSaving.value = false }
}
async function uploadDramaPropImg(event) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  const form = editDramaPropForm.value
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await propAPI.update(form.id, { image_url: url, local_path: null })
    loadDrama()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '上传失败')) }
  finally { form.imgUploading = false }
}
async function generateDramaPropImg() {
  const form = editDramaPropForm.value
  if (!form?.id) return
  form.imgGenerating = true
  try {
    const res = await propAPI.generateImage(form.id, null, null)
    const data = res?.data ?? res
    const taskId = data?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    loadDrama()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '生成失败')) }
  finally { form.imgGenerating = false }
}

const loading = ref(false)
const drama = ref(null)
const episodes = ref([])
const currentEpisodeId = computed(() => resolveProjectEpisodeId(episodes.value, route.query.episode))
const aiConfigs = ref(null)
const sourceCount = ref(null)
const dramaLoadState = ref('loading')
const dramaLoadError = ref('')
const dramaLoadNotFound = ref(false)
const dramaLoadFailureRef = ref(null)
const readinessDependencyState = ref('idle')
const readinessDependencyError = ref('')
const hasReadinessSnapshot = ref(false)
const isDramaReady = computed(() => dramaLoadState.value === 'ready' && Boolean(drama.value))
let dramaLoadRequestId = 0
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

const infoForm = reactive({ title: '', description: '', genre: '', style: '', aspect_ratio: '16:9' })
const infoSaveState = ref('saved')
const infoSaveError = ref('')
const infoSaveScheduled = ref(false)
const infoSavedFingerprint = ref('')
let infoSaveTimer = null
let infoSavePromise = null
let infoSaveRequestedWhileSaving = false
let infoSyncing = false
let infoLeaveConfirmOpen = false

function buildInfoSnapshot() {
  return {
    title: infoForm.title || '',
    description: infoForm.description || '',
    genre: infoForm.genre || '',
    style: infoForm.style || '',
    aspect_ratio: infoForm.aspect_ratio || '16:9',
  }
}

function buildInfoFingerprint(snapshot) {
  return JSON.stringify(snapshot)
}

const infoDraftFingerprint = computed(() => buildInfoFingerprint(buildInfoSnapshot()))
const hasUnsavedInfoChanges = computed(() => (
  isDramaReady.value && infoDraftFingerprint.value !== infoSavedFingerprint.value
))
const shouldProtectInfoLeave = computed(() => (
  isDramaReady.value
  && (
    infoSaveState.value === 'error'
    || infoSaveScheduled.value
    || Boolean(infoSavePromise)
    || hasUnsavedInfoChanges.value
  )
))
const infoSaveStatusLabel = computed(() => {
  if (!isDramaReady.value) return ''
  if (infoSaveState.value === 'error') return infoSaveError.value || '保存失败'
  if (infoSaveState.value === 'saving' || infoSaveScheduled.value || hasUnsavedInfoChanges.value) return '保存中...'
  return '已保存'
})

function syncInfoFormFromDrama(currentDrama) {
  infoSyncing = true
  infoForm.title = currentDrama?.title || ''
  infoForm.description = currentDrama?.description || ''
  infoForm.genre = currentDrama?.genre || ''
  infoForm.style = currentDrama?.style || ''
  infoForm.aspect_ratio = currentDrama?.metadata?.aspect_ratio || '16:9'
  const snapshot = buildInfoSnapshot()
  infoSavedFingerprint.value = buildInfoFingerprint(snapshot)
  infoSaveState.value = 'saved'
  infoSaveError.value = ''
  infoSaveScheduled.value = false
  infoSaveRequestedWhileSaving = false
  infoSyncing = false
}

function clearInfoSaveTimer() {
  if (infoSaveTimer) {
    clearTimeout(infoSaveTimer)
    infoSaveTimer = null
  }
}

function applySavedInfoToDrama(snapshot) {
  if (!drama.value) return
  drama.value = {
    ...drama.value,
    title: snapshot.title,
    description: snapshot.description,
    genre: snapshot.genre,
    style: snapshot.style,
    metadata: {
      ...(drama.value.metadata || {}),
      ...stylePromptMetadataForSave(snapshot.style),
      aspect_ratio: snapshot.aspect_ratio || '16:9',
    },
  }
}

function scheduleInfoSave({ immediate = false } = {}) {
  if (!isDramaReady.value || infoSyncing) return
  if (infoSavePromise) {
    infoSaveRequestedWhileSaving = true
    return
  }
  clearInfoSaveTimer()
  infoSaveScheduled.value = true
  if (immediate) {
    void flushInfoSave()
    return
  }
  infoSaveTimer = setTimeout(() => {
    infoSaveTimer = null
    void flushInfoSave()
  }, 600)
}

async function flushInfoSave() {
  if (!isDramaReady.value) return true
  if (infoSavePromise) return infoSavePromise
  clearInfoSaveTimer()
  if (!hasUnsavedInfoChanges.value && infoSaveState.value !== 'error') {
    infoSaveScheduled.value = false
    infoSaveState.value = 'saved'
    return true
  }

  const snapshot = buildInfoSnapshot()
  const fingerprint = buildInfoFingerprint(snapshot)
  infoSaveScheduled.value = false
  infoSaveState.value = 'saving'
  infoSaveError.value = ''
  infoSavePromise = (async () => {
    try {
      await dramaAPI.update(dramaId, { title: snapshot.title, description: snapshot.description })
      await dramaAPI.saveOutline(dramaId, {
        genre: snapshot.genre || undefined,
        style: snapshot.style || undefined,
        metadata: {
          ...stylePromptMetadataForSave(snapshot.style),
          aspect_ratio: snapshot.aspect_ratio || '16:9',
        },
      })
      infoSavedFingerprint.value = fingerprint
      applySavedInfoToDrama(snapshot)
      infoSaveState.value = 'saved'
      infoSaveError.value = ''
      return true
    } catch (error) {
      infoSaveState.value = 'error'
      infoSaveError.value = dramaDetailUserError(error, '项目信息保存失败，请重试。')
      return false
    } finally {
      infoSavePromise = null
      if (infoSaveRequestedWhileSaving) {
        infoSaveRequestedWhileSaving = false
        if (hasUnsavedInfoChanges.value && infoSaveState.value !== 'error') {
          scheduleInfoSave({ immediate: true })
        }
      }
    }
  })()
  return infoSavePromise
}

async function retryInfoSave() {
  await flushInfoSave()
}

function describeInfoLeaveRisk() {
  if (infoSaveState.value === 'error') {
    return '项目信息保存失败，离开后本次修改会丢失。'
  }
  if (infoSaveState.value === 'saving' || infoSaveScheduled.value || hasUnsavedInfoChanges.value) {
    return '项目信息仍在自动保存，离开后可能丢失最新修改。'
  }
  return ''
}

/** 角色/场景/道具编辑弹窗的脏检查与未保存关闭确认 */
function snapshotResourceEdit(form, keys) {
  if (!form) return ''
  const snapshot = {}
  for (const key of keys) snapshot[key] = form[key] ?? ''
  return JSON.stringify(snapshot)
}

function isResourceEditDirty(visible, form, baseline, keys) {
  if (!visible || !form) return false
  if (form.imgUploading || form.imgGenerating) return true
  return snapshotResourceEdit(form, keys) !== baseline
}

function getResourceEditor(kind) {
  switch (kind) {
    case 'dramaChar':
      return {
        visible: editDramaCharVisible,
        form: editDramaCharForm,
        baseline: editDramaCharBaseline,
        keys: ['name', 'role', 'description', 'personality', 'appearance'],
      }
    case 'dramaScene':
      return {
        visible: editDramaSceneVisible,
        form: editDramaSceneForm,
        baseline: editDramaSceneBaseline,
        keys: ['location', 'time', 'description', 'prompt'],
      }
    case 'dramaProp':
      return {
        visible: editDramaPropVisible,
        form: editDramaPropForm,
        baseline: editDramaPropBaseline,
        keys: ['name', 'type', 'description', 'prompt'],
      }
    case 'char':
      return {
        visible: editCharVisible,
        form: editCharForm,
        baseline: editCharBaseline,
        keys: ['name', 'category', 'description', 'tags'],
      }
    case 'scene':
      return {
        visible: editSceneVisible,
        form: editSceneForm,
        baseline: editSceneBaseline,
        keys: ['location', 'time', 'category', 'description', 'tags'],
      }
    case 'prop':
      return {
        visible: editPropVisible,
        form: editPropForm,
        baseline: editPropBaseline,
        keys: ['name', 'category', 'description', 'tags'],
      }
    default:
      return null
  }
}

function captureResourceEditorBaseline(kind) {
  const editor = getResourceEditor(kind)
  if (!editor) return
  editor.baseline.value = snapshotResourceEdit(editor.form.value, editor.keys)
}

function hasUnsavedResourceEditor(kind) {
  const editor = getResourceEditor(kind)
  if (!editor) return false
  return isResourceEditDirty(
    editor.visible.value,
    editor.form.value,
    editor.baseline.value,
    editor.keys,
  )
}

function hasUnsavedResourceEdits() {
  return hasUnsavedResourceEditor('dramaChar')
    || hasUnsavedResourceEditor('dramaScene')
    || hasUnsavedResourceEditor('dramaProp')
    || hasUnsavedResourceEditor('char')
    || hasUnsavedResourceEditor('scene')
    || hasUnsavedResourceEditor('prop')
}

let resourceEditConfirmOpen = false

async function confirmResourceEditDiscard() {
  await ElMessageBox.confirm(
    '当前角色、场景或道具尚未保存，关闭后本次修改会丢失。',
    '放弃未保存修改？',
    {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning',
      ...MESSAGE_BOX_KEYBOARD,
    },
  )
}

async function confirmDiscardIfNeeded(hasUnsaved) {
  if (!hasUnsaved()) return true
  if (resourceEditConfirmOpen) return false
  resourceEditConfirmOpen = true
  try {
    await confirmResourceEditDiscard()
    return true
  } catch {
    return false
  } finally {
    resourceEditConfirmOpen = false
  }
}

async function confirmResourceEditLeave() {
  return confirmDiscardIfNeeded(() => hasUnsavedResourceEdits())
}

async function requestResourceEditorClose(kind, done) {
  if (!await confirmDiscardIfNeeded(() => hasUnsavedResourceEditor(kind))) return false
  if (typeof done === 'function') {
    done()
    return true
  }
  const editor = getResourceEditor(kind)
  if (editor) editor.visible.value = false
  return true
}

async function confirmBatchImportLeave() {
  if (episodeBatchImportDialogRef.value?.isImporting?.()) {
    ElMessage.warning('正在导入剧集，请完成后再离开。')
    return false
  }
  if (!episodeBatchImportDialogRef.value?.hasUnsavedWork?.()) return true
  return (await episodeBatchImportDialogRef.value.requestClose?.()) !== false
}

async function confirmInfoLeave() {
  if ((await confirmBatchImportLeave()) === false) return false
  if ((await confirmResourceEditLeave()) === false) return false
  if (!shouldProtectInfoLeave.value) return true
  if (infoSaveState.value !== 'error') {
    const saved = await flushInfoSave()
    if (saved && !shouldProtectInfoLeave.value) return true
  }
  if (infoLeaveConfirmOpen) return false
  infoLeaveConfirmOpen = true
  try {
    await ElMessageBox.confirm(
      describeInfoLeaveRisk(),
      '离开项目信息编辑？',
      {
        confirmButtonText: '仍然离开',
        cancelButtonText: '继续编辑',
        type: 'warning',
        distinguishCancelAndClose: true,
      },
    )
    return true
  } catch (_) {
    return false
  } finally {
    infoLeaveConfirmOpen = false
  }
}

function handleInfoBeforeUnload(event) {
  if (!shouldProtectInfoLeave.value && !episodeBatchImportDialogRef.value?.hasUnsavedWork?.() && !hasUnsavedResourceEdits()) return
  event.preventDefault()
  event.returnValue = ''
}

function assetImageUrl(item) {
  if (!item) return ''
  const lp = item.local_path && String(item.local_path).trim()
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return item.image_url || ''
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const coreDramaAPI = projectLifecycle.guardApi({
  get(id) {
    return requestCoreDrama(`/dramas/${encodeURIComponent(id)}`)
  },
  saveOutline(id, data) {
    return requestCoreDrama(`/dramas/${encodeURIComponent(id)}/outline`, { method: 'PUT', body: data })
  },
})

function friendlyDramaLoadError(error) {
  const status = Number(error?.status || error?.response?.status)
  if (status === 404) return '该项目不存在，或已移入回收站。'
  if (status >= 500) return '本地服务暂时不可用，请稍后重试。'
  return '无法连接本地服务，请确认服务已经启动后重试。'
}

async function loadDrama({ blocking = !isDramaReady.value } = {}) {
  const requestId = ++dramaLoadRequestId
  loading.value = true
  if (blocking) dramaLoadState.value = 'loading'
  dramaLoadError.value = ''
  dramaLoadNotFound.value = false
  try {
    let d = await coreDramaAPI.get(dramaId)
    d = await backfillDramaStylePromptMetadataIfNeeded(coreDramaAPI, dramaId, d)
    if (requestId !== dramaLoadRequestId) return false
    drama.value = d
    episodes.value = d.episodes || []
    syncInfoFormFromDrama(d)
    dramaLoadState.value = 'ready'
    dramaLoadNotFound.value = false
    return true
  } catch (e) {
    if (requestId !== dramaLoadRequestId) return false
    clearInfoSaveTimer()
    infoSaveScheduled.value = false
    infoSaveError.value = ''
    infoSaveState.value = 'saved'
    drama.value = null
    episodes.value = []
    dramaLoadNotFound.value = Number(e?.status || e?.response?.status) === 404
    dramaLoadError.value = friendlyDramaLoadError(e)
    dramaLoadState.value = 'error'
    await nextTick()
    dramaLoadFailureRef.value?.focus()
    return false
  } finally {
    if (requestId === dramaLoadRequestId) loading.value = false
  }
}

async function retryDramaLoad() {
  const loaded = await loadDrama({ blocking: true })
  if (!loaded) return
  await Promise.allSettled([loadReadinessDependencies(), loadCharList()])
}

function buildReadinessDependencyError(configsResult, sourcesResult) {
  const failed = []
  if (configsResult.status === 'rejected') failed.push('AI 配置')
  if (sourcesResult.status === 'rejected') failed.push('故事素材状态')
  if (!failed.length) return '项目就绪依赖加载失败，请稍后重试。'
  return `${failed.join('和')}加载失败，暂时无法判断项目就绪状态。`
}

async function loadReadinessDependencies() {
  readinessDependencyState.value = hasReadinessSnapshot.value ? 'refreshing' : 'loading'
  readinessDependencyError.value = ''
  const [configsResult, sourcesResult] = await Promise.allSettled([
    aiAPI.list(),
    sourceIntakeAPI.listForDrama(dramaId),
  ])
  if (configsResult.status === 'fulfilled' && sourcesResult.status === 'fulfilled') {
    aiConfigs.value = configsResult.value || []
    sourceCount.value = Array.isArray(sourcesResult.value) ? sourcesResult.value.length : 0
    readinessDependencyState.value = 'ready'
    readinessDependencyError.value = ''
    hasReadinessSnapshot.value = true
    return true
  }
  readinessDependencyState.value = 'error'
  readinessDependencyError.value = buildReadinessDependencyError(configsResult, sourcesResult)
  return false
}

async function handleSourceWorkflowRefresh() {
  const loaded = await loadDrama()
  if (loaded) await loadReadinessDependencies()
}

async function retryReadinessDependencies() {
  await loadReadinessDependencies()
}

function scrollToSection(id, { focus = true } = {}) {
  scrollAndFocusSection(id, { focus, focusDelay: id === 'source-intake-workflow' ? 250 : 0 })
}

function scrollToSourceIntake() {
  scrollToSection('source-intake-workflow')
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

function openEpisodeBatchImport() {
  episodeBatchImportDialogRef.value?.openDialog?.()
}

function handleReadinessAction(action) {
  if (!action) return
  if (action.target === 'readiness-dependencies') {
    retryReadinessDependencies()
    return
  }
  if (action.target === 'ai-config') {
    router.push({
      path: '/ai-config',
      query: { service_type: action.serviceType || '', returnTo: route.fullPath },
    })
    return
  }
  if (action.target === 'source-workflow') {
    scrollToSourceIntake()
    return
  }
  if (action.target === 'episode-list') {
    scrollToSection('episode-list')
    return
  }
  if (action.target === 'project-resources') {
    scrollToSection('project-resources')
    return
  }
  const query = {}
  if (action.episodeId) query.episode = action.episodeId
  if (action.id) query.focus = action.id
  router.push({ path: `/film/${dramaId}`, query: withProjectListReturnTo(query) })
}

function saveInfo() {
  scheduleInfoSave({ immediate: true })
}

function goList() {
  router.push(projectListReturnTo.value || { name: 'list' })
}

function withProjectListReturnTo(query = {}) {
  const nextQuery = { ...query }
  if (projectListReturnTo.value) nextQuery.returnTo = projectListReturnTo.value
  return nextQuery
}

function goCreate() {
  if (!currentEpisodeId.value) {
    ElMessage.warning('请先新增一集，再进入制作')
    scrollToSection('episode-list')
    return
  }
  const query = { episode: String(currentEpisodeId.value) }
  router.push({ path: `/film/${dramaId}`, query: withProjectListReturnTo(query) })
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

function goCanvasMode() {
  if (!currentEpisodeId.value) {
    ElMessage.warning('请先新增一集，再进入画布')
    scrollToSection('episode-list')
    return
  }
  const query = { episode: String(currentEpisodeId.value) }
  router.push({ path: `/film/${dramaId}/canvas`, query: withProjectListReturnTo(query) })
}

function goEpisode(epId) {
  router.push({ path: `/film/${dramaId}`, query: withProjectListReturnTo({ episode: epId }) })
}

function epStatusLabel(status) {
  const map = { draft: '草稿', processing: '生成中', completed: '剧本已就绪', failed: '失败' }
  return map[status] || status
}

async function onBatchImportEpisodes(importedEpisodes) {
  const current = episodes.value.map((ep, i) => ({
    episode_number: ep.episode_number ?? i + 1,
    title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
    script_content: ep.script_content || '',
    description: ep.description ?? null,
    duration: ep.duration ?? 0,
  }))
  await dramaAPI.saveEpisodes(dramaId, [...current, ...importedEpisodes])
  await loadDrama()
}

const addingEpisode = ref(false)
const deletingEpisodeId = ref(null)

async function onDeleteEpisode(ep) {
  const label = `第 ${ep.episode_number ?? '?'} 集「${ep.title || '未命名'}」`
  try {
    await ElMessageBox.confirm(`确定删除 ${label}？此操作不可恢复。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
  } catch { return }
  deletingEpisodeId.value = ep.id
  try {
    const remaining = episodes.value
      .filter((e) => e.id !== ep.id)
      .map((e, i) => ({
        episode_number: e.episode_number ?? i + 1,
        title: e.title || '第' + (e.episode_number ?? i + 1) + '集',
        script_content: e.script_content || '',
        description: e.description ?? null,
        duration: e.duration ?? 0,
      }))
    await dramaAPI.saveEpisodes(dramaId, remaining)
    ElMessage.success(`${label} 已删除`)
    await loadDrama()
  } catch (e) {
    ElMessage.error(dramaDetailUserError(e, '删除失败'))
  } finally {
    deletingEpisodeId.value = null
  }
}

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

// ---------- 资源库 Tab ----------
const activeResTab = ref('lib-char') // lib-char | lib-scene | lib-prop | drama-char | drama-scene | drama-prop
const previewUrl = ref(null)
function openPreview(url) { if (url) previewUrl.value = url }

// 角色
const charList = ref([]), charLoading = ref(false), charError = ref(''), charPage = ref(1), charPageSize = ref(20), charTotal = ref(0), charKw = ref('')
let charKwTimer = null
async function loadCharList() {
  charLoading.value = true
  try {
    const res = await characterLibraryAPI.list({ drama_id: dramaId, page: charPage.value, page_size: charPageSize.value, keyword: charKw.value || undefined })
    charList.value = res?.items ?? []; charTotal.value = res?.pagination?.total ?? 0
    charError.value = ''
  } catch (error) {
    charError.value = dramaDetailUserError(error, '角色库加载失败，请重试', '角色库')
  } finally { charLoading.value = false }
}
function onCharKwInput() { if (charKwTimer) clearTimeout(charKwTimer); charKwTimer = setTimeout(() => { charPage.value = 1; loadCharList() }, 300) }
const editCharVisible = ref(false), editCharForm = ref(null), editCharSaving = ref(false)
const editCharBaseline = ref('')
function openEditChar(item) {
  editCharForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  captureResourceEditorBaseline('char')
  editCharVisible.value = true
}
async function saveChar() {
  if (!editCharForm.value?.id) return; editCharSaving.value = true
  try {
    await characterLibraryAPI.update(editCharForm.value.id, { name: editCharForm.value.name, category: editCharForm.value.category || null, description: editCharForm.value.description || null, tags: editCharForm.value.tags || null, image_url: editCharForm.value.image_url || null, local_path: editCharForm.value.local_path ?? null })
    ElMessage.success('已保存'); editCharVisible.value = false; loadCharList()
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) } finally { editCharSaving.value = false }
}
async function deleteChar(item) {
  try { await ElMessageBox.confirm(`确定删除「${(item.name || '未命名').slice(0, 20)}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await characterLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadCharList() } catch (e) { ElMessage.error(dramaDetailUserError(e, '删除失败')) }
}

// 场景
const sceneList = ref([]), sceneLoading = ref(false), sceneError = ref(''), scenePage = ref(1), scenePageSize = ref(20), sceneTotal = ref(0), sceneKw = ref('')
let sceneKwTimer = null
async function loadSceneList() {
  sceneLoading.value = true
  try {
    const res = await sceneLibraryAPI.list({ drama_id: dramaId, page: scenePage.value, page_size: scenePageSize.value, keyword: sceneKw.value || undefined })
    sceneList.value = res?.items ?? []; sceneTotal.value = res?.pagination?.total ?? 0
    sceneError.value = ''
  } catch (error) {
    sceneError.value = dramaDetailUserError(error, '场景库加载失败，请重试', '场景库')
  } finally { sceneLoading.value = false }
}
function onSceneKwInput() { if (sceneKwTimer) clearTimeout(sceneKwTimer); sceneKwTimer = setTimeout(() => { scenePage.value = 1; loadSceneList() }, 300) }
const editSceneVisible = ref(false), editSceneForm = ref(null), editSceneSaving = ref(false)
const editSceneBaseline = ref('')
function openEditScene(item) {
  editSceneForm.value = { id: item.id, location: item.location ?? '', time: item.time ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  captureResourceEditorBaseline('scene')
  editSceneVisible.value = true
}
async function saveScene() {
  if (!editSceneForm.value?.id) return; editSceneSaving.value = true
  try {
    await sceneLibraryAPI.update(editSceneForm.value.id, { location: editSceneForm.value.location, time: editSceneForm.value.time || null, category: editSceneForm.value.category || null, description: editSceneForm.value.description || null, tags: editSceneForm.value.tags || null, image_url: editSceneForm.value.image_url || null, local_path: editSceneForm.value.local_path ?? null })
    ElMessage.success('已保存'); editSceneVisible.value = false; loadSceneList()
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) } finally { editSceneSaving.value = false }
}
async function deleteScene(item) {
  const n = (item.location || item.time || '未命名').slice(0, 20)
  try { await ElMessageBox.confirm(`确定删除「${n}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await sceneLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadSceneList() } catch (e) { ElMessage.error(dramaDetailUserError(e, '删除失败')) }
}

// 道具
const propList = ref([]), propLoading = ref(false), propError = ref(''), propPage = ref(1), propPageSize = ref(20), propTotal = ref(0), propKw = ref('')
let propKwTimer = null
async function loadPropList() {
  propLoading.value = true
  try {
    const res = await propLibraryAPI.list({ drama_id: dramaId, page: propPage.value, page_size: propPageSize.value, keyword: propKw.value || undefined })
    propList.value = res?.items ?? []; propTotal.value = res?.pagination?.total ?? 0
    propError.value = ''
  } catch (error) {
    propError.value = dramaDetailUserError(error, '道具库加载失败，请重试', '道具库')
  } finally { propLoading.value = false }
}
function onPropKwInput() { if (propKwTimer) clearTimeout(propKwTimer); propKwTimer = setTimeout(() => { propPage.value = 1; loadPropList() }, 300) }
const editPropVisible = ref(false), editPropForm = ref(null), editPropSaving = ref(false)
const editPropBaseline = ref('')
function openEditProp(item) {
  editPropForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  captureResourceEditorBaseline('prop')
  editPropVisible.value = true
}
async function saveProp() {
  if (!editPropForm.value?.id) return; editPropSaving.value = true
  try {
    await propLibraryAPI.update(editPropForm.value.id, { name: editPropForm.value.name, category: editPropForm.value.category || null, description: editPropForm.value.description || null, tags: editPropForm.value.tags || null, image_url: editPropForm.value.image_url || null, local_path: editPropForm.value.local_path ?? null })
    ElMessage.success('已保存'); editPropVisible.value = false; loadPropList()
  } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) } finally { editPropSaving.value = false }
}
async function deleteProp(item) {
  try { await ElMessageBox.confirm(`确定删除「${(item.name || '未命名').slice(0, 20)}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await propLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadPropList() } catch (e) { ElMessage.error(dramaDetailUserError(e, '删除失败')) }
}

// ---------- 从素材库导入 ----------
const importVisible = ref(false)
const importType = ref('char') // 'char' | 'scene' | 'prop'
const importList = ref([])
const importLoading = ref(false)
const importError = ref('')
const importPage = ref(1)
const importPageSize = ref(20)
const importTotal = ref(0)
const importKw = ref('')
const importingId = ref(null)
let importKwTimer = null

function openImport(type) {
  importType.value = type
  importKw.value = ''
  importPage.value = 1
  importVisible.value = true
}

async function loadImportList() {
  importLoading.value = true
  try {
    const api = importType.value === 'char' ? characterLibraryAPI
      : importType.value === 'scene' ? sceneLibraryAPI : propLibraryAPI
    // 不传 drama_id，获取全局素材库（所有记录）
    const res = await api.list({ page: importPage.value, page_size: importPageSize.value, keyword: importKw.value || undefined, global: 1 })
    importList.value = res?.items ?? []
    importTotal.value = res?.pagination?.total ?? 0
    importError.value = ''
  } catch (error) {
    importError.value = dramaDetailUserError(error, '全局素材库加载失败，请重试', '素材库')
  } finally { importLoading.value = false }
}

function onImportKwInput() {
  if (importKwTimer) clearTimeout(importKwTimer)
  importKwTimer = setTimeout(() => { importPage.value = 1; loadImportList() }, 300)
}

async function doImport(item) {
  importingId.value = item.id
  try {
    if (importType.value === 'char') {
      await characterLibraryAPI.create({
        drama_id: dramaId,
        name: item.name || '',
        image_url: item.image_url || null,
        local_path: item.local_path || null,
        description: item.description || null,
        category: item.category || null,
        tags: item.tags || null,
        source_type: 'imported',
      })
      loadCharList()
    } else if (importType.value === 'scene') {
      await sceneLibraryAPI.create({
        drama_id: dramaId,
        location: item.location || '',
        time: item.time || null,
        prompt: item.prompt || null,
        description: item.description || null,
        image_url: item.image_url || null,
        local_path: item.local_path || null,
        category: item.category || null,
        tags: item.tags || null,
        source_type: 'imported',
      })
      loadSceneList()
    } else {
      await propLibraryAPI.create({
        drama_id: dramaId,
        name: item.name || '',
        description: item.description || null,
        prompt: item.prompt || null,
        image_url: item.image_url || null,
        local_path: item.local_path || null,
        category: item.category || null,
        tags: item.tags || null,
        source_type: 'imported',
      })
      loadPropList()
    }
    ElMessage.success('已导入到本剧资源库')
  } catch (e) {
    ElMessage.error(dramaDetailUserError(e, '导入失败', '素材库'))
  } finally {
    importingId.value = null
  }
}

watch(activeResTab, (tab) => {
  if (tab === 'lib-char') loadCharList()
  else if (tab === 'lib-scene') loadSceneList()
  else if (tab === 'lib-prop') loadPropList()
})

watch(infoDraftFingerprint, () => {
  if (!isDramaReady.value || infoSyncing) return
  if (!hasUnsavedInfoChanges.value) {
    if (infoSaveState.value !== 'error') {
      infoSaveScheduled.value = false
      infoSaveState.value = 'saved'
    }
    return
  }
  if (infoSaveState.value === 'error') infoSaveError.value = ''
  scheduleInfoSave()
})

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

const episodeListBindings = computed(() => ({
  addingEpisode: addingEpisode.value,
  deletingEpisodeId: deletingEpisodeId.value,
  dramaId,
  episodeEmptyState: episodeEmptyState.value,
  episodes: episodes.value,
  epStatusLabel,
  handleReadinessAction,
  nextEpisodeNumber: nextEpisodeNumber.value,
  onAddEpisode,
  onBatchImportEpisodes,
  onDeleteEpisode,
  openEpisodeBatchImport,
  withProjectListReturnTo,
}))

const resourceLibraryBindings = createDramaDetailResourceLibraryBindings({
  activeResTab,
  addingEpisode,
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
})

const resourceDialogsBindings = createDramaDetailResourceDialogBindings({
  addingEpisode,
  currentEpisodeId,
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
  assetImageUrl,
  characterLibraryAPI,
  doGenerateLibImg,
  doImport,
  doUploadLibImg,
  generateDramaCharImg,
  generateDramaPropImg,
  generateDramaSceneImg,
  goCreateOrAddEpisode,
  loadCharList,
  loadImportList,
  loadPropList,
  loadSceneList,
  onImportKwInput,
  openPreview,
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
