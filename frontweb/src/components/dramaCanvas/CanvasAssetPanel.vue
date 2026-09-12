<template>
  <div
    ref="panelRef"
    class="canvas-node-panel asset-panel nodrag nopan nowheel"
    tabindex="-1"
    :class="'kind-' + kind"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
    @wheel.stop
    @keydown.esc.stop.prevent="closePanel"
  >
    <div class="panel-head">
      <span>{{ kindLabel }}</span>
      <el-button link size="small" aria-label="收起面板" @click.stop="closePanel">收起</el-button>
    </div>

    <div class="panel-body">
      <CanvasAssetPanelPreview
        :kind-label="kindLabel"
        :kind-icon="kindIcon"
        :display-name="displayName"
        :preview-url="previewUrl"
        :generating="generating"
        :node-busy="nodeBusy"
        :entity-status="entityStatus"
        :entity-status-label="entityStatusLabel"
        :preview-source-label="previewSourceLabel"
        :generate-error="generateError"
      />

      <CanvasAssetPanelForm
        :kind="kind"
        :form="form"
        :on-select-visible-change="onSelectVisibleChange"
      >
        <CanvasAssetPanelPanorama
          v-if="kind === 'scene'"
          :panorama-preview-url="panoramaPreviewUrl"
          :panorama-disabled-reason="panoramaDisabledReason"
          :panorama-generating="panoramaGenerating"
          :panorama-error="panoramaError"
          :generate-panorama="generatePanorama"
        />
      </CanvasAssetPanelForm>
    </div>

    <div class="panel-actions">
      <el-button size="small" :loading="saving" :aria-label="saving ? '正在保存' : '保存资产'" @click.stop="saveAsset">保存</el-button>
      <el-button
        v-if="canGenerate || generating || entityStatus === 'failed'"
        size="small"
        type="primary"
        :loading="generating"
        :aria-label="generateActionLabel"
        @click.stop="generateImage"
      >
        {{ generateActionLabel }}
      </el-button>
      <el-button
        v-if="generating"
        size="small"
        type="warning"
        plain
        aria-label="取消生成参考图"
        @click.stop="abortGenerate"
      >取消生成参考图</el-button>
      <el-button size="small" plain aria-label="关联分镜" @click.stop="highlightRelated">关联分镜</el-button>
      <el-button size="small" type="danger" plain aria-label="删除资产" @click.stop="deleteAsset">删除</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { taskAPI } from '@/api/task'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { generateAssetReferenceImage } from '@/composables/useCanvasAssetGenerate'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { isRequestNetworkError, isRequestTimeout } from '@/utils/requestError'
import { assetImageUrl } from '@/utils/mediaUrl'
import CanvasAssetPanelPreview from './CanvasAssetPanelPreview.vue'
import CanvasAssetPanelForm from './CanvasAssetPanelForm.vue'
import CanvasAssetPanelPanorama from './CanvasAssetPanelPanorama.vue'

const props = defineProps({
  kind: { type: String, required: true },
  entity: { type: Object, required: true },
  nodeId: { type: String, required: true },
})

const ctx = useCanvasContext()
const panelRef = ref(null)
const saving = ref(false)
const generating = ref(false)
const generateError = ref('')
let generationRun = null
const panoramaGenerating = ref(false)
const panoramaError = ref('')
const panoramaScene = ref(null)
let panoramaLoadToken = 0
const form = reactive({
  name: '',
  role: '',
  appearance: '',
  description: '',
  location: '',
  time: '',
  prompt: '',
})

const kindLabel = computed(() => {
  const map = { character: '角色', scene: '场景', prop: '道具' }
  return map[props.kind] || '素材'
})

const kindIcon = computed(() => {
  const map = { character: '👤', scene: '🏞', prop: '🎭' }
  return map[props.kind] || '📦'
})

