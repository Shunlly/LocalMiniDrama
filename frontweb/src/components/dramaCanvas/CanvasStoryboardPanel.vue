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
    <CanvasStoryboardPanelHeader
      :storyboard="storyboard"
      :busy-label="busyLabel"
      :audio-outcome-unknown="audioOutcomeUnknown"
      :open-list-mode="openListMode"
      :close-panel="closePanel"
      :refresh-after-unknown-audio="refreshAfterUnknownAudio"
    />

    <CanvasStoryboardPanelForm
      :form="form"
      :is-universal="isUniversal"
      :grid-images="gridImages"
      :storyboard-control-label="storyboardControlLabel"
      :save-meta="saveMeta"
    >
      <template #relations>
        <CanvasStoryboardPanelRelations
          v-model:character-ids="characterIds"
          v-model:scene-id="sceneId"
          v-model:prop-ids="propIds"
          :characters="characters"
          :scenes="scenes"
          :props-list="propsList"
          :storyboard-control-label="storyboardControlLabel"
          :on-select-visible-change="onSelectVisibleChange"
          :on-relation-change="onRelationChange"
          :create-asset="createAsset"
        />
      </template>
      <template #references>
        <CanvasStoryboardPanelReferences
          :reference-slots="referenceSlots"
          :reference-display-slots="referenceDisplaySlots"
          :uploading-reference="uploadingReference"
          :storyboard-control-label="storyboardControlLabel"
          :on-reference-files="onReferenceFiles"
          :remove-free-reference="removeFreeReference"
          :open-reference-library="openReferenceLibrary"
        />
        <GlobalMediaPickerDialog
          v-model="referencePickerVisible"
          title="添加分镜自由参考图"
          accept="image"
          :context="referencePickerContext"
          @select="onReferenceAssetSelected"
          @open-library="openMediaLibraryFromPicker"
        />
      </template>
      <template #frames>
        <CanvasStoryboardPanelFrames
          v-if="useFirstLast && !isUniversal"
          :first-frame-url="firstFrameUrl"
          :last-frame-url="lastFrameUrl"
          :storyboard-control-label="storyboardControlLabel"
        />
      </template>
    </CanvasStoryboardPanelForm>

    <CanvasStoryboardPanelActions
      :saving="saving"
      :busy-step="busyStep"
      :is-universal="isUniversal"
      :use-first-last="useFirstLast"
      :universal-segment-text="form.universal_segment_text"
      :video-action="videoAction"
      :tts-action="ttsAction"
      :video-reason-id="videoReasonId"
      :tts-reason-id="ttsReasonId"
      :tts-narration-reason-id="ttsNarrationReasonId"
      :audio-action-disabled-reason="audioActionDisabledReason"
      :narration-action-disabled-reason="narrationActionDisabledReason"
      :save-fields="saveFields"
      :polish-prompt="polishPrompt"
      :run-universal-prompt="runUniversalPrompt"
      :run-step="runStep"
      :delete-storyboard="deleteStoryboard"
      :can-move-up="canMoveStoryboardUp"
      :can-move-down="canMoveStoryboardDown"
      :reorder-busy="reorderBusy"
      :reorder-disabled-reason="reorderDisabledReason"
      :move-storyboard-up="moveStoryboardUp"
      :move-storyboard-down="moveStoryboardDown"
      :insert-storyboard-before="insertStoryboardBefore"
      :insert-storyboard-after="insertStoryboardAfter"
      :append-storyboard="appendStoryboard"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { storyboardsAPI } from '@/api/storyboards'
