<template>
  <div
    ref="panelRef"
    class="canvas-node-panel sb-panel nodrag nopan nowheel"
    tabindex="-1"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
    @wheel.stop
    @keydown.esc.stop.prevent="closePanel"
  >
    <div class="panel-head">
      <span>分镜 #{{ storyboard?.storyboard_number ?? storyboard?.id }}</span>
      <div class="head-actions">
        <span v-if="busyLabel" class="busy-tag">{{ busyLabel }}</span>
        <el-button link size="small" type="primary" aria-label="打开列表详情" @click.stop="openListMode">列表详情</el-button>
        <el-button link size="small" aria-label="收起面板" @click.stop="closePanel">收起</el-button>
      </div>
    </div>
    <div v-if="audioOutcomeUnknown" class="media-query-blocker" role="alert">
      <span>上一次配音结果待确认，服务端可能仍在合成并产生费用。</span>
      <el-button size="small" type="warning" plain @click.stop="refreshAfterUnknownAudio">刷新分镜状态</el-button>
    </div>

    <el-form label-position="left" label-width="36px" size="small" class="panel-form compact-form">
      <el-form-item label="标题">
        <el-input v-model="form.title" :aria-label="storyboardControlLabel('标题')" placeholder="分镜标题" @blur="saveMeta" />
      </el-form-item>

      <div class="relation-row">
        <el-form-item label="角色" class="rel-item">
          <el-select
            v-model="characterIds"
            :aria-label="storyboardControlLabel('角色')"
            multiple
            collapse-tags
            collapse-tags-tooltip
            filterable
            placeholder="角色"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="onSelectVisibleChange"
            @change="onRelationChange"
          >
            <el-option
              v-for="c in characters"
              :key="c.id"
              :label="c.name || '未命名'"
              :value="normalizeEntityId(c.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="场景" class="rel-item">
          <el-select
            v-model="sceneId"
            :aria-label="storyboardControlLabel('场景')"
            clearable
            filterable
            placeholder="场景"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="onSelectVisibleChange"
            @change="onRelationChange"
          >
            <el-option
              v-for="s in scenes"
              :key="s.id"
              :label="s.location || '未命名'"
              :value="normalizeEntityId(s.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="道具" class="rel-item">
          <el-select
            v-model="propIds"
            :aria-label="storyboardControlLabel('道具')"
            multiple
            collapse-tags
            collapse-tags-tooltip
            filterable
            placeholder="道具"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="onSelectVisibleChange"
            @change="onRelationChange"
          >
            <el-option
              v-for="p in propsList"
              :key="p.id"
              :label="p.name || '未命名'"
              :value="normalizeEntityId(p.id)"
            />
          </el-select>
        </el-form-item>
      </div>
      <div class="inline-add-row">
        <el-button link type="primary" size="small" :aria-label="storyboardControlLabel('添加角色')" @click.stop="createAsset('character')">+角色</el-button>
        <el-button link type="primary" size="small" :aria-label="storyboardControlLabel('添加场景')" @click.stop="createAsset('scene')">+场景</el-button>
        <el-button link type="primary" size="small" :aria-label="storyboardControlLabel('添加道具')" @click.stop="createAsset('prop')">+道具</el-button>
      </div>

      <div class="reference-row">
        <span class="reference-label">参考图 {{ referenceSlots.length }}/10</span>
        <div class="reference-list">
          <p v-if="!referenceDisplaySlots.length" class="reference-empty" role="status">
            尚未加入参考图。绑定带图的场景、角色或道具后会自动出现，也可上传自由参考图。
          </p>
          <div
            v-for="slot in referenceDisplaySlots"
            :key="`${slot.kind}-${slot.index}-${slot.url || slot.name}`"
            class="reference-thumb"
            :class="{ pending: !slot.url }"
            :title="canvasReferenceSourceLabel(slot)"
          >
            <img v-if="slot.url" :src="slot.url" :alt="canvasReferenceSourceLabel(slot)" />
            <div v-else class="reference-missing">暂无图</div>
            <span class="reference-kind">{{ canvasReferenceKindLabel(slot.kind) }}</span>
            <el-button
              v-if="slot.kind === 'free' && slot.freeIndex != null"
              class="reference-remove"
              :icon="Close"
              circle
              size="small"
              title="移除自由参考图"
              :aria-label="storyboardControlLabel(`移除自由参考图${slot.freeIndex + 1}`)"
              @click.stop="removeFreeReference(slot.freeIndex)"
            />
          </div>
          <el-tooltip content="上传自由参考图" placement="top">
            <el-button
              class="reference-upload"
              :icon="Upload"
              circle
              :loading="uploadingReference"
              :disabled="referenceSlots.length >= 10"
              :aria-label="storyboardControlLabel('上传自由参考图')"
              @click.stop="openReferenceUpload"
            />
          </el-tooltip>
        </div>
        <input
          ref="referenceFileInput"
          class="reference-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          tabindex="-1"
          aria-hidden="true"
          @change="onReferenceFiles"
        />
      </div>

      <div class="meta-row">
        <el-form-item label="景别" class="meta-item">
          <el-input v-model="form.shot_type" :aria-label="storyboardControlLabel('景别')" placeholder="特写" @blur="saveMeta" />
        </el-form-item>
        <el-form-item label="时长" class="meta-item narrow">
          <el-input-number v-model="form.duration" :aria-label="storyboardControlLabel('时长')" :min="1" :max="120" controls-position="right" @change="saveMeta" />
        </el-form-item>
      </div>

      <el-form-item v-if="gridImages.length" label="宫格">
        <el-select v-model="form.video_reference_image_id" :aria-label="storyboardControlLabel('视频参考图')" clearable placeholder="视频使用主图/首帧">
          <el-option
            v-for="image in gridImages"
            :key="image.id"
            :label="image.frame_type === 'nine_grid' ? `九宫格 #${image.id}` : `四宫格 #${image.id}`"
            :value="image.id"
          />
        </el-select>
      </el-form-item>

      <template v-if="isUniversal">
        <el-form-item label="全能词">
          <el-input
            v-model="form.universal_segment_text"
            type="textarea"
            :rows="2"
            resize="vertical"
            :aria-label="storyboardControlLabel('全能词')"
            placeholder="全能模式片段描述"
          />
        </el-form-item>
        <el-form-item label="视频词">
          <el-input
            v-model="form.video_prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            :aria-label="storyboardControlLabel('视频词')"
            placeholder="生视频提示词"
          />
        </el-form-item>
      </template>
      <template v-else>
        <div class="text-row-2">
          <el-form-item label="动作" class="flex-1">
            <el-input
              v-model="form.action"
              type="textarea"
              :rows="2"
              resize="vertical"
              :aria-label="storyboardControlLabel('动作')"
              placeholder="画面动作"
            />
          </el-form-item>
          <el-form-item label="对白" class="flex-1">
            <el-input
              v-model="form.dialogue"
              type="textarea"
              :rows="2"
              resize="vertical"
              :aria-label="storyboardControlLabel('对白')"
              placeholder="角色对白"
            />
          </el-form-item>
        </div>
        <el-form-item label="生图词">
          <el-input
            v-model="form.image_prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            :aria-label="storyboardControlLabel('生图词')"
            placeholder="图片提示词"
          />
        </el-form-item>
        <el-form-item label="视频词">
          <el-input
            v-model="form.video_prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            :aria-label="storyboardControlLabel('视频词')"
            placeholder="视频提示词"
          />
        </el-form-item>
      </template>
    </el-form>

    <div class="panel-actions">
      <el-button size="small" :loading="saving" @click.stop="saveFields">保存</el-button>
      <el-button v-if="!isUniversal" size="small" :loading="busyStep === 'polish'" @click.stop="polishPrompt">润色</el-button>
      <el-button
        v-if="isUniversal"
        size="small"
        :icon="MagicStick"
        :loading="busyStep === 'universal-generate'"
        @click.stop="runUniversalPrompt('generate')"
      >生成全能词</el-button>
      <el-button
        v-if="isUniversal && form.universal_segment_text.trim()"
        size="small"
        :icon="Refresh"
        :loading="busyStep === 'universal-polish'"
        @click.stop="runUniversalPrompt('polish')"
      >流式润色</el-button>
      <el-button v-if="!isUniversal && !useFirstLast" size="small" type="primary" :loading="busyStep === 'image'" @click.stop="runStep('image')">生图</el-button>
      <el-button v-if="!isUniversal && useFirstLast" size="small" type="primary" :loading="busyStep === 'first-frame'" @click.stop="runStep('first-frame')">生成首帧</el-button>
      <el-button v-if="!isUniversal && useFirstLast" size="small" type="primary" :loading="busyStep === 'last-frame'" @click.stop="runStep('last-frame')">生成尾帧</el-button>
      <CanvasActionGate
        :reason="videoAction.reason"
        label="生成单镜视频"
        :description-id="videoReasonId"
        :config-service-type="videoAction.serviceType"
      >
        <el-button
          size="small"
          type="primary"
          :loading="busyStep === 'video'"
          :disabled="Boolean(videoAction.reason)"
          @click.stop="runStep('video')"
        >生视频</el-button>
      </CanvasActionGate>
      <CanvasActionGate
        :reason="ttsAction.reason"
        label="生成单镜配音"
        :description-id="ttsReasonId"
        :config-service-type="ttsAction.serviceType"
      >
        <el-button
          size="small"
          type="warning"
          :loading="busyStep === 'audio'"
          :disabled="Boolean(ttsAction.reason) || audioOutcomeUnknown"
          @click.stop="runStep('audio')"
        >配音</el-button>
      </CanvasActionGate>
      <el-button size="small" type="danger" plain @click.stop="deleteStoryboard">删除</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, MagicStick, Refresh, Upload } from '@element-plus/icons-vue'
