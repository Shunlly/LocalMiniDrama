<template>
  <AccessibleDialog v-model="editDramaSceneVisible" title="编辑制作场景" width="500px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('dramaScene', done)" @close="editDramaSceneForm = null">
    <el-form v-if="editDramaSceneForm" label-width="80px">
      <DramaDetailResourceImageEditor
        :form="editDramaSceneForm"
        preview-label="预览制作场景图片"
        fallback-alt="制作场景图片"
        alt-key="location"
        :asset-image-url="assetImageUrl"
        @preview="openPreview"
        @upload="uploadDramaSceneImg"
        @generate="generateDramaSceneImg"
      />
      <el-form-item label="地点"><el-input v-model="editDramaSceneForm.location" aria-label="制作场景地点" /></el-form-item>
      <el-form-item label="时间"><el-input v-model="editDramaSceneForm.time" placeholder="如：浅色/夜晚" aria-label="制作场景时间" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="editDramaSceneForm.description" type="textarea" :rows="3" placeholder="场景描述" aria-label="制作场景描述" /></el-form-item>
      <el-form-item label="图片提示词"><el-input v-model="editDramaSceneForm.prompt" type="textarea" :rows="2" placeholder="图片生成用的详细提示词" aria-label="制作场景图片提示词" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑制作场景" @click="requestResourceEditorClose('dramaScene')">取消</el-button>
      <el-button type="primary" :loading="editDramaSceneSaving" :disabled="editDramaSceneSaving" :title="editDramaSceneSaving ? '正在保存，请稍候' : undefined" :aria-label="editDramaSceneSaving ? '正在保存，请稍候' : '保存制作场景'" @click="saveDramaScene">保存</el-button>
    </template>
  </AccessibleDialog>

  <AccessibleDialog v-model="editSceneVisible" title="编辑场景库" width="480px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('scene', done)" @close="editSceneForm = null">
    <el-form v-if="editSceneForm" label-width="80px">
      <DramaDetailResourceImageEditor
        :form="editSceneForm"
        preview-label="预览场景库图片"
        fallback-alt="场景库图片"
        alt-key="location"
        :asset-image-url="assetImageUrl"
        @preview="openPreview"
        @upload="(event) => doUploadLibImg(event, editSceneForm, sceneLibraryAPI, loadSceneList)"
        @generate="doGenerateLibImg(editSceneForm, ([editSceneForm.location, editSceneForm.time, editSceneForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneList)"
      />
      <el-form-item label="地点"><el-input v-model="editSceneForm.location" aria-label="场景地点" /></el-form-item>
      <el-form-item label="时间"><el-input v-model="editSceneForm.time" placeholder="如：浅色/夜晚" aria-label="场景时间" /></el-form-item>
      <el-form-item label="分类"><el-input v-model="editSceneForm.category" placeholder="可选" aria-label="场景分类" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="editSceneForm.description" type="textarea" :rows="3" placeholder="可选" aria-label="场景描述" /></el-form-item>
      <el-form-item label="标签"><el-input v-model="editSceneForm.tags" placeholder="逗号分隔" aria-label="场景标签" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑场景" @click="requestResourceEditorClose('scene')">取消</el-button>
      <el-button type="primary" :loading="editSceneSaving" :disabled="editSceneSaving" :title="editSceneSaving ? '正在保存，请稍候' : undefined" :aria-label="editSceneSaving ? '正在保存，请稍候' : '保存场景'" @click="saveScene">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import DramaDetailResourceImageEditor from './DramaDetailResourceImageEditor.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  editDramaSceneSaving: { type: Boolean, default: false },
  editSceneSaving: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  doGenerateLibImg: { type: Function, required: true },
  doUploadLibImg: { type: Function, required: true },
  generateDramaSceneImg: { type: Function, required: true },
  loadSceneList: { type: Function, required: true },
  openPreview: { type: Function, required: true },
  requestResourceEditorClose: { type: Function, required: true },
  saveDramaScene: { type: Function, required: true },
  saveScene: { type: Function, required: true },
  sceneLibraryAPI: { type: Object, required: true },
  uploadDramaSceneImg: { type: Function, required: true },
})

const editDramaSceneVisible = defineModel('editDramaSceneVisible', { type: Boolean, default: false })
const editDramaSceneForm = defineModel('editDramaSceneForm', { type: Object, default: null })
const editSceneVisible = defineModel('editSceneVisible', { type: Boolean, default: false })
const editSceneForm = defineModel('editSceneForm', { type: Object, default: null })
</script>
