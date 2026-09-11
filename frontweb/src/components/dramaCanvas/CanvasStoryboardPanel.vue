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
      :audio-action-disabled-reason="audioActionDisabledReason"
      :save-fields="saveFields"
      :polish-prompt="polishPrompt"
      :run-universal-prompt="runUniversalPrompt"
      :run-step="runStep"
      :delete-storyboard="deleteStoryboard"
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
import { collectStoryboardReferenceSlots } from '@/utils/storyboardVideoRequest'
import { assetImageUrl } from '@/utils/mediaUrl'
import { buildCanvasReferenceDisplaySlots } from '@/composables/useCanvasReferenceDisplay'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
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
const audioOutcomeUnknown = ref(false)
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
const audioActionDisabledReason = computed(() => (
  ttsAction.value.reason
  || (audioOutcomeUnknown.value ? '请先刷新分镜状态，确认上一次配音结果后再重试' : '')
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
  const billableGenerationActive = ['image', 'video', 'audio'].includes(busyStep.value)
    && ctx?.hasNodeGeneration?.()
  const universalBusy = busyStep.value === 'universal-generate' || busyStep.value === 'universal-polish'
  if (universalBusy) abortUniversalPrompt()
  if (saving.value || uploadingReference.value || (busyStep.value && !['image', 'video', 'audio'].includes(busyStep.value) && !universalBusy) || billableGenerationActive) {
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
</style>

<style>
.canvas-panel-popper {
  z-index: 4000 !important;
}
.canvas-panel-popper.el-select__popper .el-select-dropdown__wrap {
  max-height: 168px !important;
}
</style>
