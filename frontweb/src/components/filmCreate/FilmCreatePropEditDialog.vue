<template>
  <input ref="addPropAddRefFileInput" type="file" accept="image/*" style="display:none" tabindex="-1" aria-hidden="true" @change="onRefImageFileChange2('addProp', $event)" />
  <input ref="addPropRefFileInput" type="file" accept="image/*" style="display:none" tabindex="-1" aria-hidden="true" @change="onRefImageFileChange('prop', $event)" />

  <!-- 添加道具弹窗 -->
  <AccessibleDialog v-model="showAddProp" title="添加道具" width="600px" @close="() => { addPropForm = { name: '', type: '', description: '', prompt: '' }; addPropAddRefImage = null }">
    <el-form label-width="90px">
      <el-form-item label="参考图">
        <FilmCreateResourceRefImageField
          select-aria-label="选择道具参考图"
          pending-alt="待上传道具参考图"
          :pending-image="addPropAddRefImage"
          :extracting="extractingPropAddDesc"
          pending-extract-title="正在提取特征描述，请稍候"
          @pick="addPropAddRefFileInput?.click()"
          @drop="onRefImageDrop2('addProp', $event)"
          @extract-pending="doExtractFromRef2('addProp')"
          @remove-pending="addPropAddRefImage = null"
        />
      </el-form-item>
      <el-form-item label="名称" required>
        <el-input v-model="addPropForm.name" aria-label="道具名称" placeholder="道具名称" />
      </el-form-item>
      <el-form-item label="类型">
        <el-input v-model="addPropForm.type" aria-label="道具类型" placeholder="如：道具、建筑" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="addPropForm.description" type="textarea" :rows="3" aria-label="道具描述" placeholder="描述" />
      </el-form-item>
      <el-form-item label="图生提示词">
        <el-input v-model="addPropForm.prompt" type="textarea" :rows="2" aria-label="道具图生提示词" placeholder="用于 AI 生成图片的提示词" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消添加道具" @click="showAddProp = false">取消</el-button>
      <el-button type="primary" :loading="addPropSaving" :disabled="!addPropForm.name.trim()" :title="addPropSaving ? '正在保存道具，请稍候' : (addPropForm.name.trim() ? undefined : '请先填写名称')" :aria-label="addPropSaving ? '正在保存道具，请稍候' : (addPropForm.name.trim() ? '确定添加道具' : '请先填写名称')" @click="submitAddProp">确定</el-button>
    </template>
  </AccessibleDialog>

  <!-- 编辑道具弹窗 -->
  <AccessibleDialog v-model="showEditProp" :title="editPropForm?.id ? '编辑道具' : '添加道具'" width="75%" @close="onClosePropDialog">
    <el-form v-if="editPropForm" label-width="90px">
      <!-- 参考图上传区（新增/编辑均显示） -->
      <el-form-item label="参考图">
        <FilmCreateResourceRefImageField
          select-aria-label="选择道具参考图"
          pending-alt="待上传道具参考图"
          saved-alt="已保存道具参考图"
          main-alt="道具主图"
          :pending-image="addPropRefImage"
          :saved-ref-image="editPropForm.ref_image || ''"
          :main-src="editPropForm.id && (editPropForm.image_url || editPropForm.local_path) ? assetImageUrl(editPropForm) : ''"
          :extracting="extractingPropDesc"
          pending-extract-title="正在提取特征描述，请稍候"
          saved-extract-title="正在提取描述，请稍候"
          main-extract-title="正在提取描述，请稍候"
          :show-main-extract="Boolean(editPropForm.id && (editPropForm.image_url || editPropForm.local_path) && !editPropForm.description)"
          @pick="addPropRefFileInput?.click()"
          @drop="onRefImageDrop('prop', $event)"
          @extract-pending="doExtractFromRef('prop')"
          @remove-pending="addPropRefImage = null"
          @extract-saved="doExtractPropFromImage"
          @clear-saved="clearPropRefImage"
          @extract-main="doExtractPropFromImage"
        />
      </el-form-item>
      <el-form-item label="名称" required>
        <el-input v-model="editPropForm.name" aria-label="道具名称" placeholder="道具名称" />
      </el-form-item>
      <el-form-item label="类型">
        <el-input v-model="editPropForm.type" aria-label="道具类型" placeholder="如：道具、建筑" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="editPropForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" aria-label="道具描述" placeholder="道具描述" />
      </el-form-item>
      <el-form-item label="图生提示词">
        <div style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;color:#909399">AI 润色后的图片提示词，生成图片时直接使用；可手动修改</span>
            <el-button size="small" :loading="editPropPromptGenerating" :title="editPropPromptGenerating ? '正在生成提示词，请稍候' : undefined" :aria-label="editPropPromptGenerating ? '正在生成提示词，请稍候' : '重新生成提示词'" @click="doGeneratePropPrompt">重新生成提示词</el-button>
          </div>
          <el-input
            v-model="editPropForm.prompt"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 16 }"
            aria-label="道具图生提示词"
            :placeholder="editPropPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
            :disabled="editPropPromptGenerating"
          />
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑道具" @click="showEditProp = false">取消</el-button>
      <el-button type="primary" :loading="editPropSaving" :disabled="!editPropForm?.name?.trim()" :title="editPropSaving ? '正在保存道具，请稍候' : (editPropForm?.name?.trim() ? undefined : '请先填写名称')" :aria-label="editPropSaving ? '正在保存道具，请稍候' : (editPropForm?.name?.trim() ? (editPropForm?.id ? '保存道具' : '添加道具') : '请先填写名称')" @click="submitEditProp">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { ref } from 'vue'
import FilmCreateResourceRefImageField from './FilmCreateResourceRefImageField.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  addPropSaving: { type: Boolean, default: false },
  editPropForm: { type: Object, default: null },
  editPropPromptGenerating: { type: Boolean, default: false },
  editPropSaving: { type: Boolean, default: false },
  extractingPropAddDesc: { type: Boolean, default: false },
  extractingPropDesc: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  clearPropRefImage: { type: Function, required: true },
  doExtractFromRef: { type: Function, required: true },
  doExtractFromRef2: { type: Function, required: true },
  doExtractPropFromImage: { type: Function, required: true },
  doGeneratePropPrompt: { type: Function, required: true },
  onClosePropDialog: { type: Function, required: true },
  onRefImageDrop: { type: Function, required: true },
  onRefImageDrop2: { type: Function, required: true },
  onRefImageFileChange: { type: Function, required: true },
  onRefImageFileChange2: { type: Function, required: true },
  submitAddProp: { type: Function, required: true },
  submitEditProp: { type: Function, required: true },
})

const addPropForm = defineModel('addPropForm', { type: Object, default: () => ({ name: '', type: '', description: '', prompt: '' }) })
const addPropAddRefImage = defineModel('addPropAddRefImage', { type: Object, default: null })
const addPropRefImage = defineModel('addPropRefImage', { type: Object, default: null })
const showAddProp = defineModel('showAddProp', { type: Boolean, default: false })
const showEditProp = defineModel('showEditProp', { type: Boolean, default: false })

const {
  assetImageUrl,
  clearPropRefImage,
  doExtractFromRef,
  doExtractFromRef2,
  doExtractPropFromImage,
  doGeneratePropPrompt,
  onClosePropDialog,
  onRefImageDrop,
  onRefImageDrop2,
  onRefImageFileChange,
  onRefImageFileChange2,
  submitAddProp,
  submitEditProp,
} = props

const addPropAddRefFileInput = ref(null)
const addPropRefFileInput = ref(null)
</script>
