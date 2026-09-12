<template>
  <input ref="addSceneRefFileInput" type="file" accept="image/*" style="display:none" tabindex="-1" aria-hidden="true" @change="onRefImageFileChange('scene', $event)" />

  <!-- 添加/编辑场景弹窗 -->
  <AccessibleDialog v-model="showEditScene" :title="editSceneForm?.id ? '编辑场景' : '添加场景'" width="75%" :before-close="handleSceneDialogBeforeClose" @close="onCloseSceneDialog">
    <el-form v-if="editSceneForm" label-width="90px">
      <!-- 参考图上传区（新增/编辑均显示） -->
      <el-form-item label="参考图">
        <FilmCreateResourceRefImageField
          select-aria-label="选择场景参考图"
          pending-alt="待上传场景参考图"
          saved-alt="已保存场景参考图"
          main-alt="场景主图"
          :pending-image="addSceneRefImage"
          :saved-ref-image="editSceneForm.ref_image || ''"
          :main-src="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path) ? assetImageUrl(editSceneForm) : ''"
          :extracting="extractingSceneDesc"
          pending-extract-title="正在提取特征描述，请稍候"
          saved-extract-title="正在提取描述，请稍候"
          main-extract-title="正在提取描述，请稍候"
          :show-main-extract="Boolean(editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path) && !editSceneForm.prompt)"
          @pick="addSceneRefFileInput?.click()"
          @drop="onRefImageDrop('scene', $event)"
          @extract-pending="doExtractFromRef('scene')"
          @remove-pending="addSceneRefImage = null"
          @extract-saved="doExtractSceneFromImage"
          @clear-saved="clearSceneRefImage"
          @extract-main="doExtractSceneFromImage"
        />
      </el-form-item>
      <el-form-item label="地点" required>
        <el-input v-model="editSceneForm.location" aria-label="场景地点" placeholder="如：森林、教室" />
      </el-form-item>
      <el-form-item label="时间">
        <el-input v-model="editSceneForm.time" aria-label="场景时间" placeholder="如：白天、傍晚" />
      </el-form-item>
      <el-form-item label="场景描述">
        <el-input v-model="editSceneForm.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" aria-label="场景描述" placeholder="场景的简要描述，供 AI 生成四视图时参考" />
      </el-form-item>
      <el-form-item v-if="editSceneForm.id">
        <template #label>
          <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">单图提示词</span>
        </template>
        <div style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;color:#909399">单图场景的完整图片提示词（不含四宫格布局），生图时直接使用；可手动修改</span>
            <el-button size="small" :loading="editScenePromptGenerating" :title="editScenePromptGenerating ? '正在生成提示词，请稍候' : undefined" :aria-label="editScenePromptGenerating ? '正在生成提示词，请稍候' : '重新生成单张提示词'" @click="doGenerateSceneSinglePrompt">重新生成提示词</el-button>
          </div>
          <el-input
            v-model="editSceneForm.polished_prompt_single"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 16 }"
            aria-label="场景单图提示词"
            placeholder="单图场景提示词，点击场景列表的「AI 生成」按钮（不勾选四宫格）后会自动生成"
            style="font-size:12px"
          />
        </div>
      </el-form-item>
      <el-form-item v-if="editSceneForm.id">
        <template #label>
          <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">四视图提示词</span>
        </template>
        <div style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;color:#909399">AI 生成的完整四视图图片提示词，生图时直接使用；可手动修改</span>
            <el-button size="small" :loading="editScenePromptGenerating" :title="editScenePromptGenerating ? '正在生成提示词，请稍候' : undefined" :aria-label="editScenePromptGenerating ? '正在生成提示词，请稍候' : '重新生成提示词'" @click="doGenerateScenePrompt">重新生成提示词</el-button>
          </div>
          <el-input
            v-model="editSceneForm.polished_prompt"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 16 }"
            aria-label="场景四视图提示词"
            :placeholder="editScenePromptGenerating ? 'AI 正在生成四视图提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
            :disabled="editScenePromptGenerating"
            style="font-size:12px"
          />
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑场景" @click="requestCloseSceneDialog">取消</el-button>
      <el-button type="primary" :loading="editSceneSaving" :disabled="!editSceneForm?.location?.trim()" :title="editSceneSaving ? '正在保存场景，请稍候' : (editSceneForm?.location?.trim() ? undefined : '请先填写地点')" :aria-label="editSceneSaving ? '正在保存场景，请稍候' : (editSceneForm?.location?.trim() ? (editSceneForm?.id ? '保存场景' : '添加场景') : '请先填写地点')" @click="submitEditScene">{{ editSceneForm?.id ? '保存' : '添加' }}</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessageBox } from '@/utils/elementPlusFeedback.js'
import FilmCreateResourceRefImageField from './FilmCreateResourceRefImageField.vue'
import {
  captureResourceEditDraft,
  createResourceEditUnsavedCloser,
  isVisibleEditorDraftDirty,
  SCENE_EDIT_UNSAVED_CLOSE_MESSAGE,
} from './filmCreateResourceEditUnsavedClose.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  editSceneForm: { type: Object, default: null },
  editScenePromptGenerating: { type: Boolean, default: false },
  editSceneSaving: { type: Boolean, default: false },
  extractingSceneDesc: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  clearSceneRefImage: { type: Function, required: true },
  doExtractFromRef: { type: Function, required: true },
  doExtractSceneFromImage: { type: Function, required: true },
  doGenerateScenePrompt: { type: Function, required: true },
  doGenerateSceneSinglePrompt: { type: Function, required: true },
  onCloseSceneDialog: { type: Function, required: true },
  onRefImageDrop: { type: Function, required: true },
  onRefImageFileChange: { type: Function, required: true },
  submitEditScene: { type: Function, required: true },
})

const addSceneRefImage = defineModel('addSceneRefImage', { type: Object, default: null })
const showEditScene = defineModel('showEditScene', { type: Boolean, default: false })

const {
  assetImageUrl,
  clearSceneRefImage,
  doExtractFromRef,
  doExtractSceneFromImage,
  doGenerateScenePrompt,
  doGenerateSceneSinglePrompt,
  onCloseSceneDialog,
  onRefImageDrop,
  onRefImageFileChange,
  submitEditScene,
} = props

const addSceneRefFileInput = ref(null)

const sceneDraftBaseline = ref('')
const sceneCloser = createResourceEditUnsavedCloser({
  message: SCENE_EDIT_UNSAVED_CLOSE_MESSAGE,
  confirmBox: (...args) => ElMessageBox.confirm(...args),
})

function hasUnsavedSceneDraft() {
  return isVisibleEditorDraftDirty(
    showEditScene.value,
    captureResourceEditDraft(props.editSceneForm, addSceneRefImage.value),
    sceneDraftBaseline.value,
  )
}

function handleSceneDialogBeforeClose(done) {
  return sceneCloser.handleBeforeClose(hasUnsavedSceneDraft, done)
}

function requestCloseSceneDialog() {
  return sceneCloser.requestClose(hasUnsavedSceneDraft, () => {
    showEditScene.value = false
  })
}

watch(showEditScene, (open) => {
  if (!open) return
  sceneDraftBaseline.value = captureResourceEditDraft(props.editSceneForm, addSceneRefImage.value)
}, { immediate: true, flush: 'sync' })

defineExpose({
  hasUnsaved: hasUnsavedSceneDraft,
  confirmLeave: () => sceneCloser.confirmClose(hasUnsavedSceneDraft),
})
</script>
