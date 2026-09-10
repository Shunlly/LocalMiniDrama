<template>
  <!-- 隐藏的文件输入框放在弹窗外层，避免 el-form-item 干扰 -->
  <input ref="addCharRefFileInput" type="file" accept="image/*" style="display:none" tabindex="-1" aria-hidden="true" @change="onRefImageFileChange('character', $event)" />

  <!-- 添加/编辑角色弹窗 -->
  <AccessibleDialog v-model="showEditCharacter" :title="editCharacterForm?.id ? '编辑角色' : '添加角色'" width="75%" :before-close="handleCharDialogBeforeClose" @close="onCloseCharDialog">
    <el-form v-if="editCharacterForm" label-width="90px">
      <!-- 参考图上传区（新增/编辑均显示） -->
      <el-form-item label="参考图">
        <div class="ref-image-zone">
          <button type="button" class="ref-image-box" aria-label="选择角色参考图" @click="addCharRefFileInput?.click()" @drop.prevent="onRefImageDrop('character', $event)" @dragover.prevent>
            <!-- 优先：刚上传的新参考图 -->
            <img v-if="addCharRefImage" :src="addCharRefImage.dataUrl" alt="待上传角色参考图" class="ref-preview-img" />
            <!-- 次之：已保存的参考图 -->
            <img v-else-if="editCharacterForm.ref_image"
              :src="editCharacterForm.ref_image.startsWith('http') ? editCharacterForm.ref_image : '/static/' + editCharacterForm.ref_image"
              alt="已保存角色参考图"
              class="ref-preview-img" />
            <!-- 最后：主图（半透明，提示可上传参考图替代） -->
            <img v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path)"
              :src="assetImageUrl(editCharacterForm)"
              alt="角色主图"
              class="ref-preview-img" style="opacity:0.5" />
            <span v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></span>
          </button>
          <div v-if="addCharRefImage" class="ref-actions">
            <el-button
              type="primary"
              size="small"
              :loading="extractingCharAppearance"
              :disabled="Boolean(extractCharAppearanceDisabledReason)"
              :title="extractCharAppearanceDisabledReason || undefined"
              @click="doExtractFromRef('character')"
            >提取特征描述</el-button>
            <el-button size="small" @click="addCharRefImage = null">移除</el-button>
          </div>
          <div v-else-if="editCharacterForm.ref_image" class="ref-actions">
            <el-button
              type="primary"
              size="small"
              :loading="extractingCharAppearance"
              :disabled="Boolean(extractCharAppearanceDisabledReason)"
              :title="extractCharAppearanceDisabledReason || undefined"
              @click="doExtractCharFromImage"
            >从参考图提取描述</el-button>
            <el-button size="small" @click="clearCharRefImage">移除参考图</el-button>
          </div>
          <div v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path) && !editCharacterForm.appearance" class="ref-actions">
            <el-button
              size="small"
              :loading="extractingCharAppearance"
              :disabled="Boolean(extractCharAppearanceDisabledReason)"
              :title="extractCharAppearanceDisabledReason || undefined"
              @click="doExtractCharFromImage"
            >从主图提取描述</el-button>
          </div>
        </div>
      </el-form-item>
      <el-form-item label="名称" required>
        <el-input v-model="editCharacterForm.name" aria-label="角色名称" placeholder="角色名称" />
      </el-form-item>
      <el-form-item label="身份/定位">
        <el-select v-model="editCharacterForm.role" :aria-label="`角色${editCharacterForm.name || '未命名角色'}身份定位`" placeholder="请选择角色类型" style="width:200px">
          <el-option value="main" label="主角" />
          <el-option value="supporting" label="配角" />
          <el-option value="minor" label="次要角色" />
        </el-select>
      </el-form-item>
      <el-form-item label="外貌描述">
        <el-input v-model="editCharacterForm.appearance" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" aria-label="角色外貌描述" placeholder="用于 AI 生成图像的外貌描述，尽量详细" />
      </el-form-item>
      <el-form-item label="简介">
        <el-input v-model="editCharacterForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" aria-label="角色简介" placeholder="角色背景简介，供剧本生成参考" />
      </el-form-item>
      <el-form-item v-if="editCharacterForm.id">
        <template #label>
          <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">图生提示词</span>
        </template>
        <div style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;color:#909399">AI 润色后的最终提示词，生成四视图图片时直接使用；可手动修改</span>
            <el-button
              size="small"
              :loading="editCharacterPromptGenerating"
              :disabled="Boolean(generateCharacterPromptDisabledReason)"
              :title="generateCharacterPromptDisabledReason || undefined"
              @click="doGenerateCharacterPrompt"
            >重新生成提示词</el-button>
          </div>
          <el-input
            v-model="editCharacterForm.polished_prompt"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 16 }"
            aria-label="角色图生提示词"
            :placeholder="editCharacterPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
            :disabled="editCharacterPromptGenerating"
            style="font-size:12px"
          />
        </div>
      </el-form-item>
      <!-- P0-2: 视觉锚点（identity_anchors） -->
      <el-form-item v-if="editCharacterForm.id" label="视觉锚点">
        <div style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;color:#909399">AI 从外貌描述提炼的6层视觉特征，用于保持生成图片角色一致性</span>
            <ActionGate :reason="extractIdentityAnchorsDisabledReason" label="提炼视觉锚点">
              <el-button
                size="small"
                :loading="extractingAnchors"
                :disabled="Boolean(extractIdentityAnchorsDisabledReason)"
                :title="extractIdentityAnchorsDisabledReason || undefined"
                @click="extractIdentityAnchors"
              >提炼视觉锚点</el-button>
            </ActionGate>
          </div>
          <el-input
            v-if="editCharacterForm.identity_anchors"
            :value="typeof editCharacterForm.identity_anchors === 'string'
              ? editCharacterForm.identity_anchors
              : JSON.stringify(editCharacterForm.identity_anchors, null, 2)"
            type="textarea"
            :rows="4"
            readonly
            aria-label="角色视觉锚点"
            style="font-size:11px;font-family:monospace"
            placeholder="点击「提炼视觉锚点」生成"
          />
          <div v-else style="font-size:12px;color:#c0c4cc;padding:4px 0">暂无锚点，点击「提炼视觉锚点」自动提炼</div>
        </div>
      </el-form-item>
      <!-- P1-3: 多阶段造型（stages） -->
      <el-form-item v-if="editCharacterForm.id" label="多阶段造型">
        <div style="width:100%">
          <div style="font-size:12px;color:#909399;margin-bottom:6px">
            不同集次的角色造型变化，格式：JSON 数组 [{"episode_range":[1,3],"appearance":"..."}]
          </div>
          <el-input
            v-model="editCharacterForm.stages"
            type="textarea"
            :rows="4"
            aria-label="角色多阶段造型"
            placeholder='例：[{"episode_range":[1,5],"appearance":"白衣少年"},{"episode_range":[6,10],"appearance":"黑衣武者"}]'
            style="font-size:12px;font-family:monospace"
          />
        </div>
      </el-form-item>
    </el-form>
    <p v-else class="char-edit-empty" role="status">角色信息还没有准备好。请点「取消」关闭后，再从角色列表重新打开。</p>
    <template #footer>
      <el-button @click="requestCloseCharDialog">取消</el-button>
      <el-button type="primary" :loading="editCharacterSaving" :disabled="Boolean(editCharacterSubmitDisabledReason)" :title="editCharacterSubmitDisabledReason || undefined" @click="submitEditCharacter">{{ editCharacterForm?.id ? '保存' : '添加' }}</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import ActionGate from './ActionGate.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  editCharacterForm: { type: Object, default: null },
  editCharacterPromptGenerating: { type: Boolean, default: false },
  editCharacterSaving: { type: Boolean, default: false },
  extractingAnchors: { type: Boolean, default: false },
  extractingCharAppearance: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  clearCharRefImage: { type: Function, required: true },
  doExtractCharFromImage: { type: Function, required: true },
  doExtractFromRef: { type: Function, required: true },
  doGenerateCharacterPrompt: { type: Function, required: true },
  extractIdentityAnchors: { type: Function, required: true },
  onCloseCharDialog: { type: Function, required: true },
  onRefImageDrop: { type: Function, required: true },
  onRefImageFileChange: { type: Function, required: true },
  submitEditCharacter: { type: Function, required: true },
})