const previewUrl = computed(() => assetImageUrl(props.entity))
const canGenerate = computed(() => !previewUrl.value)
const panoramaPreviewUrl = computed(() => {
  const scene = Number(panoramaScene.value?.id) === Number(props.entity?.id)
    ? panoramaScene.value
    : props.entity
  return assetImageUrl({
    local_path: scene?.panorama_local_path,
    image_url: scene?.panorama_image_url,
  })
})
const hasSceneSource = computed(() => Boolean(previewUrl.value))
const panoramaDisabledReason = computed(() => {
  if (!hasSceneSource.value) return '请先为该场景生成或上传主图'
  if (generating.value) return '场景主图正在生成，请等待完成'
  return ''
})
const displayName = computed(() => {
  const entity = props.entity || {}
  return entity.name || entity.location || '未命名'
})
const generateActionLabel = computed(() => (previewUrl.value ? '重新生成参考图' : '生成参考图'))
const entityStatus = computed(() => props.entity?.status || '')
const entityStatusLabel = computed(() => {
  const s = entityStatus.value
  const map = { pending: '待生成', processing: '生成中', completed: '已完成', failed: '失败' }
  return map[s] || (previewUrl.value ? '已有参考图' : '无参考图')
})
const previewSourceLabel = computed(() => {
  if (generating.value || nodeBusy.value) return '正在生成参考图'
  if (entityStatus.value === 'failed') return '参考图生成失败，可重试'
  if (previewUrl.value) return '已有参考图，可重新生成'
  return '还没有参考图，可在下方生成'
})

const nodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? map[props.nodeId] : null
})

function syncForm(entity) {
  form.name = entity?.name || ''
  form.role = entity?.role || ''
  form.appearance = entity?.appearance || ''
  form.description = entity?.description || ''
  form.location = entity?.location || ''
  form.time = entity?.time || ''
  form.prompt = entity?.prompt || entity?.polished_prompt || ''
}

onMounted(() => {
  panelRef.value?.focus?.()
})

watch(() => props.entity, (e) => syncForm(e), { immediate: true, deep: true })
watch(() => [props.kind, props.entity?.id], () => {
  panoramaLoadToken += 1
  panoramaError.value = ''
  panoramaScene.value = null
  refreshPanoramaScene()
}, { immediate: true })

async function refreshPanoramaScene() {
  if (props.kind !== 'scene' || !props.entity?.id) return
  const sceneId = Number(props.entity.id)
  const token = ++panoramaLoadToken
  try {
    const data = await sceneAPI.get(sceneId)
    if (token === panoramaLoadToken && Number(props.entity?.id) === sceneId) {
      panoramaScene.value = data?.scene || data || null
    }
  } catch (_) {}
}

function panoramaTaskError(task, fallback = '全景图生成失败') {
  if (typeof task?.error === 'string' && task.error.trim()) return canvasUserError(task.error, fallback)
  if (task?.error) return canvasUserError(task.error, fallback)
  if (typeof task?.message === 'string' && task.message.trim()) return canvasUserError(task.message, fallback)
  return fallback
}

async function waitForPanoramaTask(taskId, maxAttempts = 450, interval = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    try {
      const task = await taskAPI.get(taskId)
      if (task?.status === 'completed') return
      if (task?.status === 'failed') throw new Error(canvasUserError(panoramaTaskError(task), '全景图生成失败'))
      if (task?.status === 'timeout') throw new Error(canvasUserError(panoramaTaskError(task, '全景图生成超时，请稍后重试'), '全景图生成超时，请稍后重试'))
      if (task?.status === 'cancelled' || task?.status === 'canceled') {
        throw new Error(canvasUserError(panoramaTaskError(task, '操作已取消'), '操作已取消'))
      }
    } catch (error) {
      if (!isRequestNetworkError(error) && !isRequestTimeout(error) && error?.message) {
        throw new Error(canvasUserError(error, '全景图生成失败'))
      }
      if (i === maxAttempts - 1) {
        if (isRequestTimeout(error)) throw new Error('全景图生成超时，请稍后重试')
        throw new Error(canvasUserError(error, '全景图任务轮询失败'))
      }
    }
  }
  throw new Error('全景图生成超时，请稍后重试')
}

function onSelectVisibleChange(open) {
  if (open) ctx?.suppressPaneClick?.()
  else ctx?.suppressPaneClick?.(400)
}

function closePanel() {
  abortGenerate()
  ctx?.clearFocusedNode?.()
}