import { uploadAPI } from '@/api/upload'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'
import {
  parseStoryboardCharacterIds,
  parseStoryboardPropIds,
  parseStoryboardSceneId,
} from '@/utils/canvasEntityIds'
import { runImageStep, runFrameImageStep, runVideoStep, runAudioStep } from '@/composables/useCanvasWorkflowRunner'
import { findStoryboardInDrama, getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import { runStoryboardReorder } from '@/composables/filmCreate/useFilmCreateStoryboardReorder.js'
import { collectStoryboardReferenceSlots, createStoryboardReferenceFromAsset, upsertStoryboardReferenceImage } from '@/utils/storyboardVideoRequest'
import GlobalMediaPickerDialog from '@/components/GlobalMediaPickerDialog.vue'
import { assetImageUrl } from '@/utils/mediaUrl'
import { buildCanvasReferenceDisplaySlots } from '@/composables/useCanvasReferenceDisplay'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { toCanvasChineseStatus } from './canvasExperienceCopy.js'
import { dramaUsesFirstLastFrame, resolveSbFirstImageRecord, resolveSbLastImageRecord } from '@/utils/storyboardMedia'
import { createStoryboardDraftFingerprint, hasStoryboardDraftChanges } from '@/utils/storyboardDraft'
import CanvasStoryboardPanelHeader from './CanvasStoryboardPanelHeader.vue'
import CanvasStoryboardPanelForm from './CanvasStoryboardPanelForm.vue'
import CanvasStoryboardPanelRelations from './CanvasStoryboardPanelRelations.vue'
import CanvasStoryboardPanelReferences from './CanvasStoryboardPanelReferences.vue'
import CanvasStoryboardPanelFrames from './CanvasStoryboardPanelFrames.vue'
import CanvasStoryboardPanelActions from './CanvasStoryboardPanelActions.vue'

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
const referencePickerVisible = ref(false)
const audioOutcomeUnknown = ref(false)
const reorderBusy = ref(false)
const characterIds = ref([])
const sceneId = ref(null)
const propIds = ref([])
const savedDraftFingerprint = ref('')
const savedDraftValue = ref(null)
let leaveConfirmationOpen = false
let generationRun = null
let universalPromptRun = null

function abortUniversalPrompt() {
  universalPromptRun?.abort()
}

const form = reactive({
  title: '',
  action: '',
  dialogue: '',
  narration: '',
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
const ttsNarrationReasonId = computed(() => `canvas-storyboard-tts-narration-reason-${props.storyboard?.id || 'unknown'}`)
const audioActionDisabledReason = computed(() => (
  ttsAction.value.reason
  || (audioOutcomeUnknown.value ? '请先刷新分镜状态，确认上一次配音结果后再重试' : '')
  || (String(form.dialogue || '').trim() ? '' : '当前分镜没有对白')
))
const narrationActionDisabledReason = computed(() => (
  ttsAction.value.reason
  || (audioOutcomeUnknown.value ? '请先刷新分镜状态，确认上一次配音结果后再重试' : '')
  || (String(form.narration || '').trim() ? '' : '当前分镜没有解说旁白')
))

function storyboardControlLabel(control) {
  const number = props.storyboard?.storyboard_number ?? props.storyboard?.id ?? '未编号'
  return `分镜${number}${control}`
}

const isUniversal = computed(() => props.storyboard?.creation_mode === 'universal')
const characters = computed(() => ctx?.drama?.value?.characters || [])
const scenes = computed(() => ctx?.drama?.value?.scenes || [])
const propsList = computed(() => ctx?.drama?.value?.props || [])
const storyboardImagesById = computed(() => ({
  [props.storyboard?.id]: ctx?.imagesBySbId?.value?.[props.storyboard?.id] || [],
}))
const gridImages = computed(() => {
  const list = ctx?.imagesBySbId?.value?.[props.storyboard?.id]
  return (Array.isArray(list) ? list : []).filter((image) => (
    image?.status === 'completed' &&
    ['quad_grid', 'nine_grid'].includes(image?.frame_type) &&
    (image.image_url || image.local_path)
  ))
})
const firstFrameUrl = computed(() => assetImageUrl(resolveSbFirstImageRecord(props.storyboard, storyboardImagesById.value)))
const lastFrameUrl = computed(() => assetImageUrl(resolveSbLastImageRecord(props.storyboard, storyboardImagesById.value)))

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
  const raw = st?.message || (busyStep.value ? CANVAS_NODE_STATUS_LABELS[busyStep.value] : '')
  return toCanvasChineseStatus(raw, '处理中…')
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
  form.narration = sb?.narration || ''
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
  abortUniversalPrompt()
  universalPromptRun = null
  unregisterFocusGuard?.()
  unregisterFocusGuard = null
})

function onSelectVisibleChange(open) {
  if (open) ctx?.suppressPaneClick?.()
  else ctx?.suppressPaneClick?.(400)
}

async function confirmStoryboardLeave() {
  if (!hasPendingStoryboardWork.value) return true
  const billableGenerationActive = ['image', 'video', 'audio', 'narration-audio'].includes(busyStep.value)
    && ctx?.hasNodeGeneration?.()
  const universalBusy = busyStep.value === 'universal-generate' || busyStep.value === 'universal-polish'
  if (universalBusy) abortUniversalPrompt()
  if (saving.value || uploadingReference.value || (busyStep.value && !['image', 'video', 'audio', 'narration-audio'].includes(busyStep.value) && !universalBusy) || billableGenerationActive) {
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
  abortUniversalPrompt()
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
        narration: draft.narration.trim() || null,
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
        narration: draft.narration.trim() || null,
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

function episodeStoryboards() {
  const id = String(props.storyboard?.id ?? '')
  for (const episode of ctx?.drama?.value?.episodes || []) {
    const list = episode.storyboards || []
    if (list.some((item) => String(item.id) === id)) return list
  }
  return []
}

const storyboardIndex = computed(() => (
  episodeStoryboards().findIndex((item) => String(item.id) === String(props.storyboard?.id))
))
const canMoveStoryboardUp = computed(() => storyboardIndex.value > 0)
const canMoveStoryboardDown = computed(() => {
  const list = episodeStoryboards()
  return storyboardIndex.value >= 0 && storyboardIndex.value < list.length - 1
})
const reorderDisabledReason = computed(() => {
  if (saving.value || busyStep.value || reorderBusy.value || uploadingReference.value) {
    return '分镜忙碌时不能调整顺序'
  }
  if (hasUnsavedDraft.value) return '请先保存当前分镜修改，再调整顺序'
  return ''
})

async function moveStoryboardByOffset(offset) {
  const blocked = reorderDisabledReason.value
  if (blocked) {
    ElMessage.warning(blocked)
    return
  }
  const list = episodeStoryboards()
  const fromIndex = storyboardIndex.value
  const toIndex = fromIndex + offset
  if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) return
  reorderBusy.value = true
  try {
    await runStoryboardReorder({ list, fromIndex, toIndex, storyboardsAPI })
    ElMessage.success(offset < 0 ? '已上移分镜' : '已下移分镜')
    await ctx?.refresh?.()
  } catch (error) {
    if (isCanvasUserAbort(error)) return
    ElMessage.error(canvasUserError(error, '调整分镜顺序失败'))
  } finally {
    reorderBusy.value = false
  }
}

function moveStoryboardUp() {
  return moveStoryboardByOffset(-1)
}

function moveStoryboardDown() {
  return moveStoryboardByOffset(1)
}

async function insertStoryboardBefore() {
  if (!props.storyboard?.id) return
  const blocked = reorderDisabledReason.value
  if (blocked) {
    ElMessage.warning(blocked)
    return
  }
  reorderBusy.value = true
  try {
    const created = await storyboardsAPI.insertBefore(props.storyboard.id)
    ElMessage.success('已在此位置前插入空白分镜')
    await ctx?.refresh?.()
    const createdId = created?.id ?? created?.data?.id
    if (createdId) await ctx?.setFocusedNode?.(`sb:${createdId}`)
  } catch (error) {
    if (isCanvasUserAbort(error)) return
    ElMessage.error(canvasUserError(error, '插入分镜失败'))
  } finally {
    reorderBusy.value = false
  }
}

async function insertStoryboardAfter() {
  const blocked = reorderDisabledReason.value
  if (blocked) {
    ElMessage.warning(blocked)
    return
  }
  const list = episodeStoryboards()
  const next = storyboardIndex.value >= 0 ? list[storyboardIndex.value + 1] : null
  if (!next?.id) {
    await appendStoryboard()
    return
  }
  reorderBusy.value = true
  try {
    const created = await storyboardsAPI.insertBefore(next.id)
    ElMessage.success('已在此位置后插入空白分镜')
    await ctx?.refresh?.()
    const createdId = created?.id ?? created?.data?.id
    if (createdId) await ctx?.setFocusedNode?.(`sb:${createdId}`)
  } catch (error) {
    if (isCanvasUserAbort(error)) return
    ElMessage.error(canvasUserError(error, '插入分镜失败'))
  } finally {
    reorderBusy.value = false
  }
}

async function appendStoryboard() {
  const blocked = reorderDisabledReason.value
  if (blocked) {
    ElMessage.warning(blocked)
    return
  }
  const list = episodeStoryboards()
  const episodeId = Number(props.storyboard?.episode_id || list[0]?.episode_id)
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    ElMessage.warning('无法确认当前集，不能追加分镜')
    return
  }
  const maxNum = list.reduce((max, item) => Math.max(max, Number(item.storyboard_number) || 0), 0)
  reorderBusy.value = true
  try {
    const created = await storyboardsAPI.create({
      episode_id: episodeId,
      storyboard_number: maxNum + 1,
      title: `镜头 ${maxNum + 1}`,
      description: '',
    })
    ElMessage.success('已在本集末尾追加空白分镜')
    await ctx?.refresh?.()
    const createdId = created?.id ?? created?.data?.id
    if (createdId) await ctx?.setFocusedNode?.(`sb:${createdId}`)
  } catch (error) {
    if (isCanvasUserAbort(error)) return
    ElMessage.error(canvasUserError(error, '追加分镜失败'))
  } finally {
    reorderBusy.value = false
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

const referencePickerContext = computed(() => {
  const drama = ctx?.drama?.value
  const id = String(props.storyboard?.id ?? '')
  const episode = (drama?.episodes || []).find((item) => (
    (item.storyboards || []).some((storyboard) => String(storyboard.id) === id)
  ))
  return {
    projectTitle: drama?.title || '当前项目',
    episodeLabel: episode?.title || '',
    storyboardLabel: storyboardControlLabel(''),
    usageLabel: '添加到当前分镜自由参考图',
    dramaId: drama?.id,
    reusePolicy: 'current-or-global',
  }
})

function openReferenceLibrary() {
  if (!props.storyboard?.id || referenceSlots.value.length >= 10 || uploadingReference.value) return
  referencePickerVisible.value = true
}

function openMediaLibraryFromPicker() {
  referencePickerVisible.value = false
  ctx?.goMediaLibrary?.()
}

async function onReferenceAssetSelected(asset) {
  const reference = createStoryboardReferenceFromAsset(asset)
  if (!reference) {
    ElMessage.warning('当前只能把图片添加到分镜参考图')
    return
  }
  const result = upsertStoryboardReferenceImage({ reference_images: form.reference_images }, reference)
  if (result.status === 'invalid') {
    ElMessage.warning('该素材缺少可用图片地址，无法添加到分镜参考图')
    return
  }
  if (result.status === 'duplicate') {
    ElMessage.warning('该图片已经挂到当前分镜的自由参考图中')
    return
  }
  form.reference_images = result.items
  try {
    await persistReferences()
    referencePickerVisible.value = false
    ElMessage.success('已添加到当前分镜自由参考图')
  } catch (error) {
    ElMessage.error(canvasUserError(error, '添加参考图失败'))
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
    narration: form.narration.trim(),
    video_prompt: form.video_prompt.trim(),
    shot_type: form.shot_type.trim(),
  }
}

async function runUniversalPrompt(mode) {
  if (!props.storyboard?.id || busyStep.value) return
  const original = form.universal_segment_text
  const polishing = mode === 'polish' && original.trim()
  const statusNodeId = sbNodeId.value
  busyStep.value = polishing ? 'universal-polish' : 'universal-generate'
  const message = polishing ? '正在流式润色全能词' : '正在生成全能词'
  ctx?.nodeStatus?.set(statusNodeId, { step: busyStep.value, message })
  const controller = new AbortController()
  universalPromptRun = controller
  let settled = false
  const restoreOriginal = () => {
    if (!settled) form.universal_segment_text = original
  }
  controller.signal.addEventListener('abort', restoreOriginal, { once: true })
  let live = ''
  try {
    const draftSnapshot = currentDraftValue()
    await persistForm(true, draftSnapshot)
    markDraftSaved(draftSnapshot)
    if (controller.signal.aborted) throw new DOMException('操作已取消', 'AbortError')
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
      if (controller.signal.aborted) return
      live += delta
      form.universal_segment_text = live
    }, { signal: controller.signal })
    if (controller.signal.aborted) throw new DOMException('操作已取消', 'AbortError')
    const finalText = String(result?.universal_segment_text || live).trim()
    if (!finalText) throw new Error('未收到完整的全能词')
    form.universal_segment_text = finalText
    await storyboardsAPI.update(props.storyboard.id, { universal_segment_text: finalText })
    markDraftFieldsSaved(['universal_segment_text'])
    settled = true
    await ctx?.refreshDrama?.(true)
    if (!controller.signal.aborted) {
      ElMessage.success(polishing ? '全能词已润色并保存' : '全能词已生成并保存')
    }
  } catch (e) {
    if (!settled) restoreOriginal()
    // 已保存成功后的取消只影响刷新，不再回滚正文或报失败
    if (!(settled && (isCanvasUserAbort(e) || controller.signal.aborted))) {
      const error = isCanvasUserAbort(e) || controller.signal.aborted ? 'cancel' : e
      ElMessage.error(canvasUserError(error, polishing ? '全能词润色失败' : '全能词生成失败'))
    }
  } finally {
    if (universalPromptRun === controller) universalPromptRun = null
    busyStep.value = ''
    ctx?.nodeStatus?.clear(statusNodeId)
  }
}

async function runStep(step) {
  const drama = ctx?.drama?.value
  const sbId = props.storyboard?.id
  if (!drama || !sbId) return
  if (step === 'video' || step === 'audio' || step === 'narration-audio') {
    const allowed = ctx?.ensureProductionStepReady?.(step)
    if (allowed !== true) {
      if (allowed == null) ElMessage.warning('无法确认正式制作能力，请刷新后重试。')
      return
    }
  }

  if ((step === 'audio' || step === 'narration-audio') && hasUnsavedDraft.value) {
    ElMessage.warning('请先保存当前分镜修改，再生成配音。')
    return
  }
  if ((step === 'audio' || step === 'narration-audio') && audioOutcomeUnknown.value) {
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
    if (step !== 'audio' && step !== 'narration-audio') {
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
    else if (step === 'audio' || step === 'narration-audio') {
      const res = await runAudioStep(sb, { signal: generationRun.signal, kind: step === 'narration-audio' ? 'narration' : 'dialogue' })
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
</style>

<style>
.canvas-panel-popper {
  z-index: 4000 !important;
}
.canvas-panel-popper.el-select__popper .el-select-dropdown__wrap {
  max-height: 168px !important;
}
</style>