const showEditCharacter = defineModel('showEditCharacter', { type: Boolean, default: false })
const addCharRefImage = defineModel('addCharRefImage', { type: Object, default: null })

const {
  assetImageUrl,
  clearCharRefImage,
  doExtractCharFromImage,
  doExtractFromRef,
  doGenerateCharacterPrompt,
  extractIdentityAnchors,
  onCloseCharDialog,
  onRefImageDrop,
  onRefImageFileChange,
  submitEditCharacter,
} = props

const addCharRefFileInput = ref(null)

const CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE = '角色编辑还没有保存，关闭会丢失这些修改。'
const characterDraftBaseline = ref('')

function captureCharacterDraft(form, refImage) {
  return JSON.stringify({
    form: form ?? null,
    refImageDataUrl: refImage?.dataUrl ?? '',
    refImageFilename: refImage?.filename ?? '',
  })
}

function hasUnsavedCharacterDraft() {
  return captureCharacterDraft(props.editCharacterForm, addCharRefImage.value) !== characterDraftBaseline.value
}

function confirmCloseCharacterDialog() {
  if (!hasUnsavedCharacterDraft()) return true
  return window.confirm(CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE)
}

function handleCharDialogBeforeClose(done) {
  if (typeof done !== 'function') return
  if (confirmCloseCharacterDialog()) done()
}

function requestCloseCharDialog() {
  if (!confirmCloseCharacterDialog()) return
  showEditCharacter.value = false
}

watch(showEditCharacter, (open) => {
  if (!open) return
  characterDraftBaseline.value = captureCharacterDraft(props.editCharacterForm, addCharRefImage.value)
}, { immediate: true, flush: 'sync' })

const editCharacterSubmitDisabledReason = computed(() => {
  if (!props.editCharacterForm?.name?.trim()) return '请先填写角色名称'
  return ''
})

const generateCharacterPromptDisabledReason = computed(() => {
  if (props.editCharacterPromptGenerating) return 'AI 正在生成提示词，请稍候'
  return ''
})

const extractCharAppearanceDisabledReason = computed(() => {
  if (!props.extractingCharAppearance) return ''
  if (addCharRefImage.value) return '正在提取特征描述，请稍候'
  if (props.editCharacterForm?.ref_image) return '正在从参考图提取描述，请稍候'
  return '正在从主图提取描述，请稍候'
})

const extractIdentityAnchorsDisabledReason = computed(() => {
  if (!props.editCharacterForm?.appearance) return '请先填写角色外貌描述'
  return ''
})
</script>

<style scoped>
.ref-image-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ref-image-box {
  width: 120px;
  height: 120px;
  border: 2px dashed #c0c4cc;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  background: #fafafa;
  flex-shrink: 0;
  transition: border-color 0.2s;
  padding: 0;
  color: inherit;
  font: inherit;
}

.ref-image-box:hover {
  border-color: #409eff;
}

.ref-image-box:focus-visible {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

.char-edit-empty {
  margin: 0;
  color: #5a5a66;
  font-size: 0.9rem;
  padding: 16px 0;
}

html.light .char-edit-empty {
  color: #9ca3af;
}
</style>
