<template>
  <AccessibleDialog v-model="editDramaPropVisible" title="编辑制作道具" width="500px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('dramaProp', done)" @close="editDramaPropForm = null">
    <el-form v-if="editDramaPropForm" label-width="80px">
      <DramaDetailResourceImageEditor
        :form="editDramaPropForm"
        preview-label="预览制作道具图片"
        fallback-alt="制作道具图片"
        alt-key="name"
        :asset-image-url="assetImageUrl"
        @preview="openPreview"
        @upload="uploadDramaPropImg"
        @generate="generateDramaPropImg"
      />
      <el-form-item label="名称"><el-input v-model="editDramaPropForm.name" aria-label="制作道具名称" /></el-form-item>
      <el-form-item label="类型"><el-input v-model="editDramaPropForm.type" placeholder="如：关键道具、背景物件" aria-label="制作道具类型" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="editDramaPropForm.description" type="textarea" :rows="3" placeholder="道具描述" aria-label="制作道具描述" /></el-form-item>
      <el-form-item label="图片提示词"><el-input v-model="editDramaPropForm.prompt" type="textarea" :rows="2" placeholder="图片生成用的详细提示词" aria-label="制作道具图片提示词" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑制作道具" @click="requestResourceEditorClose('dramaProp')">取消</el-button>
      <el-button type="primary" :loading="editDramaPropSaving" :disabled="editDramaPropSaving" :title="editDramaPropSaving ? '正在保存，请稍候' : undefined" :aria-label="editDramaPropSaving ? '正在保存，请稍候' : '保存制作道具'" @click="saveDramaProp">保存</el-button>
    </template>
  </AccessibleDialog>

  <AccessibleDialog v-model="editPropVisible" title="编辑道具库" width="480px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('prop', done)" @close="editPropForm = null">
    <el-form v-if="editPropForm" label-width="80px">
      <DramaDetailResourceImageEditor
        :form="editPropForm"
        preview-label="预览道具库图片"
        fallback-alt="道具库图片"
        alt-key="name"
        :asset-image-url="assetImageUrl"
        @preview="openPreview"
        @upload="(event) => doUploadLibImg(event, editPropForm, propLibraryAPI, loadPropList)"
        @generate="doGenerateLibImg(editPropForm, (editPropForm.name + (editPropForm.description ? ', ' + editPropForm.description : '')), propLibraryAPI, loadPropList)"
      />
      <el-form-item label="名称"><el-input v-model="editPropForm.name" aria-label="道具名称" /></el-form-item>
      <el-form-item label="分类"><el-input v-model="editPropForm.category" placeholder="可选" aria-label="道具分类" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="editPropForm.description" type="textarea" :rows="3" placeholder="可选" aria-label="道具描述" /></el-form-item>
      <el-form-item label="标签"><el-input v-model="editPropForm.tags" placeholder="逗号分隔" aria-label="道具标签" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑道具" @click="requestResourceEditorClose('prop')">取消</el-button>
      <el-button type="primary" :loading="editPropSaving" :disabled="editPropSaving" :title="editPropSaving ? '正在保存，请稍候' : undefined" :aria-label="editPropSaving ? '正在保存，请稍候' : '保存道具'" @click="saveProp">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import DramaDetailResourceImageEditor from './DramaDetailResourceImageEditor.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  editDramaPropSaving: { type: Boolean, default: false },
  editPropSaving: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  doGenerateLibImg: { type: Function, required: true },
  doUploadLibImg: { type: Function, required: true },
  generateDramaPropImg: { type: Function, required: true },
  loadPropList: { type: Function, required: true },
  openPreview: { type: Function, required: true },
  propLibraryAPI: { type: Object, required: true },
  requestResourceEditorClose: { type: Function, required: true },
  saveDramaProp: { type: Function, required: true },
  saveProp: { type: Function, required: true },
  uploadDramaPropImg: { type: Function, required: true },
})

const editDramaPropVisible = defineModel('editDramaPropVisible', { type: Boolean, default: false })
const editDramaPropForm = defineModel('editDramaPropForm', { type: Object, default: null })
const editPropVisible = defineModel('editPropVisible', { type: Boolean, default: false })
const editPropForm = defineModel('editPropForm', { type: Object, default: null })
</script>