import { storyboardsAPI } from '@/api/storyboards'
import { uploadAPI } from '@/api/upload'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'
import {
  normalizeEntityId,
  parseStoryboardCharacterIds,
  parseStoryboardPropIds,
  parseStoryboardSceneId,
} from '@/utils/canvasEntityIds'
import { runImageStep, runFrameImageStep, runVideoStep, runAudioStep } from '@/composables/useCanvasWorkflowRunner'
import { findStoryboardInDrama, getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import { collectStoryboardReferenceSlots } from '@/utils/storyboardVideoRequest'
import { assetImageUrl } from '@/utils/mediaUrl'
import {
  buildCanvasReferenceDisplaySlots,
  canvasReferenceKindLabel,
  canvasReferenceSourceLabel,
} from '@/composables/useCanvasReferenceDisplay'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { dramaUsesFirstLastFrame } from '@/utils/storyboardMedia'
import { createStoryboardDraftFingerprint, hasStoryboardDraftChanges } from '@/utils/storyboardDraft'
import CanvasActionGate from './CanvasActionGate.vue'

const props = defineProps({
  storyboard: { type: Object, required: true },
  episodeId: { type: Number, default: null },
  nodeId: { type: String, default: '' },
})

const router = useRouter()
const ctx = useCanvasContext()
const panelRef = ref(null)
const saving = ref(false)
const busyStep = ref('')
const uploadingReference = ref(false)
const audioOutcomeUnknown = ref(false)
const referenceFileInput = ref(null)
const characterIds = ref([])
const sceneId = ref(null)
const propIds = ref([])
const savedDraftFingerprint = ref('')
const savedDraftValue = ref(null)
let leaveConfirmationOpen = false
let generationRun = null
const form = reactive({
  title: '',
  action: '',
  dialogue: '',
  image_prompt: '',
  video_prompt: '',
  universal_segment_text: '',
  shot_type: '',
  duration: 5,
  reference_images: [],
  video_reference_image_id: '',
})

const sbNodeId = computed(() => props.nodeId || (props.storyboard?.id ? `sb:${props.storyboard.id}` : ''))
const useFirstLast = computed(() => dramaUsesFirstLastFrame(ctx?.drama?.value))
const unavailableProductionAction = Object.freeze({
  ready: false,
  reason: '无法确认正式制作能力，请刷新后重试。',
  serviceType: '',
})
const videoAction = computed(() => ctx?.productionActions?.value?.video || unavailableProductionAction)
const ttsAction = computed(() => ctx?.productionActions?.value?.tts || unavailableProductionAction)
const videoReasonId = computed(() => `canvas-storyboard-video-reason-${props.storyboard?.id || 'unknown'}`)
const ttsReasonId = computed(() => `canvas-storyboard-tts-reason-${props.storyboard?.id || 'unknown'}`)

function storyboardControlLabel(control) {
  const number = props.storyboard?.storyboard_number ?? props.storyboard?.id ?? '未编号'
  return `分镜${number}${control}`
}

const isUniversal = computed(() => props.storyboard?.creation_mode === 'universal')
const characters = computed(() => ctx?.drama?.value?.characters || [])
const scenes = computed(() => ctx?.drama?.value?.scenes || [])
const propsList = computed(() => ctx?.drama?.value?.props || [])
const gridImages = computed(() => {
  const list = ctx?.imagesBySbId?.value?.[props.storyboard?.id]
  return (Array.isArray(list) ? list : []).filter((image) => (
    image?.status === 'completed' &&
    ['quad_grid', 'nine_grid'].includes(image?.frame_type) &&
    (image.image_url || image.local_path)
  ))
})

function parseFreeReferences(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object')
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : []
  } catch (_) {
    return []
  }
}