async function saveAsset() {
  saving.value = true
  ctx?.nodeStatus?.set(props.nodeId, { step: 'save', message: '保存中…' })
  try {
    if (props.kind === 'character') {
      if (!form.name.trim()) {
        ElMessage.warning('请填写角色名称')
        return
      }
      await characterAPI.update(props.entity.id, {
        name: form.name.trim(),
        role: form.role || undefined,
        appearance: form.appearance.trim() || undefined,
        description: form.description.trim() || undefined,
      })
    } else if (props.kind === 'scene') {
      if (!form.location.trim()) {
        ElMessage.warning('请填写场景地点')
        return
      }
      await sceneAPI.update(props.entity.id, {
        location: form.location.trim(),
        time: form.time.trim() || undefined,
        prompt: form.prompt.trim() || undefined,
      })
    } else {
      if (!form.name.trim()) {
        ElMessage.warning('请填写道具名称')
        return
      }
      await propAPI.update(props.entity.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        prompt: form.prompt.trim() || undefined,
      })
    }
    ElMessage.success('已保存')
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(canvasUserError(e, '保存失败'))
  } finally {
    saving.value = false
    if (!generating.value) ctx?.nodeStatus?.clear(props.nodeId)
  }
}

async function deleteAsset() {
  const label = props.kind === 'scene'
    ? (props.entity.location || '未命名')
    : (props.entity.name || '未命名')
  try {
    await ElMessageBox.confirm(`确定删除「${label.slice(0, 20)}」？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    if (props.kind === 'character') {
      await characterAPI.delete(props.entity.id)
    } else if (props.kind === 'scene') {
      await sceneAPI.delete(props.entity.id)
    } else {
      await propAPI.delete(props.entity.id)
    }
    ctx?.clearFocusedNode?.()
    ElMessage.success('已删除')
    await ctx?.refresh?.()
  } catch (e) {
    if (isCanvasUserAbort(e)) return
    ElMessage.error(canvasUserError(e, '删除失败'))
  }
}

function abortGenerate() {
  generationRun?.abort()
}

onBeforeUnmount(() => {
  abortGenerate()
})

async function generateImage() {
  if (generating.value) return
  abortGenerate()
  const controller = new AbortController()
  generationRun = controller
  generating.value = true
  generateError.value = ''
  try {
    await generateAssetReferenceImage(ctx, {
      kind: props.kind,
      entity: props.entity,
      nodeId: props.nodeId,
      signal: generationRun.signal,
    })
    if (controller.signal.aborted) return
    ElMessage.success('参考图已生成')
  } catch (e) {
    if (isCanvasUserAbort(e) || controller.signal.aborted) return
    generateError.value = canvasUserError(e, '参考图生成失败')
    ElMessage.error(generateError.value)
  } finally {
    if (generationRun === controller) {
      generationRun = null
      generating.value = false
    }
  }
}

async function generatePanorama() {
  if (!hasSceneSource.value || panoramaGenerating.value) return
  panoramaGenerating.value = true
  panoramaError.value = ''
  try {
    const result = await sceneAPI.generatePanorama(props.entity.id)
    const taskId = result?.image_generation?.task_id || result?.task_id
    if (!taskId) throw new Error('全景图任务未返回任务 ID')
    await waitForPanoramaTask(taskId)
    await refreshPanoramaScene()
    await ctx?.refreshDrama?.(true)
    await ctx?.refresh?.(true)
    ElMessage.success('全景图已生成')
  } catch (error) {
    panoramaError.value = canvasUserError(error, '全景图生成失败')
    ElMessage.error(panoramaError.value)
  } finally {
    panoramaGenerating.value = false
  }
}

function highlightRelated() {
  ctx?.setHighlightAsset?.(props.nodeId)
}
</script>

<style scoped>
.asset-panel {
  margin-top: 10px;
  width: min(520px, 92vw);
  padding: 10px 14px 12px;
  border-radius: 12px;
  border: 1px solid var(--canvas-emerald-border, rgba(52, 211, 153, 0.4));
  background: var(--canvas-panel-surface, rgba(15, 15, 18, 0.97));
  box-shadow: var(--canvas-raised-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
  --asset-spinner-color: var(--canvas-success-text, #34d399);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--canvas-emerald-text, #6ee7b7);
  margin-bottom: 10px;
}
.panel-body {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--canvas-divider, rgba(63, 63, 70, 0.6));
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
.kind-scene { border-color: var(--canvas-blue-border, rgba(96, 165, 250, 0.45)); --asset-spinner-color: var(--canvas-blue-text, #93c5fd); }
.kind-scene .panel-head { color: var(--canvas-blue-text, #93c5fd); }
.kind-prop { border-color: var(--canvas-amber-border, rgba(251, 191, 36, 0.45)); --asset-spinner-color: var(--canvas-amber-text, #fcd34d); }
.kind-prop .panel-head { color: var(--canvas-amber-text, #fcd34d); }
</style>