const referenceSlots = computed(() => {
  const storyboard = {
    ...props.storyboard,
    characters: characterIds.value,
    scene_id: sceneId.value,
    prop_ids: propIds.value,
    reference_images: form.reference_images,
  }
  let freeIndex = 0
  return collectStoryboardReferenceSlots(ctx?.drama?.value, storyboard).map((slot) => {
    if (slot.kind !== 'free') return slot
    return { ...slot, freeIndex: freeIndex++ }
  })
})

const referenceDisplaySlots = computed(() => buildCanvasReferenceDisplaySlots({
  filledSlots: referenceSlots.value,
  sceneId: sceneId.value,
  characterIds: characterIds.value,
  propIds: propIds.value,
  scenes: scenes.value,
  characters: characters.value,
  propsList: propsList.value,
  resolveUrl: assetImageUrl,
}))

const busyLabel = computed(() => {
  const map = ctx?.nodeStatus?.map
  const st = map && sbNodeId.value ? map[sbNodeId.value] : null
  return st?.message || (busyStep.value ? CANVAS_NODE_STATUS_LABELS[busyStep.value] : '')
})

function currentDraftValue() {
  return {
    ...form,
    characterIds: [...characterIds.value],
    sceneId: sceneId.value,
    propIds: [...propIds.value],
    reference_images: form.reference_images.map((item) => ({ ...item })),
  }
}

const hasUnsavedDraft = computed(() => hasStoryboardDraftChanges(
  savedDraftFingerprint.value,
  currentDraftValue(),
))
const hasPendingStoryboardWork = computed(() => (
  hasUnsavedDraft.value || saving.value || Boolean(busyStep.value) || uploadingReference.value
))

function cloneDraftValue(value) {
  return {
    ...value,
    characterIds: [...(value?.characterIds || [])],
    propIds: [...(value?.propIds || [])],
    reference_images: (value?.reference_images || []).map((item) => ({ ...item })),
  }
}

function markDraftSaved(draft = currentDraftValue()) {
  const snapshot = cloneDraftValue(draft)
  savedDraftValue.value = snapshot
  savedDraftFingerprint.value = createStoryboardDraftFingerprint(snapshot)
}

function markDraftFieldsSaved(fields, source = currentDraftValue()) {
  const next = cloneDraftValue(savedDraftValue.value || currentDraftValue())
  const snapshot = cloneDraftValue(source)
  for (const field of fields) next[field] = snapshot[field]
  markDraftSaved(next)
}

function syncForm(sb) {
  form.title = sb?.title || ''
  form.action = sb?.action || ''
  form.dialogue = sb?.dialogue || ''
  form.image_prompt = sb?.image_prompt || sb?.polished_prompt || ''
  form.video_prompt = sb?.video_prompt || ''
  form.universal_segment_text = sb?.universal_segment_text || ''
  form.shot_type = sb?.shot_type || ''
  form.duration = sb?.duration != null ? Number(sb.duration) : 5
  form.reference_images = parseFreeReferences(sb?.reference_images)
  form.video_reference_image_id = sb?.video_reference_image_id ? Number(sb.video_reference_image_id) : ''
  characterIds.value = parseStoryboardCharacterIds(sb)
  sceneId.value = parseStoryboardSceneId(sb)
  propIds.value = parseStoryboardPropIds(sb)
  markDraftSaved()
}

watch(() => props.storyboard, (sb) => {
  // A refresh can arrive while the user is editing. Keep the local draft until
  // it is explicitly saved or discarded instead of replacing it silently.
  if (savedDraftFingerprint.value && hasUnsavedDraft.value && String(sb?.id) === String(props.storyboard?.id)) return
  syncForm(sb)
}, { immediate: true, deep: true })

let unregisterFocusGuard = null
onMounted(() => {
  panelRef.value?.focus?.()
  unregisterFocusGuard = ctx?.registerFocusGuard?.(confirmStoryboardLeave, hasPendingStoryboardWork) || null
})
onBeforeUnmount(() => {
  generationRun?.abort()
  generationRun = null
  unregisterFocusGuard?.()
  unregisterFocusGuard = null
})

function onSelectVisibleChange(open) {
  if (open) ctx?.suppressPaneClick?.()
  else ctx?.suppressPaneClick?.(400)
}

async function confirmStoryboardLeave() {
  if (!hasPendingStoryboardWork.value) return true
  const billableGenerationActive = ['image', 'video', 'audio'].includes(busyStep.value)
    && ctx?.hasNodeGeneration?.()
  if (saving.value || uploadingReference.value || (busyStep.value && !['image', 'video', 'audio'].includes(busyStep.value)) || billableGenerationActive) {
    ElMessage.warning('分镜正在保存或生成，请完成后再离开。')
    return false
  }
  if (!hasUnsavedDraft.value) return true
  if (leaveConfirmationOpen) return false
  leaveConfirmationOpen = true
  try {
    await ElMessageBox.confirm(
      '当前分镜有未保存修改，离开后这些修改会丢失。',
      '离开分镜编辑？',
      {
        confirmButtonText: '放弃修改并离开',
        cancelButtonText: '继续编辑',
        type: 'warning',
        distinguishCancelAndClose: true,
      },
    )
    return true
  } catch (_) {
    return false
  } finally {
    leaveConfirmationOpen = false
  }
}

async function closePanel() {
  await ctx?.clearFocusedNode?.({ restoreFocus: true })
}

function createAsset(type) {
  ctx?.openCreateDialog?.(type)
}

async function openListMode() {
  const dramaId = ctx?.drama?.value?.id
  if (!dramaId) return
  router.push({
    path: `/film/${dramaId}`,
    query: props.episodeId ? { episode: String(props.episodeId) } : {},
    hash: props.storyboard?.id ? `#sb-${props.storyboard.id}` : undefined,
  })
}

async function onRelationChange() {
  if (!props.storyboard?.id) return
  const draftSnapshot = currentDraftValue()
  try {
    await storyboardsAPI.update(props.storyboard.id, {
      character_ids: draftSnapshot.characterIds,
      scene_id: draftSnapshot.sceneId,
      prop_ids: draftSnapshot.propIds,
    })
    markDraftFieldsSaved(['characterIds', 'sceneId', 'propIds'], draftSnapshot)
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(canvasUserError(e, '关联保存失败'))
  }
}

async function saveMeta() {
  if (!props.storyboard?.id) return
  const draftSnapshot = currentDraftValue()
  try {
    await storyboardsAPI.update(props.storyboard.id, {
      title: draftSnapshot.title.trim() || null,
      shot_type: draftSnapshot.shot_type.trim() || null,
      duration: draftSnapshot.duration ?? 5,
    })
    markDraftFieldsSaved(['title', 'shot_type', 'duration'], draftSnapshot)
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(canvasUserError(e, '保存失败'))
  }
}

async function persistForm(silent = false, draftValue = currentDraftValue()) {
  if (!props.storyboard?.id) return
  const draft = draftValue || currentDraftValue()
  const payload = isUniversal.value
    ? {
        title: draft.title.trim() || null,
        universal_segment_text: draft.universal_segment_text.trim() || null,
        video_prompt: draft.video_prompt.trim() || null,
        shot_type: draft.shot_type.trim() || null,
        duration: draft.duration ?? 5,
        reference_images: JSON.stringify(draft.reference_images),
        video_reference_image_id: draft.video_reference_image_id || null,
        character_ids: draft.characterIds,
        scene_id: draft.sceneId,
        prop_ids: draft.propIds,
      }
    : {
        title: draft.title.trim() || null,
        action: draft.action.trim() || null,
        dialogue: draft.dialogue.trim() || null,
        image_prompt: draft.image_prompt.trim() || null,
        video_prompt: draft.video_prompt.trim() || null,
        shot_type: draft.shot_type.trim() || null,
        duration: draft.duration ?? 5,
        reference_images: JSON.stringify(draft.reference_images),
        video_reference_image_id: draft.video_reference_image_id || null,
        character_ids: draft.characterIds,
        scene_id: draft.sceneId,
        prop_ids: draft.propIds,
      }
  await storyboardsAPI.update(props.storyboard.id, payload)
  if (!silent) ElMessage.success('已保存')
}

async function saveFields() {
  if (!props.storyboard?.id) return
  const draftSnapshot = currentDraftValue()
  saving.value = true
  ctx?.nodeStatus?.set(sbNodeId.value, { step: 'save', message: CANVAS_NODE_STATUS_LABELS.save })
  try {
    await persistForm(false, draftSnapshot)
    markDraftSaved(draftSnapshot)
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(canvasUserError(e, '保存失败'))
  } finally {
    saving.value = false
    if (!busyStep.value) ctx?.nodeStatus?.clear(sbNodeId.value)
  }
}

async function deleteStoryboard() {
  if (!props.storyboard?.id) return
  try {
    await ElMessageBox.confirm('确定删除该分镜？此操作不可恢复。', '删除分镜', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await storyboardsAPI.delete(props.storyboard.id)
    await ctx?.clearFocusedNode?.({ force: true })
    ElMessage.success('分镜已删除')
    await ctx?.refresh?.()
  } catch (e) {
    if (isCanvasUserAbort(e)) return
    ElMessage.error(canvasUserError(e, '删除失败'))
  }
}

async function polishPrompt() {
  if (!props.storyboard?.id) return
  busyStep.value = 'polish'
  ctx?.nodeStatus?.set(sbNodeId.value, { step: 'polish', message: CANVAS_NODE_STATUS_LABELS.polish })
  try {
    const res = await storyboardsAPI.polishPrompt(props.storyboard.id)
    if (res?.polished_prompt) form.image_prompt = res.polished_prompt
    markDraftFieldsSaved(['image_prompt'])
    ElMessage.success('提示词已润色')
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(canvasUserError(e, '润色失败'))
  } finally {
    busyStep.value = ''
    ctx?.nodeStatus?.clear(sbNodeId.value)
  }
}

function openReferenceUpload() {
  if (referenceSlots.value.length >= 10 || uploadingReference.value) return
  if (referenceFileInput.value) {
    referenceFileInput.value.value = ''
    referenceFileInput.value.click()
  }
}

async function persistReferences() {
  const draftSnapshot = currentDraftValue()
  await storyboardsAPI.update(props.storyboard.id, {
    reference_images: JSON.stringify(draftSnapshot.reference_images),
  })
  markDraftFieldsSaved(['reference_images'], draftSnapshot)
  await ctx?.refreshDrama?.(true)
}

async function onReferenceFiles(event) {
  const files = Array.from(event.target?.files || [])
  const available = Math.max(0, 10 - referenceSlots.value.length)
  if (!files.length || !available || !props.storyboard?.id) return
  uploadingReference.value = true
  try {
    const next = [...form.reference_images]
    for (const file of files.slice(0, available)) {
      const response = await uploadAPI.uploadImage(file, { dramaId: ctx?.drama?.value?.id })
      const data = response?.data ?? response
      const localPath = data?.local_path || data?.path || ''
      const url = data?.url || ''
      if (!localPath && !url) throw new Error(`${file.name} 上传未返回地址`)
      const key = localPath || url
      if (!next.some((item) => (item.local_path || item.image_url) === key)) {
        next.push({ name: file.name, local_path: localPath || null, image_url: url || null })
      }
    }
    form.reference_images = next
    await persistReferences()
    ElMessage.success('参考图已保存')
  } catch (e) {
    ElMessage.error(canvasUserError(e, '参考图上传失败'))
  } finally {
    uploadingReference.value = false
  }
}

async function removeFreeReference(index) {
  const original = [...form.reference_images]
  form.reference_images = original.filter((_, itemIndex) => itemIndex !== index)
  try {
    await persistReferences()
  } catch (e) {
    form.reference_images = original
    ElMessage.error(canvasUserError(e, '移除参考图失败'))
  }
}

function universalFieldOverrides() {
  return {
    title: form.title.trim(),
    action: form.action.trim(),
    dialogue: form.dialogue.trim(),
    video_prompt: form.video_prompt.trim(),
    shot_type: form.shot_type.trim(),
  }
}

async function runUniversalPrompt(mode) {
  if (!props.storyboard?.id || busyStep.value) return
  const original = form.universal_segment_text
  const polishing = mode === 'polish' && original.trim()
  busyStep.value = polishing ? 'universal-polish' : 'universal-generate'
  const message = polishing ? '正在流式润色全能词' : '正在生成全能词'
  ctx?.nodeStatus?.set(sbNodeId.value, { step: busyStep.value, message })
  let live = ''
  try {
    const draftSnapshot = currentDraftValue()
    await persistForm(true, draftSnapshot)
    markDraftSaved(draftSnapshot)
    const body = {
      duration: form.duration ?? 5,
      field_overrides: universalFieldOverrides(),
      force_without_reference_images: true,
      ...(polishing ? { draft_universal_segment_text: original.trim() } : {}),
    }
    const stream = polishing
      ? storyboardsAPI.polishUniversalSegmentPromptStream
      : storyboardsAPI.generateUniversalSegmentPromptStream
    const result = await stream(props.storyboard.id, body, (delta) => {
      live += delta
      form.universal_segment_text = live
    })
    const finalText = String(result?.universal_segment_text || live).trim()
    if (!finalText) throw new Error('未收到完整的全能词')
    form.universal_segment_text = finalText
    await storyboardsAPI.update(props.storyboard.id, { universal_segment_text: finalText })
    markDraftFieldsSaved(['universal_segment_text'])
    await ctx?.refreshDrama?.(true)
    ElMessage.success(polishing ? '全能词已润色并保存' : '全能词已生成并保存')
  } catch (e) {
    form.universal_segment_text = original
    ElMessage.error(canvasUserError(e, polishing ? '全能词润色失败' : '全能词生成失败'))
  } finally {
    busyStep.value = ''
    ctx?.nodeStatus?.clear(sbNodeId.value)
  }
}

async function runStep(step) {
  const drama = ctx?.drama?.value
  const sbId = props.storyboard?.id
  if (!drama || !sbId) return
  if (step === 'video' || step === 'audio') {
    const allowed = ctx?.ensureProductionStepReady?.(step)
    if (allowed !== true) {
      if (allowed == null) ElMessage.warning('无法确认正式制作能力，请刷新后重试。')
      return
    }
  }

  if (step === 'audio' && hasUnsavedDraft.value) {
    ElMessage.warning('请先保存当前分镜修改，再生成配音。')
    return
  }
  if (step === 'audio' && audioOutcomeUnknown.value) {
    ElMessage.warning('请先刷新分镜状态，确认上一次配音结果后再重试')
    return
  }

  busyStep.value = step
  const statusMsg = CANVAS_NODE_STATUS_LABELS[step] || '处理中…'
  ctx?.nodeStatus?.set(sbNodeId.value, { step, message: statusMsg })
  if (step === 'image') ctx?.nodeStatus?.set(`sbimg:${sbId}`, { step, message: statusMsg })
  if (step === 'first-frame') ctx?.nodeStatus?.set(`sbimg-first:${sbId}`, { step, message: statusMsg })
  if (step === 'last-frame') ctx?.nodeStatus?.set(`sbimg-last:${sbId}`, { step, message: statusMsg })
  if (step === 'video') ctx?.nodeStatus?.set(`sbvid:${sbId}`, { step, message: statusMsg })
  try {
    if (step !== 'audio') {
      const draftSnapshot = currentDraftValue()
      const snapshotFingerprint = createStoryboardDraftFingerprint(draftSnapshot)
      await persistForm(true, draftSnapshot)
      if (hasStoryboardDraftChanges(snapshotFingerprint, currentDraftValue())) {
        ElMessage.warning('保存期间检测到新的修改，请先保存后再生成。')
        return
      }
      markDraftSaved(draftSnapshot)
    }
    const nextRun = ctx?.beginNodeGeneration?.({ nodeId: sbNodeId.value, step }) || null
    if (!nextRun) {
      ElMessage.warning('已有单节点生成正在执行，请等待完成后再试')
      return
    }
    generationRun = nextRun
    const found = findStoryboardInDrama(drama, sbId)
    const sb = found?.storyboard || props.storyboard
    const genOpts = ctx?.getGenerationOptions?.() || getDramaGenerationOptions(drama)
    if (step === 'image') await runImageStep(drama, sb, genOpts, { signal: generationRun.signal })
    else if (step === 'first-frame' || step === 'last-frame') {
      await runFrameImageStep(drama, sb, genOpts, step === 'last-frame' ? 'last' : 'first', {
        signal: generationRun.signal,
        onWarning: (warning) => ElMessage.warning(canvasUserError(warning, '已改用本地帧提示词')),
      })
    }
    else if (step === 'video') await runVideoStep(drama, sb, genOpts, { signal: generationRun.signal })
    else if (step === 'audio') {
      const res = await runAudioStep(sb, { signal: generationRun.signal })
      if (res?.skipped) {
        ElMessage.info(canvasUserError(res.reason, '已跳过'))
        return
      }
    }
    ElMessage.success(
      step === 'image' ? '生图完成'
        : step === 'first-frame' ? '首帧生成完成'
          : step === 'last-frame' ? '尾帧生成完成'
            : step === 'video' ? '视频生成完成'
              : '配音完成'
    )
    await ctx?.refresh?.()
  } catch (e) {
    if (e?.code === 'SUBMISSION_OUTCOME_UNKNOWN') audioOutcomeUnknown.value = true
    if (e?.name !== 'AbortError' && !generationRun?.signal.aborted) {
      ElMessage.error(canvasUserError(e, '生成失败'))
    }
  } finally {
    generationRun?.finish()
    generationRun = null
    busyStep.value = ''
    ctx?.nodeStatus?.clear(sbNodeId.value)
    if (step === 'image') ctx?.nodeStatus?.clear(`sbimg:${sbId}`)
    if (step === 'first-frame') ctx?.nodeStatus?.clear(`sbimg-first:${sbId}`)
    if (step === 'last-frame') ctx?.nodeStatus?.clear(`sbimg-last:${sbId}`)
    if (step === 'video') ctx?.nodeStatus?.clear(`sbvid:${sbId}`)
  }
}

async function refreshAfterUnknownAudio() {
  try {
    await ctx?.refresh?.()
    audioOutcomeUnknown.value = false
    ElMessage.success('分镜状态已刷新')
  } catch (error) {
    ElMessage.error(canvasUserError(error, '刷新失败，请稍后重试'))
  }
}
</script>

<style scoped>
.sb-panel {
  margin-top: 10px;
  width: min(560px, 94vw);
  padding: 10px 14px 12px;
  border-radius: 8px;
  border: 1px solid var(--canvas-indigo-border, rgba(129, 140, 248, 0.45));
  background: var(--canvas-panel-surface, rgba(15, 15, 18, 0.97));
  box-shadow: var(--canvas-raised-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--canvas-indigo-text, #c7d2fe);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.busy-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.18);
  color: var(--canvas-blue-text, #93c5fd);
  animation: pulse-tag 1.2s ease-in-out infinite;
}
.compact-form :deep(.el-form-item) {
  margin-bottom: 6px;
}
.compact-form :deep(.el-form-item__label) {
  color: var(--canvas-text-subtle, #71717a);
  font-size: 11px;
}
.compact-form :deep(.el-input__wrapper),
.compact-form :deep(.el-select__wrapper) {
  min-height: 28px;
}
.compact-form :deep(.el-textarea__inner) {
  resize: vertical;
  min-height: 52px;
  line-height: 1.45;
}
.relation-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.rel-item {
  flex: 1;
  min-width: 0;
  margin-bottom: 4px !important;
}
.inline-add-row {
  display: flex;
  gap: 10px;
  margin: 0 0 8px 36px;
}
.reference-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 8px 36px;
}
.reference-label {
  flex: 0 0 auto;
  padding-top: 14px;
  font-size: 10px;
  color: var(--canvas-text-subtle, #71717a);
}
.reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.reference-thumb,
.reference-upload {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
}
.reference-empty {
  flex: 1 1 100%;
  margin: 0;
  padding-top: 10px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--canvas-text-muted, #a1a1aa);
}
.reference-thumb {
  position: relative;
  overflow: visible;
  border: 1px solid var(--canvas-divider-strong, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}
.reference-thumb.pending {
  border-style: dashed;
}
.reference-missing {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--canvas-text-subtle, #71717a);
  font-size: 9px;
}
.reference-thumb img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 5px;
}
.reference-kind {
  position: absolute;
  left: 2px;
  bottom: 2px;
  min-width: 22px;
  height: 16px;
  padding: 0 3px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 9px;
  line-height: 16px;
  text-align: center;
}
.reference-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  z-index: 1;
}
.reference-file-input {
  display: none;
}
.meta-row {
  display: flex;
  gap: 10px;
}
.meta-item { flex: 1; min-width: 0; }
.meta-item.narrow { max-width: 140px; flex: 0 0 140px; }
.text-row-2 {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.flex-1 { flex: 1; min-width: 0; }
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--canvas-divider-strong, rgba(63, 63, 70, 0.8));
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
@keyframes pulse-tag {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}
</style>

<style>
.canvas-panel-popper {
  z-index: 4000 !important;
}
.canvas-panel-popper.el-select__popper .el-select-dropdown__wrap {
  max-height: 168px !important;
}
</style>
